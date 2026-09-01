/**
 * QuizManagerクラス
 * 早押しクイズの出題・スコアリング・進捗管理を担当するクラス。
 * 問題の難易度別選択、復習間隔の計算、学習段階の判定、
 * デリバティブ問題の生成など、クイズの中核ロジックを実装。
 */
class QuizManager {
    /**
     * コンストラクタ
     * @param {Object} app - メインアプリケーションインスタンス
     */
    constructor(app) {
        this.app = app;
    }

    /**
     * 問題の学習段階を判定
     * 問題の正答率、レベル、連続正答数から「未学習」「学習中」「定着途中」「定着済み」を返す
     * @param {Object} q - 問題データ
     * @returns {string} 学習段階（'未学習'|'学習中'|'定着途中'|'定着済み'）
     */
    getQuestionStage(q) {
        if (q.total === 0) return '未学習';

        const accuracy = q.accuracy !== null && q.accuracy !== undefined ? q.accuracy : (q.total > 0 ? q.correct / q.total : 0);

        if (q.level >= 4 && q.streak >= 3 && accuracy >= 0.85) return '定着済み';
        if (q.level >= 2 && q.streak >= 1) return '定着途中';

        return '学習中';
    }

    /**
     * 復習推奨間隔をミリ秒で取得
     * 問題のレベルに基づいて、次の復習までの推奨時間を計算。
     * レベルが高いほど間隔は長くなり、前回不正解の場合は2分に短縮
     * @param {Object} q - 問題データ
     * @returns {number} 復習推奨間隔（ミリ秒）
     */
    getReviewIntervalMs(q) {
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;

        if (q.total === 0 || !q.lastAnsweredAt) return 0;
        if (q.lastResult === false) return 2 * minute;

        const intervals = [
            10 * minute,
            4 * hour,
            1 * day,
            3 * day,
            7 * day,
            14 * day
        ];

        const level = Math.max(0, Math.min(5, Number(q.level) || 0));
        return intervals[level];
    }

    /**
     * 復習対象かどうかを判定
     * 最後の回答時刻から復習推奨間隔以上経過していればtrueを返す
     * @param {Object} q - 問題データ
     * @param {number} now - 現在時刻（ミリ秒）
     * @returns {boolean} 復習対象の場合true
     */
    isReviewDue(q, now) {
        if (q.total === 0 || !q.lastAnsweredAt) return true;
        return (now - q.lastAnsweredAt) >= this.getReviewIntervalMs(q);
    }

    /**
     * 問題の出題優先度スコアを計算
     * 経過時間、正答率、レベル、連続正答数、学習段階などの複合要素から
     * 出題すべき優先度を0.05～数値の範囲で算出
     * @param {Object} q - 問題データ
     * @param {number} now - 現在時刻（ミリ秒）
     * @returns {number} 優先度スコア
     */
    scoreQuestion(q, now) {
        if (q.total === 0) {
            return 1.0 + Math.random() * 0.5;
        }

        const accuracy = q.accuracy !== null && q.accuracy !== undefined ? q.accuracy : (q.correct / q.total);
        const wrongCount = Math.max(0, q.total - q.correct);

        const elapsed = q.lastAnsweredAt
            ? now - q.lastAnsweredAt
            : Number.MAX_SAFE_INTEGER;

        const targetInterval = this.getReviewIntervalMs(q) || 1;
        const elapsedFactor = Math.min(3, elapsed / targetInterval);

        const difficultyFactor = 1 - accuracy;
        const streakFactor = 1 / (1 + Math.max(0, q.streak || 0));
        const levelFactor = (5 - Math.max(0, Math.min(5, q.level || 0))) / 5;
        const wrongFactor = Math.min(2, Math.log1p(wrongCount));
        const recentWrongBonus = q.lastResult === false ? 1.4 : 0;

        const stage = this.getQuestionStage(q);
        const stageBonus =
            stage === '学習中' ? 0.9 :
                stage === '定着途中' ? 0.35 :
                    stage === '定着済み' ? -0.6 : 0;

        const masteryFactor = 1 - (this.app.getMasteryMetrics(q).score / 100);

        const baseScore =
            (2.2 * elapsedFactor) +
            (2.0 * difficultyFactor) +
            (1.0 * masteryFactor) +
            (1.2 * streakFactor) +
            (1.0 * levelFactor) +
            (0.7 * wrongFactor) +
            recentWrongBonus +
            stageBonus;

        return Math.max(0.05, baseScore * (0.8 + Math.random() * 0.4));
    }

