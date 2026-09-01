/**
 * ai-manager.js 
 * Gemini APIを利用したAI機能の管理クラス 
 */
class AIManager {

    /**
     * AIManagerのコンストラクタ
     * @param {App} app 
    */
    constructor(app) {
        this.app = app;

        // AI状態変数
        this.pendingRegeneratedQuestion = null;
        this.memoNormalizedAnswers = [];
        this.pendingMemoQuestions = [];
        this.pronunciationCandidates = [];
    }

    /**
     * Gemini APIを呼び出す
     * @param {string} prompt 
     * @param {boolean} isJson 
     * @returns {Promise<any>}
     */
    async fetchGemini(prompt, isJson = false) {
        return await api.fetchGemini(
            this.app.geminiApiKey,
            prompt,
            isJson
        );
    }

    /**
     * AI解説の指示文を取得する
     * @returns {string}
     */
    getAIExplanationInstruction() {
        return 'クイズの解説は1〜2文で簡潔にまとめ、問題文の言い換えや重複を避けて、別の観点・関連知識・背景知識を含めてください。最後に必ず「暗記のコツ:」から始まる、短く実用的な暗記ポイントを付けてください。';
    }

    /**
     * AI解説プロンプトを構築する
     * @param {string} q 
     * @param {string} a 
     * @returns {string}
     */
    buildAIExplanationPrompt(q, a) {
        return `${this.getAIExplanationInstruction()}\n出力は解説文のみ。\nQ:${q}\nA:${a}`;
    }

    /**
     * バッチでAI解説プロンプトを構築する
     * @param {Array} items
     * @returns {string}
     */
    buildBatchAIExplanationPrompt(items) {
        return `${this.getAIExplanationInstruction()}\n各問題について同じ品質・構成で作成してください。\n必ず以下のJSON配列形式（文字列の配列）のみを出力してください。Markdownの装飾は不要です。\n["問題0の解説", "問題1の解説", ...]\n` + items.map((item, idx) => `[${idx}] Q:${item.q} A:${item.a}`).join("\n");
    }

    /**
     * 解説をAIで生成してitemsに埋め込む
     * @param {Array} items 
     * @param {HTMLElement} loadingText 
     * @param {number} batchSize 
     * @param {number} maxPrompts 
     */
    async fillExplanationsWithAI(items, loadingText = null, batchSize = CSV_EXPLANATION_BATCH_SIZE, maxPrompts = Infinity) {
        let promptsUsed = 0;
        for (let i = 0; i < items.length && promptsUsed < maxPrompts; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            promptsUsed++;
            if (loadingText) loadingText.textContent = `解説生成中... (${Math.min(i + batch.length, items.length)}/${items.length})`;
            const prompt = this.buildBatchAIExplanationPrompt(batch);

            try {
                const jsonStr = await this.fetchGemini(prompt, true);
                const cleanStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
                const exps = JSON.parse(cleanStr);
                if (Array.isArray(exps)) {
                    batch.forEach((item, idx) => {
                        const value = exps[idx];
                        if (typeof value === 'string') item.explanation = value;
                        else if (value && typeof value === 'object') item.explanation = value.explanation || value.exp || value.text || '';
                    });
                }
            } catch (e) {
                console.warn('AI解説生成をスキップしました', e);
            }
        }
    }

    /**
     * Gemini APIを用いてSSMLを生成する
     * @param {string} text 
     * @returns {Promise<string>}
     */
    async fetchGeminiSSML(text) {
        if (!this.app.geminiApiKey) {
            return `<speak>${this.app.dictionaryManager.applyDictionary(text)}</speak>`;
        }

        let dictPrompt = "";
        if (this.app.dictionary.length > 0) {
            dictPrompt = "以下の固有の読み方辞書を最優先で適用してください。\n" +
                this.app.dictionary.map(d => `${d.word}: ${d.pronunciation}`).join("\n") + "\n\n";
        }

        const prompt = `
あなたはText-to-Speech用のSSML生成アシスタントです。
入力された日本語のテキストを読み上げるためのSSMLタグを生成してください。
括弧書きによる読みの指定がある場合や、読み方が不定な漢字（人名、地名、専門用語など）には、必ず<sub alias="ひらがな">対象語</sub>タグを付与してください。
${dictPrompt}
出力は必ず <speak> タグで囲まれたSSMLテキストのみとしてください。

入力テキスト:
${text}
`;
        try {
            const result = await this.fetchGemini(prompt, false);
            if (result.includes("<speak>")) {
                return result.trim();
            }
            throw new Error("Invalid SSML format returned");
        } catch (e) {
            console.warn("SSML生成に失敗。フォールバックを使用します。", e);
            return `<speak>${this.app.dictionaryManager.applyDictionary(text)}</speak>`;
        }
    }