    /**
     * スコアに基づいて重み付けランダム選択を実行
     * 各問題のスコアを確率の重みとして、ルーレット選択で出題問題を決定
     * @param {Array} candidates - {index, score}を持つ候補問題の配列
     * @returns {number} 選択された問題のインデックス
     */
    pickWeightedQuestion(candidates) {
        const totalWeight = candidates.reduce(
            (sum, c) => sum + Math.max(0.05, c.score),
            0
        );

        let r = Math.random() * totalWeight;

        for (const c of candidates) {
            r -= Math.max(0.05, c.score);
            if (r <= 0) return c.index;
        }

        return candidates[candidates.length - 1].index;
    }

    /**
     * 出題対象の優先度プール選択
     * 未学習問題がある場合は未学習問題のみ、ない場合は全問題を返す
     * @param {Array} candidates - 候補問題の配列
     * @param {number} now - 現在時刻（ミリ秒）
     * @returns {Array} 優先度プールとする問題の配列
     */
    choosePriorityPool(candidates, now) {
        if (!candidates || !candidates.length) return [];

        const unlearned = candidates.filter(c => (c.q.total || 0) === 0);
        if (unlearned.length) return unlearned;

        return candidates;
    }

    /**
     * 次に出題する問題のインデックスを選択
     * 除外問題を除いた全問題をスコアリングし、重み付けランダム選択で決定
     * @param {Array} questions - 問題の配列
     * @param {Set} excludedQuestionIds - セッション内で既出題の問題ID（除外対象）
     * @param {Object} targetSet - 対象の学習セット
     * @returns {number} 選択された問題のインデックス（全て出題済みの場合は-1）
     */
    selectNextQuestionIndex(questions, excludedQuestionIds = new Set(), targetSet = null) {
        const now = Date.now();

        const all = questions
            .map((q, index) => ({
                q,
                index,
                score: this.scoreQuestion(q, now)
            }))
            .filter(c => !excludedQuestionIds.has(this.app.getQuestionId(c.q)));

        if (!all.length) return -1;

        return this.pickWeightedQuestion(all);
    }

    /**
     * クイズ開始
     * 指定モード（音声/テキスト）でクイズを開始し、初問目の出題準備を実行
     * @param {string} mode - クイズモード（'voice'|'text'）デフォルト:'voice'
     */
    startQuiz(mode = 'voice') {
        this.app.quizMode = mode === 'text' ? 'text' : 'voice';
        const targetSet = this.app.studySets.find(s => s.id === this.app.activeSetId);
        if (!targetSet || targetSet.questions.length === 0) {
            return this.app.showToast('現在のセットに問題がありません', 'error');
        }

        this.app.quizSessionSeenQuestionIds = new Set();
        this.app.switchView('quiz');

        const sourceEl = document.getElementById('quiz-source-set');
        if (sourceEl) sourceEl.textContent = `出題元：${targetSet.name}`;

        const mobileSourceEl = document.getElementById('quiz-mobile-source-set');
        if (mobileSourceEl) mobileSourceEl.textContent = `出題元：${targetSet.name}`;

        this.nextQuestion();
    }

    /**
     * 次の問題を出題
     * 現在のセットから次の問題を選択・出題し、UIを更新。
     * 全問題を出題済みの場合はクイズを終了
     */
    nextQuestion() {
        if (this.app.synth) this.app.synth.cancel();
        this.stopTextReveal();

        const targetSet = this.app.studySets.find(s => s.id === this.app.activeSetId);
        if (!targetSet || !targetSet.questions.length) {
            this.app.currentQuestionIndex = -1;
            this.app.quizSessionSeenQuestionIds = new Set();
            this.app.switchView('dashboard');
            this.app.showToast('学習セット内の全問題を出題しました', 'success');
            return;
        }

        const questions = targetSet.questions;
        const selectedIndex = this.selectNextQuestionIndex(
            questions,
            this.app.quizSessionSeenQuestionIds || new Set(),
            targetSet
        );

        if (selectedIndex === -1) {
            this.app.currentQuestionIndex = -1;
            this.app.quizSessionSeenQuestionIds = new Set();
            this.app.switchView('dashboard');
            this.app.showToast('学習セット内の全問題を出題しました', 'success');
            return;
        }

        this.app.currentQuestionIndex = selectedIndex;
        const q = this.app.normalizeQuestionData(questions[this.app.currentQuestionIndex]);
        this.app.quizSessionSeenQuestionIds.add(this.app.getQuestionId(q));
        this.app.markQuestionSeenInCycle(targetSet, q);
        this.app.saveStudySets();

        const currentNo = this.app.quizSessionSeenQuestionIds.size;
        const totalQuestions = questions.length;
        const progressText = `${currentNo}問目／全${totalQuestions}問（${Math.round((currentNo / totalQuestions) * 100)}％完了）`;
        const progressEl = document.getElementById('quiz-progress');
        if (progressEl) progressEl.textContent = progressText;

        const mobileProgressEl = document.getElementById('quiz-mobile-progress');
        if (mobileProgressEl) mobileProgressEl.textContent = `${currentNo}/${totalQuestions}問・${Math.round((currentNo / totalQuestions) * 100)}％`;

        const statePlaying = document.getElementById('quiz-state-playing');
        const stateThinking = document.getElementById('quiz-state-thinking');
        const answerContainer = document.getElementById('answer-container');
        const btnShowAnswer = document.getElementById('btn-show-answer');
        if (statePlaying) statePlaying.classList.remove('hidden');
        if (stateThinking) stateThinking.classList.add('hidden');
        if (answerContainer) answerContainer.classList.add('hidden');
        if (btnShowAnswer) btnShowAnswer.classList.remove('hidden');

        const accuracyText = q.total > 0 ? Math.round((q.correct / q.total) * 100) : '--';
        const quizCurrentAccuracy = document.getElementById('quiz-current-accuracy');
        if (quizCurrentAccuracy) quizCurrentAccuracy.textContent = accuracyText;

        const mobileAccuracyEl = document.getElementById('quiz-mobile-accuracy');
        if (mobileAccuracyEl) mobileAccuracyEl.textContent = accuracyText;

        const quizQuestionText = document.getElementById('quiz-question-text');
        if (quizQuestionText) {
            quizQuestionText.textContent = q.q;
            quizQuestionText.classList.remove('hidden');
        }

        const quizAnswerText = document.getElementById('quiz-answer-text');
        if (quizAnswerText) quizAnswerText.textContent = q.a;

        const quizExplanationText = document.getElementById('quiz-explanation-text');
        if (quizExplanationText) quizExplanationText.textContent = q.explanation || '解説はありません。';

        const voiceIndicator = document.getElementById('quiz-voice-indicator');
        const textContainer = document.getElementById('quiz-text-reveal-container');
        if (this.app.quizMode === 'text') {
            if (voiceIndicator) voiceIndicator.classList.add('hidden');
            if (textContainer) textContainer.classList.remove('hidden');
            this.startTextReveal(q.q);
        } else {
            if (voiceIndicator) voiceIndicator.classList.remove('hidden');
            if (textContainer) textContainer.classList.add('hidden');

            const utterance = new SpeechSynthesisUtterance(this.app.applyPronunciations(q.q, q));
            this.app.currentVoiceCharIndex = 0;
            this.app.currentVoiceStartedAt = performance.now();
            this.app.currentVoiceEstimatedMs = Math.max(1000, Array.from(String(q.q || '')).length * 120 / 0.9);

            utterance.onboundary = (event) => {
                if (Number.isFinite(event.charIndex)) {
                    this.app.currentVoiceCharIndex = Math.max(this.app.currentVoiceCharIndex, event.charIndex);
                }
            };

            utterance.lang = 'ja-JP';
            utterance.rate = 0.9;
            const jpVoices = this.app.voices.filter(v => v.lang.includes('ja'));
            if (jpVoices.length > 0) utterance.voice = jpVoices[0];
            this.app.synth.speak(utterance);
        }
    }