    /**
     * 早押しクイズの問題設計案をAIで生成する
     * @param {Object} options
     * @param {number} options.count 生成する設計案の件数
     * @param {string} options.genre ジャンル
     * @param {string} options.subgenre サブジャンル
     * @param {string} options.topic テーマ
     * @param {string} options.difficulty 難易度
     * @param {Array} options.excludedAnswers 既存または除外する解答の配列
     * @param {Array} options.excludedAngles 既存または除外する出題観点の配列
     * @return {Array} 設計案の配列 [{answer, aliases, angle, keywords, genre, subgenre}]
     */
    async generateQuestionPlansWithAI({ count, genre, subgenre, topic, difficulty, excludedAnswers, excludedAngles }) {
        const defs = this.app.getAISubgenres();
        const genreCandidates = Object.entries(defs).map(([g, subs]) => `${g}: ${subs.join('、')}`).join('\n');
        const requested = Math.max(count, Math.ceil(count * 1.3));
        const prompt = `早押しクイズの問題設計案を${requested}件作成してください。この段階では問題文や解説は作成しません。\n` +
            `各案は解答、別名、出題観点、識別用キーワード、ジャンル、サブジャンルを含めてください。\n` +
            `同じ解答・同義の解答・表記違いの解答を重複させないでください。出題観点やキーワードが似た案も避けてください。重複を避けられない場合は件数が少なくても構いません。\n` +
            `既存または除外する解答(JSON): ${JSON.stringify(excludedAnswers)}\n` +
            `すでに使用した出題観点(JSON): ${JSON.stringify(excludedAngles)}\n` +
            `条件: ジャンル=${genre || '候補から最適なものを選択'}、サブジャンル=${subgenre || '選択したジャンル配下から選択'}、テーマ=${topic || '指定なし'}、難易度=${difficulty}\n` +
            `ジャンル候補:\n${genreCandidates}\n` +
            `出力はJSON配列のみ。形式:[{"answer":"解答","aliases":["別名"],"angle":"他案と重ならない出題観点","keywords":["識別語"],"genre":"ジャンル","subgenre":"サブジャンル"}]`;
        const parsed = this.app.parseAIJSON(await this.fetchGemini(prompt, true));
        return Array.isArray(parsed) ? parsed : [];
    }

    /**
     * 設計案から問題文を生成する
     * @param {Array} plans 設計案の配列
     * @param {string} difficulty 難易度
     * @param {Array} priorSummaries 既存問題の概要 [{answer, angle, keywords}]
     * @return {Array} 生成された問題文の配列 [{q, a, explanation, genre, subgenre, angle, keywords}]
     */
    async generateQuestionBatchFromPlans(plans, difficulty, priorSummaries) {
        const prompt = `次の設計案ごとに早押しクイズ問題を1問ずつ作成してください。解答は設計案のanswerから変更しないでください。\n` +
            `早押しクイズらしく前半は広い手掛かり、後半ほど特定しやすくしてください。各手掛かりを内部でファクトチェックし、確実な事実だけを使ってください。\n` +
            `他の設計案や既に作成済みの問題と同じ趣旨・構成・手掛かりの並びを避けてください。\n` +
            `難易度:${difficulty}\n既に作成済みの概要(JSON):${JSON.stringify(priorSummaries)}\n` +
            `設計案(JSON):${JSON.stringify(plans)}\n` +
            `explanationは、${this.getAIExplanationInstruction()}\n` +
            `出力はJSON配列のみ。形式:[{"q":"問題文","a":"解答","explanation":"解説","genre":"ジャンル","subgenre":"サブジャンル","angle":"出題観点","keywords":["識別語"]}]`;
        const parsed = this.app.parseAIJSON(await this.fetchGemini(prompt, true));
        return Array.isArray(parsed) ? parsed : [];
    }

    /**
     * UI入力を検証する
     * @returns {{targetSet, genre, subgenre, topic, requestedCount, difficulty} | null}
     */
    async _validateGenerationInput() {
        if (!this.app.geminiApiKey) { this.app.showToast('Gemini APIキーを設定画面で登録してください', 'error'); return null; }
        const targetSetId = await this.app.dataManager.getTargetSetId('ai-target-set');
        if (!targetSetId) return null;
        const targetSet = this.app.studySets.find(s => s.id === targetSetId);
        const genre = document.getElementById('ai-genre').value;
        const subgenre = (document.getElementById('ai-subgenre')?.value || '').trim();
        const topic = genre ? '' : document.getElementById('ai-topic').value.trim();
        const requestedCount = parseInt(document.getElementById('ai-count').value, 10);
        const difficulty = (document.getElementById('ai-difficulty')?.value || '中級').trim();
        if (!genre && !topic) { this.app.showToast('ジャンルまたはテーマを入力してください', 'error'); return null; }
        if (targetSet.questions.length + requestedCount > MAX_QUESTIONS_PER_SET) { this.app.showToast(`セットの登録上限(${MAX_QUESTIONS_PER_SET}問)を超過します。`, 'error'); return null; }
        if (this.app.getTotalQuestionCount() + requestedCount > MAX_TOTAL_QUESTIONS) { this.app.showToast(`アプリ全体の登録上限(${MAX_TOTAL_QUESTIONS}問)を超過します。`, 'error'); return null; }
        return { targetSet, genre, subgenre, topic, requestedCount, difficulty };
    }

    /**
     * 生成ステート初期化
     * @param {Object} targetSet
     * @returns {{existingQuestions, usedAnswers, accepted, acceptedAngles, defs}}
     */
    _initializeGenerationState(targetSet) {
        const existingQuestions = [...targetSet.questions];
        const usedAnswers = new Set(existingQuestions.map(q => this.app.normalizeAnswerForDuplicateCheck(q.a)).filter(Boolean));
        return { existingQuestions, usedAnswers, accepted: [], acceptedAngles: [], defs: this.app.getAISubgenres() };
    }

    /**
     * UI準備（ローディング表示）
     * @returns {{btn, loader, loadingTitle, originalLoadingText}}
     */
    _setupGenerationUI() {
        const btn = document.getElementById('btn-generate-ai');
        const loader = document.getElementById('ai-loading');
        const loadingTitle = loader.querySelector('p.text-sm');
        const originalLoadingText = loadingTitle?.textContent || '';
        btn.classList.add('hidden'); loader.classList.remove('hidden'); loader.classList.add('flex');
        return { btn, loader, loadingTitle, originalLoadingText };
    }

    /**
     * 設計案を検証・フィルタリング
     * @param {Array} plansRaw
     * @param {Set} usedAnswers
     * @param {string} genre
     * @param {string} subgenre
     * @param {Object} defs
     * @returns {Array} フィルタリング後の設計案
     */
    _validateAndFilterPlans(plansRaw, usedAnswers, genre, subgenre, defs) {
        const planKeys = new Set(), plans = [];
        for (const raw of plansRaw) {
            const answer = String(raw.answer || raw.a || '').trim();
            const key = this.app.normalizeAnswerForDuplicateCheck(answer);
            const aliases = (Array.isArray(raw.aliases) ? raw.aliases.map(x => String(x).trim()).filter(Boolean) : []);
            const aliasKeys = aliases.map(x => this.app.normalizeAnswerForDuplicateCheck(x));
            if (!answer || !key || usedAnswers.has(key) || aliasKeys.some(k => usedAnswers.has(k)) || planKeys.has(key)) continue;
            const angle = String(raw.angle || '').trim();
            const keywords = (Array.isArray(raw.keywords) ? raw.keywords.map(String) : []);
            if (plans.some(p => this.app.textSimilarity([angle, ...keywords].join(' '), [p.angle, ...(p.keywords || [])].join(' ')) >= 0.68)) continue;
            const assignedGenre = defs[raw.genre] ? raw.genre : (genre || 'ノンセク');
            let assignedSubgenre = String(raw.subgenre || subgenre || '').trim();
            if (!(defs[assignedGenre] || []).includes(assignedSubgenre)) assignedSubgenre = (defs[assignedGenre] || [])[0] || '';
            plans.push({ answer, aliases, angle, keywords, genre: assignedGenre, subgenre: assignedSubgenre });
            planKeys.add(key); if (plans.length >= plansRaw.length * 0.7) break;
        }
        return plans;
    }