    /**
     * 早押しボタン押下処理
     * テキスト/音声モードに応じて、現在の表示位置を記録し、
     * 問題解答状態に遷移。解答位置情報（charIndex）を保存
     */
    buzz() {
        const targetSet = this.app.studySets.find(s => s.id === this.app.activeSetId);
        const q = targetSet && targetSet.questions && this.app.currentQuestionIndex >= 0 ? targetSet.questions[this.app.currentQuestionIndex] : null;
        if (q) {
            const len = Math.max(1, String(q.q || '').length);
            let charIndex = 0;
            let elapsedMs = 0;
            let source = 'exact';

            if (this.app.quizMode === 'text') {
                charIndex = Math.max(1, Math.min(len, this.currentTextRevealIndex || 1));
                this.buzzDisplayText = String(q.q || '').slice(0, charIndex);
            } else {
                elapsedMs = Math.max(0, performance.now() - (this.app.currentVoiceStartedAt || performance.now()));
                charIndex = this.app.currentVoiceCharIndex;
                if (!charIndex) {
                    charIndex = Math.max(1, Math.min(len, Math.round(len * Math.min(1, elapsedMs / Math.max(1, this.app.currentVoiceEstimatedMs)))));
                    source = 'estimated';
                }
            }

            this.app.pendingBuzzRecord = {
                mode: this.app.quizMode,
                charIndex,
                totalChars: len,
                confirmPoint: this.app.getEffectiveConfirmPoint(q),
                elapsedMs: Math.round(elapsedMs),
                positionSource: source,
                answeredAt: Date.now()
            };
        }

        if (this.app.synth) this.app.synth.cancel();
        this.stopTextReveal();

        const quizQuestionText = document.getElementById('quiz-question-text');
        if (this.app.quizMode === 'text') {
            if (quizQuestionText) quizQuestionText.textContent = this.buzzDisplayText || quizQuestionText.textContent;
            if (quizQuestionText) quizQuestionText.classList.remove('hidden');
        } else {
            if (quizQuestionText) quizQuestionText.classList.add('hidden');
        }

        const statePlaying = document.getElementById('quiz-state-playing');
        const stateThinking = document.getElementById('quiz-state-thinking');
        if (statePlaying) statePlaying.classList.add('hidden');
        if (stateThinking) stateThinking.classList.remove('hidden');
    }

    /**
     * 解答を表示
     * 解答、解説をUIに表示。音声モードの場合は解答を音声で読上げ
     */
    showAnswer() {
        const btnShowAnswer = document.getElementById('btn-show-answer');
        const answerContainer = document.getElementById('answer-container');
        if (btnShowAnswer) btnShowAnswer.classList.add('hidden');
        if (answerContainer) answerContainer.classList.remove('hidden');

        const quizQuestionText = document.getElementById('quiz-question-text');
        if (quizQuestionText) quizQuestionText.classList.remove('hidden');

        const targetSet = this.app.studySets.find(s => s.id === this.app.activeSetId);
        const q = targetSet && targetSet.questions && this.app.currentQuestionIndex >= 0 ? targetSet.questions[this.app.currentQuestionIndex] : null;
        if (this.app.quizMode === 'voice' && q) {
            const utterance = new SpeechSynthesisUtterance(this.app.applyPronunciations(q.a, q));
            utterance.lang = 'ja-JP';
            this.app.synth.speak(utterance);
        }
    }