    /**
     * 問題を生成・受理する
     * @param {Array} plans
     * @param {string} difficulty
     * @param {Array} accepted
     * @param {Array} acceptedAngles
     * @param {Set} usedAnswers
     * @param {Array} existingQuestions
     * @param {Object} loadingUI
     * @returns {Promise<number>} 受理した問題数
     */
    async _generateAndAcceptBatch(plans, difficulty, accepted, acceptedAngles, usedAnswers, existingQuestions, loadingUI) {
        const batches = [];
        for (let i = 0; i < plans.length; i += 5) batches.push(plans.slice(i, i + 5));
        const priorSummaries = accepted.map(x => ({ answer: x.a, angle: x.angle, keywords: x.keywords }));
        let completedBatches = 0;
        const batchResults = await this.app.mapWithConcurrency(batches, 2, async batch => {
            const result = await this.generateQuestionBatchFromPlans(batch, difficulty, priorSummaries);
            completedBatches++;
            if (loadingUI.loadingTitle) loadingUI.loadingTitle.textContent = `問題文を生成中... (${completedBatches}/${batches.length}バッチ)`;
            return { batch, result };
        });
        let acceptedCount = 0;
        for (const { batch, result } of batchResults) {
            for (const item of result) {
                const plan = batch.find(p => this.app.normalizeAnswerForDuplicateCheck(p.answer) === this.app.normalizeAnswerForDuplicateCheck(item.a));
                if (!plan || !item.q || !item.a) continue;
                const key = this.app.normalizeAnswerForDuplicateCheck(item.a);
                if (usedAnswers.has(key)) continue;
                const candidate = { q: String(item.q).trim(), a: plan.answer, explanation: String(item.explanation || '').trim(), genre: plan.genre, subgenre: plan.subgenre, angle: plan.angle, keywords: plan.keywords };
                if (this.app.isSimilarQuestionCandidate(candidate, accepted, existingQuestions)) continue;
                usedAnswers.add(key); plan.aliases.forEach(a => usedAnswers.add(this.app.normalizeAnswerForDuplicateCheck(a)));
                accepted.push(candidate); acceptedAngles.push(candidate.angle);
                acceptedCount++;
            }
        }
        return acceptedCount;
    }

    /**
     * 生成完了：保存・メッセージ表示・UI復帰
     * @param {Object} targetSet
     * @param {Array} accepted
     * @param {string} difficulty
     * @param {number} requestedCount
     * @param {Object} loadingUI
     */
    _finalizeGeneration(targetSet, accepted, difficulty, requestedCount, loadingUI) {
        const finalExisting = new Set(targetSet.questions.map(q => this.app.normalizeAnswerForDuplicateCheck(q.a)));
        const finalItems = [];
        for (const item of accepted) {
            const key = this.app.normalizeAnswerForDuplicateCheck(item.a);
            if (!key || finalExisting.has(key)) continue;
            finalExisting.add(key); finalItems.push(item);
        }
        finalItems.forEach(item => targetSet.questions.push(this.app.createQuestionData(item.q, item.a, item.explanation, { genre: item.genre, subgenre: item.subgenre, difficulty })));
        this.app.saveStudySets();
        if (finalItems.length) this.app.showToast(`${finalItems.length}問生成しました${finalItems.length < requestedCount ? `（重複・類似を除外したため指定数未満）` : '！'}`, 'success');
        else this.app.showToast('重複しない問題を生成できませんでした。条件を変更して再試行してください。', 'error');
        if (finalItems.length && document.getElementById('ai-topic')) document.getElementById('ai-topic').value = '';
        if (loadingUI.loadingTitle) loadingUI.loadingTitle.textContent = loadingUI.originalLoadingText;
        loadingUI.btn.classList.remove('hidden'); loadingUI.loader.classList.add('hidden'); loadingUI.loader.classList.remove('flex');
    }

    /**
     * Gemini APIを用いて早押しクイズの問題文を生成する
     * @returns {Promise<void>}
     */
    async generateQuestionsWithAI() {
        const input = await this._validateGenerationInput();
        if (!input) return;
        
        const { targetSet, genre, subgenre, topic, requestedCount, difficulty } = input;
        const state = this._initializeGenerationState(targetSet);
        const loadingUI = this._setupGenerationUI();

        let retries = 0;
        try {
            while (state.accepted.length < requestedCount && retries < 3) {
                const shortage = requestedCount - state.accepted.length;
                if (loadingUI.loadingTitle) loadingUI.loadingTitle.textContent = `解答と出題観点を設計中... (${state.accepted.length}/${requestedCount})`;
                const plansRaw = await this.generateQuestionPlansWithAI({ count: shortage, genre, subgenre, topic, difficulty, excludedAnswers: [...state.usedAnswers], excludedAngles: state.acceptedAngles });
                const plans = this._validateAndFilterPlans(plansRaw, state.usedAnswers, genre, subgenre, state.defs);
                if (!plans.length) { retries++; continue; }
                await this._generateAndAcceptBatch(plans, difficulty, state.accepted, state.acceptedAngles, state.usedAnswers, state.existingQuestions, loadingUI);
                retries++;
            }
            this._finalizeGeneration(targetSet, state.accepted, difficulty, requestedCount, loadingUI);
        } catch (e) {
            console.error('AI question generation error', e);
            this.app.showToast('生成失敗: ' + e.message, 'error');
            loadingUI.btn.classList.remove('hidden'); loadingUI.loader.classList.add('hidden'); loadingUI.loader.classList.remove('flex');
        }
    }

    /**
     * Gemini APIを用いて早押しクイズの問題文を生成する
     * @param {*} answer 
     * @param {*} contextText 
     * @param {*} difficulty 
     * @returns 
     */
    async generateDerivativeData(answer, contextText = '', difficulty = '中級') {
        const genreCandidates = Object.entries(this.app.getAISubgenres()).map(([g, subs]) => `${g}: ${subs.join('、')}`).join('\n');
        const prompt = `「${answer}」が唯一の解答となる早押しクイズ問題を1問作成してください。前半は広い手掛かり、後半ほど特定しやすくしてください。すべての手掛かりを内部でファクトチェックし、確実な事実だけを使用してください。解答自体を問題文に書かないでください。難易度:${difficulty}。explanationは、${this.getAIExplanationInstruction()}\n候補からgenreと、その配下のsubgenreを1つずつ選んでください。\n${genreCandidates}\n出力JSON:{"q":"問題文","a":"${answer}","explanation":"解説","genre":"ジャンル","subgenre":"サブジャンル"}\n参考情報:${contextText}`;
        const data = this.app.parseAIJSON(await this.fetchGemini(prompt, true));
        const defs = this.app.getAISubgenres(), genre = String(data.genre || '').trim(), subgenre = String(data.subgenre || '').trim();
        if (!data.q || !defs[genre] || !defs[genre].includes(subgenre)) throw new Error(`「${answer}」の生成結果が不正です`);
        return { q: String(data.q).trim(), a: answer, explanation: String(data.explanation || '').trim(), genre, subgenre, selected: true };
    }

    /**
     * メモ取り込み候補をAIで補正する
     * @returns {Promise<void>}
    */
    async normalizeMemoAnswersWithAI() {
        if (!this.app.geminiApiKey) return this.app.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        const inputs = this.app.parseMemoCandidates();
        if (!inputs.length) return this.app.showToast('メモを1行以上入力してください', 'error');
        if (inputs.length > MAX_MEMO_QUESTIONS) return this.app.showToast(`有効な解答候補は${MAX_MEMO_QUESTIONS}件以内にしてください`, 'error');
        const loader = document.getElementById('ai-loading'); loader.classList.remove('hidden'); loader.classList.add('flex');
        try {
            const prompt = `次のメモをクイズ作成用に補正してください。answerは解答候補、supplementは同姓同名や同名対象を区別し、問題の趣旨を決める補足事項です。タイプミス、誤変換、聞き取りミスを直してください。人物名は補足事項が示す対象に合う正式なフルネームにし、作品・施設・組織・出来事も正式名称にしてください。補足事項も誤記が明らかな場合は補正してください。別人・別対象に取り違えないでください。判断不能なら原文を維持してください。入力順を維持し、JSON配列のみ返してください。形式:[{"input":"原文","answer":"補正した解答","supplement":"補正した補足事項","note":"短い理由"}]\n入力:${JSON.stringify(inputs)}`;
            const parsed = this.app.parseAIJSON(await this.fetchGemini(prompt, true));
            this.memoNormalizedAnswers = inputs.map((input, i) => { const x = (Array.isArray(parsed) ? parsed : [])[i] || {}; return { input: input.raw, answer: String(x.answer || input.answer).trim(), supplement: String(x.supplement || input.supplement || '').trim(), note: String(x.note || '').trim() }; });
            const list = document.getElementById('ai-memo-normalized-list');
            list.innerHTML = this.memoNormalizedAnswers.map((x, i) => `<div class="bg-white border border-soft-green-200 rounded-xl p-3 space-y-2"><p class="text-xs text-soft-green-500">入力: ${this.app.escapeHTML(x.input)}${x.note ? ' / ' + this.app.escapeHTML(x.note) : ''}</p><div><label class="text-xs font-bold text-soft-green-700">解答候補</label><input class="w-full px-3 py-2 border rounded-lg text-sm font-semibold" value="${this.app.escapeHTML(x.answer)}" oninput="app.aiManager.memoNormalizedAnswers[${i}].answer=this.value"></div><div><label class="text-xs font-bold text-soft-green-700">補足事項</label><input class="w-full px-3 py-2 border rounded-lg text-sm" value="${this.app.escapeHTML(x.supplement)}" oninput="app.aiManager.memoNormalizedAnswers[${i}].supplement=this.value"></div></div>`).join('');
            document.getElementById('btn-generate-memo').textContent = `${this.memoNormalizedAnswers.length}問を一括作成`;
            document.getElementById('ai-memo-normalized').classList.remove('hidden');
            document.getElementById('ai-memo-preview').classList.add('hidden');
        } catch (e) { this.app.showToast('名称補正に失敗しました: ' + e.message, 'error'); }
        finally { loader.classList.add('hidden'); loader.classList.remove('flex'); }
    }