    /**
     * 解答結果を記録
     * 正誤を記録し、問題の正答数、レベル、連続正答数を更新。
     * 早押し位置情報を保存し、次問へ自動遷移
     * @param {boolean} isCorrect - 解答が正解かどうか
     */
    recordResult(isCorrect) {
        const targetSet = this.app.studySets.find(s => s.id === this.app.activeSetId);
        if (!targetSet || this.app.currentQuestionIndex < 0 || !targetSet.questions[this.app.currentQuestionIndex]) return;

        const q = this.app.normalizeQuestionData(targetSet.questions[this.app.currentQuestionIndex]);
        const wasCorrect = !!isCorrect;

        q.total += 1;
        if (wasCorrect) q.correct += 1;

        q.accuracy = q.total > 0 ? q.correct / q.total : 0;
        q.lastAnsweredAt = Date.now();
        q.lastResult = wasCorrect;

        if (this.app.pendingBuzzRecord) {
            q.buzzRecords.push({ ...this.app.pendingBuzzRecord, correct: wasCorrect });
            q.buzzRecords = q.buzzRecords.slice(-100);
        }

        this.app.pendingBuzzRecord = null;
        this.app.incrementTodayAnsweredCount();

        if (wasCorrect) {
            q.streak = (q.streak || 0) + 1;
            if (q.level === 0 || q.streak >= 2) q.level = Math.min(5, (q.level || 0) + 1);
        } else {
            q.streak = 0;
            q.level = Math.max(0, (q.level || 0) - 1);
        }

        targetSet.questions[this.app.currentQuestionIndex] = q;
        this.app.saveStudySets();
        setTimeout(() => this.nextQuestion(), 200);
    }

    /**
     * 問題をスキップ
     * 解答記録を破棄し、次の問題へ遷移
     */
    skipQuestion() {
        this.app.pendingBuzzRecord = null;
        setTimeout(() => this.nextQuestion(), 200);
    }

    /**
     * テキストモードの問題文アニメーション開始
     * 問題文を1文字ずつ表示する初速120msのアニメーションを開始
     * @param {string} text - 表示対象の問題文
     */
    startTextReveal(text) {
        this.stopTextReveal();
        const el = document.getElementById('quiz-text-reveal');
        if (!el) return;

        const chars = Array.from(String(text || ''));
        let index = 0;
        this.currentTextRevealIndex = 0;
        el.textContent = '';

        this.textRevealTimer = setInterval(() => {
            index += 1;
            this.currentTextRevealIndex = index;
            el.textContent = chars.slice(0, index).join('');
            if (index >= chars.length) this.stopTextReveal();
        }, 120);
    }

    /**
     * テキストモードの問題文アニメーション停止
     * 進行中のテキスト表示アニメーション（タイマー）をクリア
     */
    stopTextReveal() {
        if (this.textRevealTimer) {
            clearInterval(this.textRevealTimer);
            this.textRevealTimer = null;
        }
    }