    /**
     * Gemini APIを用いてメモ取り込み候補から問題文を生成する
     * @returns {Promise<void>}
     */
    async generateMemoQuestions() {
        const candidates = (this.memoNormalizedAnswers || []).map(x => ({ answer: String(x.answer || '').trim(), supplement: String(x.supplement || '').trim() })).filter(x => x.answer);
        if (!candidates.length || candidates.length > MAX_MEMO_QUESTIONS) return this.app.showToast(`補正済み候補を1〜${MAX_MEMO_QUESTIONS}件にしてください`, 'error');
        const targetSetId = await this.app.dataManager.getTargetSetId('ai-target-set'); if (!targetSetId) return;
        const target = this.app.studySets.find(s => s.id === targetSetId), available = Math.min(MAX_QUESTIONS_PER_SET - target.questions.length, MAX_TOTAL_QUESTIONS - this.app.getTotalQuestionCount());
        if (candidates.length > available) return this.app.showToast(`登録可能数は残り${available}問です`, 'error');
        const loader = document.getElementById('ai-loading'); loader.classList.remove('hidden'); loader.classList.add('flex');
        try {
            // 同名でも補足事項が異なれば別候補として生成する。既存解答との重複は保存時に問題文も含めて確認する。
            const seen = new Set(), unique = [];
            candidates.forEach(x => { const k = this.app.normalizeAnswerForDuplicateCheck(x.answer) + '|' + this.app.normalizeAnswerForDuplicateCheck(x.supplement); if (k && !seen.has(k)) { seen.add(k); unique.push(x); } });
            const difficulty = document.getElementById('ai-memo-difficulty').value;
            const results = await this.app.mapWithConcurrency(unique, 2, async x => { try { const context = x.supplement ? `補足事項「${x.supplement}」で示される人物・対象だけを扱い、同姓同名・同名の別対象と混同しないこと。問題文の手掛かりはこの補足事項の趣旨に合わせること。` : 'メモ取り込みで指定された解答候補'; const data = await this.generateDerivativeData(x.answer, context, difficulty); data.supplement = x.supplement; return data; } catch (e) { return { a: x.answer, supplement: x.supplement, error: e.message, selected: false }; } });
            this.pendingMemoQuestions = results;
            document.getElementById('ai-memo-preview-list').innerHTML = results.map((x, i) => x.error ? `<div class="border border-red-200 bg-red-50 rounded-xl p-3"><p class="font-bold text-red-700">${this.app.escapeHTML(x.a)}${x.supplement ? '（' + this.app.escapeHTML(x.supplement) + '）' : ''}</p><p class="text-xs text-red-600">${this.app.escapeHTML(x.error)}</p></div>` : `<label class="block border border-soft-green-200 bg-white rounded-xl p-4"><div class="flex gap-3"><input type="checkbox" checked onchange="app.aiManager.pendingMemoQuestions[${i}].selected=this.checked"><div><p class="font-bold text-amber-800">${this.app.escapeHTML(x.a)}${x.supplement ? ' <span class="text-xs text-soft-green-600">（' + this.app.escapeHTML(x.supplement) + '）</span>' : ''}</p><p class="text-sm mt-2">${this.app.escapeHTML(x.q)}</p></div></div></label>`).join('');
            document.getElementById('ai-memo-preview').classList.remove('hidden');
        } catch (e) { this.app.showToast('問題生成に失敗しました: ' + e.message, 'error'); }
        finally { loader.classList.add('hidden'); loader.classList.remove('flex'); }
    }