    /**
     * デリバティブ問題作成フロー開始
     * 現在の問題文からGemini APIを使用して固有名詞を抽出し、
     * それを解答とする派生問題の生成フローを開始
     */
    async startDerivativeCreation() {
        if (!this.app.geminiApiKey) return this.app.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        const set = this.app.studySets.find(s => s.id === this.app.activeSetId);
        const current = set && set.questions && this.app.currentQuestionIndex >= 0 ? set.questions[this.app.currentQuestionIndex] : null;
        if (!current) return;

        this.openDerivativeModal();
        this.setDerivativeView('derivative-loading', '問題文から固有名詞を抽出中...');

        try {
                        const parsed = this.app.parseAIJSON(await this.app.fetchGemini(`次の早押しクイズ問題文から、
別のクイズの解答にできる固有名詞を
重複なしで最大6件抽出してください。

元の解答「${current.a}」は除外してください。

【重要ルール】

- 外国人名は可能な限りフルネームで出力する
- 作家・学者・芸術家・政治家・スポーツ選手も正式名称で出力する
- 地名・組織名・作品名は一般的な正式名称で出力する
- 日本史人物など単独表記が一般的なものは無理に拡張しない
- 不明な場合のみ元表記を維持する

例：
ワシントン → ジョージ・ワシントン
アインシュタイン → アルベルト・アインシュタイン
エジソン → トーマス・エジソン
徳川家康 → 徳川家康

出力は必ずJSON配列のみ

[
    {
        "word":"正式名称",
        "reason":"抽出理由"
    }
]

問題文:
${current.q}`, true));
            this.app.derivativeCandidates = (Array.isArray(parsed) ? parsed : []).map(x => ({ word: String(x.word || '').trim(), reason: String(x.reason || '').trim(), selected: false })).filter(x => x.word && x.word !== current.a).slice(0, 6);
            if (!this.app.derivativeCandidates.length) throw new Error('候補を抽出できませんでした');
            document.getElementById('derivative-candidate-list').innerHTML = this.app.derivativeCandidates.map((x, i) => `<label class="flex gap-3 p-4 rounded-xl border border-soft-green-200 hover:bg-amber-50 cursor-pointer"><input type="checkbox" onchange="app.derivativeCandidates[${i}].selected=this.checked"><span><span class="block font-bold text-soft-green-900">${this.app.escapeHTML(x.word)}</span><span class="block text-xs text-soft-green-600 mt-1">${this.app.escapeHTML(x.reason || '候補')}</span></span></label>`).join('');
            document.getElementById('derivative-step-text').textContent = '解答候補を複数選択してください';
            this.setDerivativeView('derivative-candidates');
        } catch (e) {
            this.closeDerivativeModal();
            this.app.showToast('固有名詞の抽出に失敗しました: ' + e.message, 'error');
        }
    }

    /**
     * デリバティブ問題作成モーダルを開く
     */
    openDerivativeModal() {
        const modal = document.getElementById('derivative-modal'), panel = document.getElementById('derivative-panel');
        modal.classList.remove('hidden'); void modal.offsetWidth; modal.classList.remove('opacity-0'); panel.classList.remove('scale-95');
    }
    /**
     * デリバティブ問題作成モーダルを閉じる
     */
    closeDerivativeModal() {
        const modal = document.getElementById('derivative-modal'), panel = document.getElementById('derivative-panel');
        modal.classList.add('opacity-0'); panel.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }

    /**
     * デリバティブ問題作成フローの表示ステップ切り替え
     * 「読み込み中」「候補選択」「プレビュー」のビューを切り替え
     * @param {string} view - 表示するビューID
     * @param {string} loadingText - 読み込み中の場合の表示テキスト
     */
    setDerivativeView(view, loadingText = '処理中...') {
        ['derivative-loading', 'derivative-candidates', 'derivative-preview'].forEach(id => document.getElementById(id).classList.add('hidden'));
        const target = document.getElementById(view); target.classList.remove('hidden');
        if (view === 'derivative-loading') { target.classList.add('flex'); document.getElementById('derivative-loading-text').textContent = loadingText; } else target.classList.remove('flex');
    }

    /**
     * デリバティブ候補の全選択/全非選択を切り替え
     */
    toggleAllDerivativeCandidates() {
        const all = (this.app.derivativeCandidates || []).every(x => x.selected);
        this.app.derivativeCandidates.forEach(x => x.selected = !all);
        document.querySelectorAll('#derivative-candidate-list input').forEach(x => x.checked = !all);
    }

    /**
     * デリバティブ作成フロー：候補選択画面に戻る
     */
    backToDerivativeCandidates() {
        this.app.pendingDerivativeQuestions = [];
        document.getElementById('derivative-step-text').textContent = '解答候補を複数選択してください';
        this.setDerivativeView('derivative-candidates');
    }