    /**
     * 生成済みのメモ問題を保存する
     * @returns {Promise<void>}
     */
    async saveMemoQuestions() {
        const targetSetId = await this.app.dataManager.getTargetSetId('ai-target-set'); if (!targetSetId) return;
        const target = this.app.studySets.find(s => s.id === targetSetId), items = (this.pendingMemoQuestions || []).filter(x => x.selected && !x.error);
        const available = Math.min(MAX_QUESTIONS_PER_SET - target.questions.length, MAX_TOTAL_QUESTIONS - this.app.getTotalQuestionCount());
        const batchKeys = new Set();
        const saved = []; items.slice(0, available).forEach(x => {
            const k = this.app.normalizeAnswerForDuplicateCheck(x.a) + '|' + this.app.normalizeAnswerForDuplicateCheck(x.supplement || '');
            const exactQuestionExists = target.questions.some(q => this.app.normalizeAnswerForDuplicateCheck(q.a) === this.app.normalizeAnswerForDuplicateCheck(x.a) && this.app.textSimilarity(q.q, x.q) >= 0.78);
            if (!batchKeys.has(k) && !exactQuestionExists) { batchKeys.add(k); target.questions.push(this.app.createQuestionData(x.q, x.a, x.explanation, { genre: x.genre, subgenre: x.subgenre, difficulty: document.getElementById('ai-memo-difficulty').value })); saved.push(x); }
        });
        this.app.saveStudySets(); this.app.updateSetSelectors(); this.app.resetMemoImport(false); this.app.showToast(`${saved.length}問を保存しました`, 'success');
    }

    /**
     * Gemini APIを用いて問題文を再生成する
     * @returns 
     */
    async regenerateQuestionForDetail() {
        if (!this.app.geminiApiKey) return this.app.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        const q = document.getElementById('detail-question-q').value.trim(), a = document.getElementById('detail-question-a').value.trim(); if (!q || !a) return this.app.showToast('問題文と解答を入力してください', 'error');
        const checkedPolicy = document.querySelector('input[name="regenerate-policy"]:checked');
        const policy = checkedPolicy && checkedPolicy.value ? checkedPolicy.value : 'correct';
        this.app.closeRegeneratePolicyModal();
        const instruction = policy === 'current' ? '元の問題文の事実関係を維持・確認したうえで、解答に関する現在または直近の確実に確認できる情報を自然な手掛かりとして組み入れてください。変動しやすい数値や確認できない情報は使わないでください。' : '問題文中の事実誤認、年代・人物・作品等の取り違え、時制が一致しない表現、基準時点が曖昧な表現を修正してください。確認できない手掛かりは削除してください。';
        this.app.showToast('問題文を再作成しています...', 'info');
        try { const prompt = `次の早押しクイズ問題を、解答を変更せずに再作成してください。\n方針:${instruction}\n全手掛かりを内部でファクトチェックし、確実な事実だけを使用してください。早押しクイズらしく前半は広い手掛かり、後半ほど特定しやすい構成にしてください。解答そのものは問題文に書かないでください。出力は問題文のみです。\n元の問題文:${q}\n解答:${a}`; const result = (await this.fetchGemini(prompt, false)).trim().replace(/^```[a-z]*|```$/gi, '').trim(); if (!result) throw new Error('問題文を再作成できませんでした'); this.pendingRegeneratedQuestion = { before: q, after: result, policy }; document.getElementById('regenerate-before-text').textContent = q; document.getElementById('regenerate-after-text').textContent = result; document.getElementById('regenerate-compare-policy').textContent = policy === 'current' ? '方針: 現在・直近の情報を組み入れる' : '方針: 誤り・時制を修正'; const m = document.getElementById('regenerate-compare-modal'), p = document.getElementById('regenerate-compare-panel'); m.classList.remove('hidden'); void m.offsetWidth; m.classList.remove('opacity-0'); p.classList.remove('scale-95'); } catch (e) { this.app.showToast('問題再作成に失敗しました: ' + e.message, 'error'); }
    }

    /**
     * 再作成後の問題文を編集欄へ反映する
     * @returns 
     */
    applyRegeneratedQuestion() {
         if (!this.pendingRegeneratedQuestion) return;
        document.getElementById('detail-question-q').value = this.pendingRegeneratedQuestion.after; 
        this.pendingRegeneratedQuestion = null; 
        this.app.closeRegenerateCompareModal(); 
        this.app.showToast('再作成後の問題文を編集欄へ反映しました。保存してください', 'success');
    }

    /**
     * Gemini APIを用いて解答を再生成する
     * @returns 
     */
    async regenerateAnswerForQuestion() {
        if (!this.app.geminiApiKey) return this.app.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        const question = document.getElementById('detail-question-q').value.trim();
        const currentAnswer = document.getElementById('detail-question-a').value.trim();
        if (!question) return this.app.showToast('問題文を入力してください', 'error');
        const btn = document.getElementById('detail-ai-answer-btn');
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '確認中...';
        btn.classList.add('opacity-70', 'cursor-not-allowed');
        try {
            const prompt = `次のクイズ問題について、現在または直近の確実な事実に基づく正しい解答を1つ作成してください。時点によって変わる役職者、記録、制度、名称などは最新の状態を優先してください。問題文が過去の時点を明示している場合は、その時点に対応する解答にしてください。固有名詞は正式名称を使用してください。説明、理由、引用符、Markdownは付けず、解答だけを出力してください。\n問題文:${question}\n現在登録されている解答:${currentAnswer || '未設定'}`;
            const answer = (await this.fetchGemini(prompt, false)).trim().replace(/^```[a-z]*|```$/gi, '').trim();
            if (!answer) throw new Error('解答候補を作成できませんでした');
            document.getElementById('detail-question-a').value = answer.replace(/^[「『"']|[」』"']$/g, '').trim();
            this.app.showToast('解答候補を編集欄へ反映しました。内容を確認して保存してください', 'success');
        } catch (e) {
            this.app.showToast('解答再作成に失敗しました: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = oldText;
            btn.classList.remove('opacity-70', 'cursor-not-allowed');
        }
    }

    /**
     * Gemini APIを用いて誤読されやすい固有名詞の読みを生成する
     * @returns 
     */
    async generatePronunciationCandidatesWithAI() { 
        const q = this.app.pronunciationTargetQuestion; 
        if (!this.app.geminiApiKey) return this.app.showToast('Gemini APIキーを設定してください', 'error'); 
        const l = document.getElementById('pronunciation-loading'), b = document.getElementById('pronunciation-ai-btn'); 
        l.classList.remove('hidden'); l.classList.add('flex'); b.disabled = true; 
        try { 
            const parsed = this.app.parseAIJSON(await this.fetchGemini(`問題文と解答から音声で誤読されやすい固有名詞を抽出し、文脈に合う読みをひらがなで示してください。入力に実在する完全一致文字列のみ。JSON配列のみ:[{"word":"対象","pronunciation":"よみ"}]\n問題文:${q.q}\n解答:${q.a}`, true)); 
            const globals = new Set(this.app.dictionary.map(x => x.word)); 
            let added = 0; 
            (Array.isArray(parsed) ? parsed : []).forEach(x => { 
                const word = String(x.word || '').trim(), pronunciation = String(x.pronunciation || x.reading || '').trim(); 
                if (!word || !pronunciation || globals.has(word) || (!q.q.includes(word) && !q.a.includes(word))) return; 
                if (!this.pronunciationCandidates.some(c => c.word === word)) { 
                    this.pronunciationCandidates.push({ word, pronunciation, selected: true, scope: 'question' }); 
                    added++; 
                } 
            }); 
            this.app.renderPronunciationCandidates(); 
            this.app.showToast(added ? `${added}件の候補を追加しました` : '新しい候補はありませんでした', added ? 'success' : 'info'); 
        } catch (e) { 
            this.app.showToast('AI候補作成に失敗しました: ' + e.message, 'error'); 
        } finally { 
            l.classList.add('hidden'); l.classList.remove('flex'); b.disabled = false; 
        } 
    }
}