    /**
     * デリバティブ作成フロー：選択された候補から派生問題を生成
     * Gemini APIで各候補を解答とする問題文を生成し、プレビュー表示
     */
    async generateSelectedDerivativeQuestions() {
        const selected = (this.app.derivativeCandidates || []).filter(x => x.selected);
        if (!selected.length) return this.app.showToast('候補を1つ以上選択してください', 'error');
        const targetSet = this.app.studySets.find(s => s.id === this.app.activeSetId);
        const source = targetSet && targetSet.questions && this.app.currentQuestionIndex >= 0 ? targetSet.questions[this.app.currentQuestionIndex] : null;
        this.setDerivativeView('derivative-loading', '選択した候補の問題を作成中...');
        const results = await this.app.mapWithConcurrency(selected, 2, async x => {
            try { return await this.app.generateDerivativeData(x.word, source && source.q ? source.q : '', '中級'); }
            catch (e) {
                return {
                    a: x.word, error: e.message, selected: false
                };
            }
        });
        this.app.pendingDerivativeQuestions = results;
        document.getElementById('derivative-preview-list').innerHTML = results.map((x, i) => x.error ? 
            `<div class="border border-red-200 bg-red-50 rounded-xl p-3">
                <p class="font-bold text-red-700">${this.app.escapeHTML(x.a)}</p>
                <p class="text-xs">生成失敗: ${this.app.escapeHTML(x.error)}</p>
             </div>` : 
             `<label class="block border border-soft-green-200 rounded-xl p-4">
                <div class="flex gap-3">
                    <input type="checkbox" checked onchange="app.pendingDerivativeQuestions[${i}].selected=this.checked">
                    <div>
                        <p class="text-lg font-bold text-amber-900">${this.app.escapeHTML(x.a)}</p>
                        <p class="text-sm mt-2 whitespace-pre-wrap">${this.app.escapeHTML(x.q)}</p>
                    </div>
                </div>
              </label>`
            ).join('');
        const select = document.getElementById('derivative-target-set');
        select.innerHTML = this.app.studySets.map(x => `<option value="${x.id}">${this.app.escapeHTML(x.name)}</option>`).join('');
        select.value = this.app.activeSetId;
        document.getElementById('derivative-step-text').textContent = '内容を確認し、追加する問題を選択してください';
        this.setDerivativeView('derivative-preview');
    }

    /**
     * デリバティブ作成フロー：生成された派生問題を学習セットに追加
     * 選択された派生問題を指定セットに追加し、重複チェック・上限チェック実施
     */
    addDerivativeQuestions() {
        const target = this.app.studySets.find(s => s.id === document.getElementById('derivative-target-set').value), items = (this.app.pendingDerivativeQuestions || []).filter(x => x.selected && !x.error); if (!target || !items.length) return this.app.showToast('追加する問題を選択してください', 'error');
        const available = Math.min(MAX_QUESTIONS_PER_SET - target.questions.length, MAX_TOTAL_QUESTIONS - this.app.getTotalQuestionCount()), existing = new Set(target.questions.map(q => this.app.normalizeAnswerForDuplicateCheck(q.a))); const saved = [];
        items.slice(0, available).forEach(x => { const k = this.app.normalizeAnswerForDuplicateCheck(x.a); if (!existing.has(k)) { existing.add(k); target.questions.push(this.app.createQuestionData(x.q, x.a, x.explanation, { genre: x.genre, subgenre: x.subgenre })); saved.push(x); } });
        this.app.saveStudySets(); this.app.updateSetSelectors(); this.closeDerivativeModal(); this.app.pendingDerivativeQuestions = []; this.app.showToast(`${saved.length}問のデリバティブ問題を追加しました`, 'success');
    }

    /**
     * 現在の問題の解答をGoogle画像検索
     * 現在出題中の問題の解答で画像検索を実行
     */
    searchCurrentQuizImage() {
        const targetSet = this.app.studySets.find(s => s.id === this.app.activeSetId);
        const q = targetSet && targetSet.questions && this.app.currentQuestionIndex >= 0 ? targetSet.questions[this.app.currentQuestionIndex] : null;
        if (!q) return this.app.showToast('検索対象の問題が見つかりません', 'error');
        const url = 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(q.a);
        const opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) this.app.showToast('画像検索を開けませんでした。ポップアップ設定をご確認ください。', 'error');
    }
}

window.QuizManager = QuizManager;
