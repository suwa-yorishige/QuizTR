// app.modular.js

const app = {
    studySets: [],
    activeSetId: null,
    managerSetId: null,
    managerTab: 'overview',
    managerGenreStandard: 'aql',
    managerDistributionMetric: 'accuracy',
    bulkEditSetId: null,
    bulkEditSelectedIds: new Set(),
    dictionary: [],
    dailyStats: {},
    summaryPeriod: 30,
    currentQuestionIndex: -1,
    quizMode: 'voice',
    textRevealTimer: null,
    quizSessionSeenQuestionIds: new Set(),
    currentTextRevealIndex: 0,
    currentVoiceCharIndex: 0,
    currentVoiceStartedAt: 0,
    currentVoiceEstimatedMs: 0,
    pendingBuzzRecord: null,

    synth: window.speechSynthesis,
    voices: [],

    geminiApiKey: "",
    ttsApiKey: "",


    //問題一覧ページング用変数
    questionListPage: 1,
    questionListTotalPages: 1,
    bulkEditPage: 1,
    bulkEditTotalPages: 1,

    init() {
        //外部モジュールのロード
        this.dictionaryManager = new DictionaryManager(this);
        this.audioManager = new AudioManager(this);
        this.questionManager = new QuestionManager(this);
        this.quizManager = new QuizManager(this);

        this.dictionaryManager.load(); //辞書データ読み込み
        this.updateViewportHeight();
        window.addEventListener('resize', () => this.updateViewportHeight(), { passive: true });
        window.visualViewport.addEventListener('resize', () => this.updateViewportHeight(), { passive: true });
        window.visualViewport.addEventListener('scroll', () => this.updateViewportHeight(), { passive: true });
        this.loadData();
        this.normalizeLearningData();
        this.saveStudySets();
        this.updateSetSelectors();
        this.handleAIGenreChange();
        this.dictionaryManager.render();
        this.updateStats();

        this.synth.onvoiceschanged = () => {
            this.voices = this.synth.getVoices();
        };

        document.addEventListener('keydown', (e) => {
            const viewQuiz = document.getElementById('view-quiz');
            if (viewQuiz.classList.contains('hidden') || e.repeat) return;
            const statePlaying = document.getElementById('quiz-state-playing');
            const stateThinking = document.getElementById('quiz-state-thinking');
            const btnShowAnswer = document.getElementById('btn-show-answer');
            const answerContainer = document.getElementById('answer-container');
            const isPlaying = !statePlaying.classList.contains('hidden');
            const isThinking = !stateThinking.classList.contains('hidden');
            const isAnswerVisible = !answerContainer.classList.contains('hidden');
            if (e.code === 'Space') {
                if (isPlaying) { e.preventDefault(); this.buzz(); }
                else if (isThinking && !btnShowAnswer.classList.contains('hidden')) { e.preventDefault(); this.showAnswer(); }
                return;
            }
            const key = e.key.toLowerCase();
            if (isThinking && isAnswerVisible && key === 't') { e.preventDefault(); this.recordResult(true); }
            else if (isThinking && isAnswerVisible && key === 'f') { e.preventDefault(); this.recordResult(false); }
            else if (isThinking && isAnswerVisible && key === 's') { e.preventDefault(); this.skipQuestion(); }
            else if (isThinking && isAnswerVisible && key === 'e') { e.preventDefault(); this.openCurrentQuizQuestionDetail(); }
            else if (e.key === 'Escape') { e.preventDefault(); this.switchView('dashboard'); }
        });
    },

    updateViewportHeight() {
        const height = window.visualViewport.height || window.innerHeight;
        if (height > 0) document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
    },
    loadData() {
        try {
            const savedSets = localStorage.getItem('quiz_study_sets');
            if (savedSets) {
                this.studySets = JSON.parse(savedSets);
            } else {
                // v1.0からのマイグレーション
                const savedQ = localStorage.getItem('quiz_questions');
                if (savedQ) {
                    const questions = JSON.parse(savedQ);
                    if (questions.length > 0) {
                        this.studySets = [{
                            id: 'set-' + Date.now(),
                            name: '最初の学習セット',
                            questions: questions.slice(0, MAX_QUESTIONS_PER_SET)
                        }];
                    } else {
                        this.studySets = [this.createEmptySet('学習セット1')];
                    }
                    localStorage.removeItem('quiz_questions');
                } else {
                    this.studySets = [this.createEmptySet('学習セット1')];
                }
            }

            if (this.studySets.length > 0) {
                this.activeSetId = this.studySets[0].id;
                this.managerSetId = this.studySets[0].id;
            }

            const savedD = localStorage.getItem('quiz_dictionary');
            if (savedD) this.dictionary = JSON.parse(savedD);
            const savedDaily = localStorage.getItem('quiz_daily_stats');
            if (savedDaily) this.dailyStats = JSON.parse(savedDaily);

            this.geminiApiKey = localStorage.getItem('quiz_gemini_key') || "";
            this.ttsApiKey = localStorage.getItem('quiz_tts_key') || "";

            document.getElementById('setting-gemini-key').value = this.geminiApiKey;
            document.getElementById('setting-tts-key').value = this.ttsApiKey;
        } catch (e) {
            console.error("Data loading error", e);
            this.studySets = [this.createEmptySet('学習セット1')];
            if (this.studySets.length > 0) {
                this.activeSetId = this.studySets[0].id;
                this.managerSetId = this.studySets[0].id;
            }
        }
    },

    saveStudySets() {
        try {
            localStorage.setItem('quiz_study_sets', JSON.stringify(this.studySets));
            this.updateStats();
            if (!document.getElementById('view-manager').classList.contains('hidden')) {
                this.renderManagerStats();
            }
        } catch (e) {
            this.showToast('保存容量の上限に達しました。一部の問題を削除してください。', 'error');
        }
    },

    saveDailyStats() { localStorage.setItem('quiz_daily_stats', JSON.stringify(this.dailyStats)); },
    getTodayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
    getTodayAnsweredCount() { const key = this.getTodayKey(); return Number(this.dailyStats[key]) || 0; },
    incrementTodayAnsweredCount() { const key = this.getTodayKey(); this.dailyStats[key] = this.getTodayAnsweredCount() + 1; this.saveDailyStats(); },

    saveSettings() {
        this.geminiApiKey = document.getElementById('setting-gemini-key').value.trim();
        this.ttsApiKey = document.getElementById('setting-tts-key').value.trim();
        localStorage.setItem('quiz_gemini_key', this.geminiApiKey);
        localStorage.setItem('quiz_tts_key', this.ttsApiKey);
        this.showToast('APIキーを保存しました', 'success');
    },

    switchView(viewId) {
        if (viewId === 'csv-import') { setTimeout(() => { const b = document.getElementById('manager-question-set-select'); const a = document.getElementById('csv-export-set'); const c = document.getElementById('backup-set-select'); if (a && b) a.innerHTML = b.innerHTML; if (c && b) c.innerHTML = b.innerHTML; }, 50); }
        this.synth.cancel();
        this.stopTextReveal();
        if (this.audioElement) {
            this.audioElement.pause();
        }

        ['dashboard', 'csv-import', 'manager', 'dictionary', 'ai-generator', 'audio-export', 'settings', 'quiz'].forEach(id => {
            document.getElementById(`view-${id}`).classList.add('hidden');
        });
        document.getElementById(`view-${viewId}`).classList.remove('hidden');

        if (viewId === 'manager') {
            this.renderManagerStats();
            this.questionManager.renderQuestionList();
            this.questionManager.renderBulkEditList();
            this.switchManagerTab(this.managerTab || 'overview');
        }
    },

    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        document.getElementById('toast-message').textContent = message;
        document.getElementById('toast-icon').textContent = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';

        toast.classList.remove('translate-y-24', 'opacity-0');
        setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 4000);
    },
    showQuizShortcutHelp() {
        return this.showModal(
            'ショートカットキーの説明',
            'Space：出題中は早押し、問題文表示中は解答を表示\n' +
            'T：正解として記録\n' +
            'F：不正解として記録\n' +
            'S：スキップ\n' +
            'E：問題編集\n' +
            'Esc：クイズを終了してホームに戻る',
            '閉じる',
            'bg-soft-green-600 hover:bg-soft-green-700',
            false
        );
    },

    showPromptModal(title, message, defaultText = "", placeholder = "", maxLength = 20) {
        return new Promise((resolve) => {
            const modal = document.getElementById('custom-modal');
            const panel = document.getElementById('custom-modal-panel');
            const input = document.getElementById('modal-input');

            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-message').textContent = message;

            input.classList.remove('hidden');
            input.value = defaultText;
            input.placeholder = placeholder;
            if (maxLength) input.maxLength = maxLength;

            const btnConfirm = document.getElementById('modal-btn-confirm');
            const btnCancel = document.getElementById('modal-btn-cancel');
            btnCancel.classList.remove('hidden');
            btnConfirm.textContent = "決定";
            btnConfirm.className = "px-5 py-2.5 rounded-xl font-semibold text-white transition-colors shadow-md bg-soft-green-600 hover:bg-soft-green-700";

            const cleanup = () => {
                modal.classList.add('opacity-0');
                panel.classList.add('scale-95');
                setTimeout(() => {
                    modal.classList.add('hidden');
                    input.classList.add('hidden');
                }, 300);
                btnConfirm.removeEventListener('click', onConfirm);
                btnCancel.removeEventListener('click', onCancel);
            };

            const onConfirm = () => { cleanup(); resolve(input.value); };
            const onCancel = () => { cleanup(); resolve(null); };

            btnConfirm.addEventListener('click', onConfirm);
            btnCancel.addEventListener('click', onCancel);

            modal.classList.remove('hidden');
            void modal.offsetWidth;
            modal.classList.remove('opacity-0');
            panel.classList.remove('scale-95');

            setTimeout(() => input.focus(), 100);
        });
    },

    showModal(title, message, confirmText = "実行する", confirmColor = "bg-soft-green-600 hover:bg-soft-green-700", showCancel = true) {
        return new Promise((resolve) => {
            const modal = document.getElementById('custom-modal');
            const panel = document.getElementById('custom-modal-panel');
            const input = document.getElementById('modal-input');

            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-message').textContent = message;
            input.classList.add('hidden'); // Ensure input is hidden

            const btnConfirm = document.getElementById('modal-btn-confirm');
            const btnCancel = document.getElementById('modal-btn-cancel');
            btnConfirm.textContent = confirmText;
            btnConfirm.className = `px-5 py-2.5 rounded-xl font-semibold text-white transition-colors shadow-md ${confirmColor}`;
            btnCancel.classList.toggle('hidden', !showCancel);

            const cleanup = () => {
                modal.classList.add('opacity-0');
                panel.classList.add('scale-95');
                setTimeout(() => {
                    modal.classList.add('hidden');
                    btnCancel.classList.remove('hidden');
                }, 300);
                btnConfirm.removeEventListener('click', onConfirm);
                btnCancel.removeEventListener('click', onCancel);
            };

            const onConfirm = () => { cleanup(); resolve(true); };
            const onCancel = () => { cleanup(); resolve(false); };

            btnConfirm.addEventListener('click', onConfirm);
            if (showCancel) btnCancel.addEventListener('click', onCancel);

            modal.classList.remove('hidden');
            void modal.offsetWidth;
            modal.classList.remove('opacity-0');
            panel.classList.remove('scale-95');
        });
    },

    createEmptySet(name) {
        return {
            id: 'set-' + Date.now() + Math.random().toString(36).substring(2),
            name: name,
            questions: []
        };
    },

    createQuestionData(q, a, explanation = '', meta = {}) {
        const id = 'q-' + Date.now() + Math.random().toString(36).substring(2);
        return { id, questionId: id, q, a, explanation: explanation || '', genre: meta.genre || '', subgenre: meta.subgenre || '', difficulty: meta.difficulty || '', correct: 0, total: 0, accuracy: 0, lastAnsweredAt: null, lastResult: null, streak: 0, level: 0, confirmPoint: 0, buzzRecords: [] };
    },

    normalizeLearningData() {
        this.studySets.forEach(set => {
            set.cycleSeenQuestionIds = Array.isArray(set.cycleSeenQuestionIds) ? set.cycleSeenQuestionIds : [];
            set.cycleStartedAt = set.cycleStartedAt || null;
            set.questions = set.questions.map(q => this.normalizeQuestionData(q));
        });
    },

    normalizeQuestionData(q) {
        const id = q.id || q.questionId || ('q-' + Date.now() + Math.random().toString(36).substring(2));
        q.id = id; q.questionId = q.questionId || id;
        q.genre = String(q.genre || '');
        q.subgenre = String(q.subgenre || '');
        q.difficulty = String(q.difficulty || '');
        q.correct = Number.isFinite(Number(q.correct)) ? Number(q.correct) : 0;
        q.total = Number.isFinite(Number(q.total)) ? Number(q.total) : 0;
        q.accuracy = q.total > 0 ? q.correct / q.total : 0;
        q.lastAnsweredAt = q.lastAnsweredAt ? Number(q.lastAnsweredAt) : null;
        q.lastResult = (q.lastResult === true || q.lastResult === false) ? q.lastResult : null;
        q.confirmPoint = Math.max(0, Math.min(String(q.q || '').length, Number(q.confirmPoint) || 0));
        q.buzzRecords = Array.isArray(q.buzzRecords) ? q.buzzRecords.slice(-100) : [];
        q.streak = Number.isFinite(Number(q.streak)) ? Number(q.streak) : 0;
        if (!Number.isFinite(Number(q.level))) {
            const acc = q.total > 0 ? q.correct / q.total : 0;
            if (q.total === 0) q.level = 0;
            else if (q.total >= 6 && acc >= 0.9) q.level = 4;
            else if (q.total >= 4 && acc >= 0.75) q.level = 3;
            else if (acc >= 0.5) q.level = 2;
            else q.level = 1;
        } else q.level = Math.max(0, Math.min(5, Number(q.level)));
        return q;
    },

    escapeHTML(str) {
        str = String(str !== null && str !== undefined ? str : '');
        return str.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag]));
    },

    updateSetSelectors() {
        const sets = this.studySets;
        const createOptions = (includeNew) => {
            let html = sets.map(s => `<option value="${s.id}">${this.escapeHTML(s.name)}</option>`).join('');
            if (includeNew) html += `<option value="_new_" class="font-bold text-soft-green-600">＋ 新しいセットを作成</option>`;
            return html;
        };

        const dashboardSelect = document.getElementById('dashboard-active-set');
        if (dashboardSelect) { dashboardSelect.innerHTML = createOptions(false); dashboardSelect.value = this.activeSetId; }

        const managerSelect = document.getElementById('manager-active-set');
        if (managerSelect) { managerSelect.innerHTML = createOptions(false); managerSelect.value = this.managerSetId; }
        const qSetSelect = document.getElementById('manager-question-set-select');
        if (qSetSelect) { qSetSelect.innerHTML = createOptions(false); qSetSelect.value = this.managerSetId; }

        const csvSelect = document.getElementById('csv-target-set');
        if (csvSelect) csvSelect.innerHTML = createOptions(true);

        const audioSelect = document.getElementById('audio-export-target-set');
        if (audioSelect) audioSelect.innerHTML = createOptions(false);

        const aiSelect = document.getElementById('ai-target-set');
        if (aiSelect) aiSelect.innerHTML = createOptions(true);
    },

    getAISubgenres() {
        return {
            "理系": [
                "数学",
                "情報科学",
                "物理学",
                "化学",
                "医学",
                "生物種",
                "生物学",
                "地球科学",
                "天文学",
                "技術工学",
                "理系クロスオーバー",
                "理系その他"
            ],
            "文学": [
                "神話-日本神話",
                "神話-ギリシャ・ローマ神話",
                "神話-その他神話",
                "詩",
                "絵本・童話",
                "古文・漢文",
                "日本-散文-戦前",
                "日本-散文-戦後",
                "世界-アジア文学",
                "世界-英米文学",
                "世界-ドイツ文学",
                "世界-ロマンス諸語文学",
                "世界-ロシア文学",
                "世界-その他地域の文学",
                "文学クロスオーバー",
                "文学その他"
            ],
            "言葉": [
                "四字熟語・故事成語",
                "ことわざ・慣用句",
                "日常語彙・言い回し",
                "流行語・新語・俗語",
                "漢字",
                "英語",
                "外国語-英語以外",
                "言語学用語・文法",
                "言葉クロスオーバー",
                "言葉その他"
            ],
            "日本史": [
                "先史～古墳時代",
                "飛鳥・奈良時代",
                "平安時代",
                "鎌倉時代",
                "室町時代",
                "江戸時代",
                "明治・大正時代",
                "昭和-戦前戦中",
                "戦後日本史",
                "日本史クロスオーバー",
                "日本史その他"
            ],
            "世界史": [
                "ヨーロッパ史-ルネサンス以前",
                "ヨーロッパ史-フランス革命以前",
                "ヨーロッパ史-WWI以前",
                "ヨーロッパ史-第一次大戦以後",
                "中国史-隋まで",
                "中国史-唐～明",
                "中国史-清以降",
                "アジア史-WWI以前",
                "アジア史-第一次大戦以後",
                "イスラム世界史",
                "南北アメリカ史",
                "その他地域の歴史",
                "世界史クロスオーバー",
                "世界史その他"
            ],
            "地理": [
                "交通",
                "北海道地方",
                "東北地方",
                "関東地方",
                "中部地方",
                "近畿地方",
                "中国地方",
                "四国地方",
                "九州以南",
                "北米",
                "中南米",
                "アジア",
                "オセアニア",
                "ヨーロッパ",
                "アフリカ",
                "海・極地方",
                "地理学",
                "地理クロスオーバー",
                "地理その他"
            ],
            "公民": [
                "倫理(哲学・思想・心理学)",
                "社会",
                "法律・法学・犯罪",
                "日本の政治・制度",
                "世界の政治・制度",
                "運動・事件",
                "経済・経済学",
                "宗教",
                "疑似科学・オカルト",
                "教育",
                "公民クロスオーバー",
                "公民その他"
            ],
            "芸術": [
                "日本-絵画",
                "日本-彫刻",
                "世界-絵画",
                "世界-彫刻",
                "建築",
                "工芸・民芸",
                "デザイン・写真・映像",
                "クラシック音楽",
                "童謡・合唱曲",
                "伝統音楽・民族音楽",
                "楽器・音楽用語",
                "舞踊",
                "古典芸能-舞台-日本",
                "古典芸能-しゃべくり-日本",
                "芸術クロスオーバー",
                "芸術その他"
            ],
            "漫画・アニメ・ゲーム": [
                "アニメ",
                "漫画",
                "ライトノベル",
                "テレビゲーム",
                "特撮",
                "玩具・グッズ",
                "漫アゲクロスオーバー",
                "漫アゲその他"
            ],
            "生活": [
                "嗜好品",
                "食材",
                "料理・調理",
                "服飾・ファッション",
                "暦・行事・しきたり",
                "家庭の医学",
                "企業・商品",
                "インターネット",
                "娯楽・趣味",
                "生活至近",
                "生活クロスオーバー",
                "生活その他"
            ],
            "スポーツ": [
                "野球・ソフトボール",
                "サッカー・フットサル",
                "球技-除野球・サッカー",
                "陸上競技",
                "体操",
                "ウォータースポーツ",
                "格闘技・武道",
                "冬季競技",
                "公営ギャンブル",
                "レース競技",
                "スポーツイベント",
                "スポーツクロスオーバー",
                "スポーツその他"
            ],
            "芸能": [
                "芸能一般用語",
                "テレビ番組・ラジオ番組・CM",
                "邦画",
                "海外映画",
                "現代演劇",
                "お笑い",
                "俳優",
                "タレント・文化人",
                "邦楽-昭和以前",
                "邦楽-平成（～2009）",
                "邦楽-平成・令和（2010～）",
                "洋楽・海外音楽",
                "芸能クロスオーバー",
                "芸能その他"
            ],
            "ノンセク": [
                "ジャンル複合",
                "ジャンル不明"
            ]
        };
    },

    handleAIGenreChange() {
        const aiGenre = document.getElementById('ai-genre');
        const genre = aiGenre && aiGenre.value ? aiGenre.value : '';
        const subgenreContainer = document.getElementById('ai-subgenre-container');
        const subgenreSelect = document.getElementById('ai-subgenre');
        const topicContainer = document.getElementById('ai-topic-container');
        if (!subgenreContainer || !subgenreSelect || !topicContainer) return;
        if (!genre) {
            subgenreContainer.classList.add('hidden');
            topicContainer.classList.remove('hidden');
            subgenreSelect.innerHTML = '<option value=""></option>';
            return;
        }
        topicContainer.classList.add('hidden');
        subgenreContainer.classList.remove('hidden');
        const options = this.getAISubgenres()[genre] || [];
        subgenreSelect.innerHTML = '<option value=""></option>' + options.map(s => `<option value="${this.escapeHTML(s)}">${this.escapeHTML(s)}</option>`).join('');
    },

    changeActiveSet(id) {
        this.activeSetId = id;
        this.updateStats();
    },

    changeManagerSet(id) {
        this.managerSetId = id;
        this.questionListPage = 1;
        const set = this.studySets.find(s => s.id === id);
        if (set) document.getElementById('manager-set-name').value = set.name;
        const qSel = document.getElementById('manager-question-set-select');
        if (qSel) qSel.value = id; this.renderManagerStats();
        this.questionManager.renderQuestionList();
    },

    changeQuestionListSet(id) {
        this.changeManagerSet(id);
    },

    getTotalQuestionCount() { return this.studySets.reduce((sum, set) => sum + (set.questions ? set.questions.length : 0), 0); },
    switchManagerTab(tab) {
        this.managerTab = ['overview', 'questions', 'bulk'].includes(tab) ? tab : 'overview';
        document.querySelectorAll('.manager-overview-section').forEach(el => el.classList.toggle('hidden', this.managerTab !== 'overview'));
        document.querySelectorAll('.manager-questions-section').forEach(el => el.classList.toggle('hidden', this.managerTab !== 'questions'));
        document.querySelectorAll('.manager-bulk-section').forEach(el => el.classList.toggle('hidden', this.managerTab !== 'bulk'));
        const buttons = { overview: document.getElementById('manager-tab-btn-overview'), questions: document.getElementById('manager-tab-btn-questions'), bulk: document.getElementById('manager-tab-btn-bulk') };
        Object.entries(buttons).forEach(([key, button]) => { if (button) button.className = `flex-1 px-4 py-2 rounded-xl font-bold text-sm transition-colors ${this.managerTab === key ? 'bg-soft-green-600 text-white shadow-sm' : 'text-soft-green-800 hover:bg-soft-green-100'}`; });
        if (this.managerTab === 'questions') this.questionManager.renderQuestionList();
        if (this.managerTab === 'bulk') this.questionManager.renderBulkEditList();
    },
    getBulkQuestionKey(q) {
        const key = q && q.id ? q.id : (q && q.questionId ? q.questionId : '');
        return String(key);
    },
    changeBulkEditPage(delta) { this.goToBulkEditPage((this.bulkEditPage || 1) + delta); },
    goToBulkEditPage(page) {
        this.bulkEditPage = Math.max(1, Math.min(Number(page) || 1, this.bulkEditTotalPages || 1));
        this.questionManager.renderBulkEditList();
    },

    changeQuestionListPage(delta) {
        this.goToQuestionListPage(
            (this.questionListPage || 1) + delta);
    },
    goToQuestionListPage(page) {
        this.questionListPage = Math.max(1, Math.min(Number(page) || 1, this.questionListTotalPages || 1));
        this.questionManager.renderQuestionList();
    },
    switchDistributionTab(metric) { this.managerDistributionMetric = metric === 'mastery' ? 'mastery' : 'accuracy'; this.renderManagerStats(); },
    switchGenreAnalysisTab(standard) { this.managerGenreStandard = standard === 'qma' ? 'qma' : 'aql'; this.renderManagerStats(); },
    toQMAGenre(aqlGenre) { return QMA_GENRE_MAP[aqlGenre || ''] || 'ノンジャンル'; },

    async getTargetSetId(selectElementId, defaultSetName = '') {
        const val = document.getElementById(selectElementId).value;
        if (val === '_new_') {
            if (this.studySets.length >= MAX_SETS) {
                this.showToast(`学習セットは最大${MAX_SETS}個までです。`, 'error');
                document.getElementById(selectElementId).value = this.studySets[0].id;
                return null;
            }
            const initialSetName = String(defaultSetName || '').trim().substring(0, MAX_SET_NAME_LENGTH);
            const name = await this.showPromptModal('セットの作成', '新しい学習セットの名前を入力してください', initialSetName, '最大30文字', MAX_SET_NAME_LENGTH);
            if (name === null) {
                document.getElementById(selectElementId).value = this.studySets[0].id;
                return null;
            }
            const trimmedName = name.trim().substring(0, MAX_SET_NAME_LENGTH);
            if (!trimmedName) {
                this.showToast('セット名が無効です', 'error');
                document.getElementById(selectElementId).value = this.studySets[0].id;
                return null;
            }
            const newSet = this.createEmptySet(trimmedName);
            this.studySets.push(newSet);
            this.saveStudySets();
            this.updateSetSelectors();
            document.getElementById(selectElementId).value = newSet.id;
            return newSet.id;
        }
        return val;
    },

    async createNewSet() {
        if (this.studySets.length >= MAX_SETS) {
            return this.showToast(`学習セットは最大${MAX_SETS}個までです。`, 'error');
        }
        const name = await this.showPromptModal('学習セットの新規作成', '新しい学習セットの名前を入力してください', '', '最大30文字', MAX_SET_NAME_LENGTH);
        if (name === null) return;
        const trimmedName = name.trim().substring(0, MAX_SET_NAME_LENGTH);
        if (!trimmedName) return this.showToast('セット名が無効です', 'error');

        const newSet = this.createEmptySet(trimmedName);
        this.studySets.push(newSet);
        this.saveStudySets();
        this.updateSetSelectors();
        this.changeManagerSet(newSet.id);
        this.updateSetSelectors();
        this.showToast('新しいセットを作成しました', 'success');
    },

    async deleteManagerSet() {
        const set = this.studySets.find(s => s.id === this.managerSetId);
        const confirmed = await this.showModal('学習セットの削除', `学習セット「${set.name}」を削除しますか？\nセット内のすべての問題（${set.questions.length}問）も削除されます。`, '削除する', 'bg-red-600 hover:bg-red-700');
        if (!confirmed) return;

        this.studySets = this.studySets.filter(s => s.id !== this.managerSetId);

        if (this.studySets.length === 0) {
            this.studySets.push(this.createEmptySet('最初の学習セット'));
        }

        this.saveStudySets();
        if (!this.studySets.find(s => s.id === this.activeSetId)) {
            this.activeSetId = this.studySets[0].id;
        }
        this.updateSetSelectors();
        this.changeManagerSet(this.studySets[0].id);
        this.showToast('セットを削除しました', 'success');
    },

    renameManagerSet() {
        const input = document.getElementById('manager-set-name');
        const newName = input.value.trim().substring(0, MAX_SET_NAME_LENGTH);
        const set = this.studySets.find(s => s.id === this.managerSetId);

        if (!newName) {
            this.showToast('セット名を入力してください', 'error');
            input.value = set.name;
            return;
        }

        set.name = newName;
        this.saveStudySets();
        this.updateSetSelectors();
        this.showToast('セット名を変更しました', 'success');
    },

    async fetchGemini(prompt, isJson = false) {
        return await api.fetchGemini(this.geminiApiKey, prompt, isJson);
    },

    async fetchCloudTextToSpeechAPI(ssml) {
        return await api.fetchCloudTextToSpeechAPI(this.ttsApiKey, ssml);
    },

    async fetchGeminiSSML(text) {
        if (!this.geminiApiKey) {
            return `<speak>${this.dictionaryManager.applyDictionary(text)}</speak>`;
        }

        let dictPrompt = "";
        if (this.dictionary.length > 0) {
            dictPrompt = "以下の固有の読み方辞書を最優先で適用してください。\n" +
                this.dictionary.map(d => `${d.word}: ${d.pronunciation}`).join("\n") + "\n\n";
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
            return `<speak>${this.applyDictionary(text)}</speak>`;
        }
    },

    async handleFileUpload(event) {
        const input = event.target;
        const file = input.files[0];
        if (!file) return;

        const targetSetId = await this.getTargetSetId('csv-target-set', file.name);
        if (!targetSetId) {
            input.value = '';
            return;
        }
        const targetSet = this.studySets.find(s => s.id === targetSetId);

        if (targetSet.questions.length >= MAX_QUESTIONS_PER_SET) {
            this.showToast(`対象セットの登録上限(${MAX_QUESTIONS_PER_SET}問)に達しています。`, 'error');
            input.value = '';
            return;
        }

        const encoding = document.getElementById('csv-encoding').value || 'UTF-8';
        try {
            const text = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
                reader.readAsText(file, encoding);
            });
            await this.processCSVText(text, targetSet);
        } catch (err) {
            this.showToast(err.message || '予期せぬエラーが発生しました。', 'error');
            console.error(err);
        } finally {
            input.value = '';
        }
    },

    parseCSVContent(text) {
        const delimiter = (text.indexOf(',') === -1 && text.indexOf('\t') !== -1) ? '\t' : ',';
        const rows = [];
        let row = [];
        let cell = '';
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '"') {
                if (inQuotes && text[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === delimiter && !inQuotes) {
                row.push(cell);
                cell = '';
            } else if (char === '\n' && !inQuotes) {
                row.push(cell);
                if (row.some(c => c.trim() !== '')) rows.push(row);
                row = [];
                cell = '';
            } else {
                cell += char;
            }
        }
        if (cell || row.length > 0) {
            row.push(cell);
            if (row.some(c => c.trim() !== '')) rows.push(row);
        }
        return rows;
    },

    /**
     * 問題CSVテキストのパースと取り込み
     * @param {string} rawText 
     * @param {string} targetSet 
     */
    async processCSVText(rawText, targetSet) {
        let text = rawText;
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        if (text.includes('\uFFFD')) {
            throw new Error('文字化けを検出しました。文字コード(UTF-8 / Shift_JIS)を変更して再試行してください。');
        }
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const rows = this.parseCSVContent(text);
        let newItems = [];
        rows.forEach(r => {
            const q = (r[0] || '').trim();
            const a = (r[1] || '').trim();
            const explanation = (r[2] || '').trim();
            const genre = (r[3] || '').trim();
            const subgenre = (r[4] || '').trim();
            if (q && a) {
                newItems.push(this.createQuestionData(q, a, explanation, { genre, subgenre }));
            }
        });

        if (newItems.length === 0) {
            throw new Error('有効な問題データが見つかりませんでした。ファイル形式をご確認ください。');
        }

        const availableSpace = Math.min(MAX_QUESTIONS_PER_SET - targetSet.questions.length, MAX_TOTAL_QUESTIONS - this.getTotalQuestionCount());
        if (availableSpace <= 0) throw new Error(`登録上限に達しています（セット上限${MAX_QUESTIONS_PER_SET}問、アプリ全体上限${MAX_TOTAL_QUESTIONS}問）。`);

        if (newItems.length > availableSpace) {
            const confirmed = await this.showModal('上限オーバー', `セットの登録上限を超えるため、最初の${availableSpace}問のみ追加します。取り込みますか？`);
            if (!confirmed) return;
            newItems = newItems.slice(0, availableSpace);
        } else {
            const confirmed = await this.showModal('確認', `${newItems.length}問の問題があります。「${targetSet.name}」に取り込みますか？`);
            if (!confirmed) return;
        }

        const csvAddExplanation = document.getElementById('csv-add-explanation');
        const shouldAddExp = csvAddExplanation ? csvAddExplanation.checked : false;
        targetSet.questions.push(...newItems);
        this.saveStudySets();
        this.showToast(`${newItems.length}件の問題を取り込みました！`, 'success');

        const itemsNeedsExp = newItems.filter(item => !item.explanation);
        if (!shouldAddExp || itemsNeedsExp.length === 0) return;

        if (!this.geminiApiKey) {
            this.showToast('CSV取り込みは完了しました。Gemini APIキー未設定のため、解説自動生成はスキップしました。', 'info');
            return;
        }

        const targetItems = itemsNeedsExp.slice(0, CSV_EXPLANATION_LIMIT);
        const skippedCount = Math.max(0, itemsNeedsExp.length - targetItems.length);
        const uploadBtn = document.getElementById('btn-csv-upload-trigger');
        const loadingDiv = document.getElementById('csv-loading');
        const loadingText = document.getElementById('csv-loading-text');
        if (uploadBtn) uploadBtn.classList.add('hidden');
        if (loadingDiv) { loadingDiv.classList.remove('hidden'); loadingDiv.classList.add('flex'); }

        try {
            if (loadingText) loadingText.textContent = `CSV取り込み完了。AI解説生成中... (0/${targetItems.length})`;
            await this.fillExplanationsWithAI(targetItems, loadingText, CSV_EXPLANATION_BATCH_SIZE, CSV_EXPLANATION_PROMPT_LIMIT);
            this.saveStudySets();
            this.showToast(`AI解説を${targetItems.length}件追加しました${skippedCount ? `（上限超過のため${skippedCount}件は未生成）` : ''}`, 'success');
        } catch (e) {
            this.saveStudySets();
            this.showToast(e.message || 'CSV取り込みは完了しましたが、一部の解説生成に失敗しました。', 'error');
        } finally {
            if (uploadBtn) uploadBtn.classList.remove('hidden');
            if (loadingDiv) { loadingDiv.classList.add('hidden'); loadingDiv.classList.remove('flex'); }
        }
    },

    getAIExplanationInstruction() {
        return 'クイズの解説は1〜2文で簡潔にまとめ、問題文の言い換えや重複を避けて、別の観点・関連知識・背景知識を含めてください。最後に必ず「暗記のコツ:」から始まる、短く実用的な暗記ポイントを付けてください。';
    },
    buildAIExplanationPrompt(q, a) {
        return `${this.getAIExplanationInstruction()}\n出力は解説文のみ。\nQ:${q}\nA:${a}`;
    },
    buildBatchAIExplanationPrompt(items) {
        return `${this.getAIExplanationInstruction()}\n各問題について同じ品質・構成で作成してください。\n必ず以下のJSON配列形式（文字列の配列）のみを出力してください。Markdownの装飾は不要です。\n["問題0の解説", "問題1の解説", ...]\n` + items.map((item, idx) => `[${idx}] Q:${item.q} A:${item.a}`).join("\n");
    },
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
    },

    parseAIJSON(text) { const clean = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim(); try { return JSON.parse(clean); } catch (e) { const m = clean.match(/(\[[\s\S]*\]|\{[\s\S]*\})/); if (m) return JSON.parse(m[1]); throw e; } },
    getGenreOptionsHTML(selectedGenre = '', includeAll = false) { const genres = Object.keys(this.getAISubgenres()); let html = includeAll ? '<option value="">ジャンル: すべて</option><option value="__UNSET__">未設定</option>' : '<option value="">未設定</option>'; html += genres.map(g => `<option value="${this.escapeHTML(g)}" ${g === selectedGenre ? 'selected' : ''}>${this.escapeHTML(g)}</option>`).join(''); return html; },
    getSubgenreOptionsHTML(genre = '', selectedSubgenre = '', includeAll = false) { const prefix = includeAll ? '<option value="">サブジャンル: すべて</option>' : '<option value="">未設定</option>'; if (genre === '__UNSET__') return prefix; const options = genre ? (this.getAISubgenres()[genre] || []) : []; return prefix + options.map(x => `<option value="${this.escapeHTML(x)}" ${x === selectedSubgenre ? 'selected' : ''}>${this.escapeHTML(x)}</option>`).join(''); },

    exportManagerQuestionsCSV() {
        const setSelect = document.getElementById('manager-question-set-select');
        const setId = setSelect && setSelect.value ? setSelect.value : this.managerSetId;
        const target = this.studySets.find(set => set.id === setId);
        if (!target) return this.showToast('保存対象の学習セットが見つかりません', 'error');
        if (!target.questions.length) return this.showToast('保存する問題がありません', 'error');
        const rows = target.questions.map(q => [q.q || '', q.a || '', q.explanation || '', q.genre || '', q.subgenre || '']);
        const csv = rows.map(row => row.map(value => this.escapeCSVValue(value)).join(',')).join('\r\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const safeName = String(target.name || 'questions').replace(/[\\/:*?"<>|]/g, '_');
        link.download = `${safeName}_questions.csv`;
        document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
        this.showToast(`「${target.name}」の${rows.length}問をCSV保存しました`, 'success');
    },

    syncConfirmPointLimit() {
        const text = document.getElementById('detail-question-q').value || '';
        const input = document.getElementById('detail-confirm-point');
        const limit = document.getElementById('detail-confirm-point-limit');
        if (input) { input.max = Math.max(1, text.length); if (Number(input.value) > text.length) input.value = text.length || 1; }
        if (limit) limit.textContent = `/ 全${text.length}文字`;
        this.renderConfirmPointPreview();
    },
    renderConfirmPointPreview() {
        const text = document.getElementById('detail-question-q').value || '';
        const confirmPointInput = document.getElementById('detail-confirm-point');
        const point = Math.max(0, Math.min(text.length, Number(confirmPointInput && confirmPointInput.value ? confirmPointInput.value : text.length) || text.length));
        const el = document.getElementById('detail-confirm-point-preview');
        if (el) el.textContent = text ? `${text.slice(0, point)}｜${text.slice(point)}` : '問題文を入力してください';
    },
    getEffectiveConfirmPoint(q) {
        const safeQ = q || {};
        const len = Math.max(1, String(safeQ.q || '').length);
        return Math.max(1, Math.min(len, Number(safeQ.confirmPoint) || len));
    },
    getBuzzPositionScore(q, record) {
        const safeQ = q || {};
        const len = Math.max(1, String(safeQ.q || '').length), cp = this.getEffectiveConfirmPoint(q);
        const recordData = record || {};
        const pos = Math.max(0, Math.min(len, Number(recordData.charIndex) || len));
        if (pos <= cp) return 1;
        return Math.max(0, 1 - ((pos - cp) / Math.max(1, len - cp)));
    },
    getMasteryMetrics(q) {
        q = this.normalizeQuestionData(q); const total = q.total || 0, correct = q.correct || 0;
        const accuracy = total ? correct / total : 0;
        const accuracyConfidence = (accuracy * 0.7) + (Math.min(1, correct / 5) * 0.3);
        const valid = q.buzzRecords.filter(r => r && r.correct === true && Number.isFinite(Number(r.charIndex)));
        const timing = valid.length ? valid.reduce((sum, r) => sum + this.getBuzzPositionScore(q, r), 0) / valid.length : 0;
        const rawScore = Math.round((accuracyConfidence * 75) + (timing * 25));
        const score = correct >= 2 ? rawScore : Math.min(rawScore, 80);
        const ratios = valid.map(r => Number(r.charIndex) / this.getEffectiveConfirmPoint(q));
        const avgRatio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
        return { score, accuracy, timing, avgRatio, avgRatioText: avgRatio === null ? '--' : `${Math.round(avgRatio * 100)}%` };
    },
    handleQuestionDetailGenreChange() { const g = document.getElementById('detail-question-genre').value || ''; const ss = document.getElementById('detail-question-subgenre'); if (ss) ss.innerHTML = this.getSubgenreOptionsHTML(g, '', false); },

    openRegeneratePolicyModal() { const m = document.getElementById('regenerate-policy-modal'), p = document.getElementById('regenerate-policy-panel'); document.querySelector('input[name="regenerate-policy"][value="correct"]').checked = true; m.classList.remove('hidden'); void m.offsetWidth; m.classList.remove('opacity-0'); p.classList.remove('scale-95'); },
    closeRegeneratePolicyModal() { const m = document.getElementById('regenerate-policy-modal'), p = document.getElementById('regenerate-policy-panel'); m.classList.add('opacity-0'); p.classList.add('scale-95'); setTimeout(() => m.classList.add('hidden'), 300); },
    closeRegenerateCompareModal() { const m = document.getElementById('regenerate-compare-modal'), p = document.getElementById('regenerate-compare-panel'); m.classList.add('opacity-0'); p.classList.add('scale-95'); setTimeout(() => m.classList.add('hidden'), 300); },
    async regenerateQuestionForDetail() {
        if (!this.geminiApiKey) return this.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        const q = document.getElementById('detail-question-q').value.trim(), a = document.getElementById('detail-question-a').value.trim(); if (!q || !a) return this.showToast('問題文と解答を入力してください', 'error');
        const checkedPolicy = document.querySelector('input[name="regenerate-policy"]:checked');
        const policy = checkedPolicy && checkedPolicy.value ? checkedPolicy.value : 'correct';
        this.closeRegeneratePolicyModal();
        const instruction = policy === 'current' ? '元の問題文の事実関係を維持・確認したうえで、解答に関する現在または直近の確実に確認できる情報を自然な手掛かりとして組み入れてください。変動しやすい数値や確認できない情報は使わないでください。' : '問題文中の事実誤認、年代・人物・作品等の取り違え、時制が一致しない表現、基準時点が曖昧な表現を修正してください。確認できない手掛かりは削除してください。';
        this.showToast('問題文を再作成しています...', 'info');
        try { const prompt = `次の早押しクイズ問題を、解答を変更せずに再作成してください。\n方針:${instruction}\n全手掛かりを内部でファクトチェックし、確実な事実だけを使用してください。早押しクイズらしく前半は広い手掛かり、後半ほど特定しやすい構成にしてください。解答そのものは問題文に書かないでください。出力は問題文のみです。\n元の問題文:${q}\n解答:${a}`; const result = (await this.fetchGemini(prompt, false)).trim().replace(/^```[a-z]*|```$/gi, '').trim(); if (!result) throw new Error('問題文を再作成できませんでした'); this.pendingRegeneratedQuestion = { before: q, after: result, policy }; document.getElementById('regenerate-before-text').textContent = q; document.getElementById('regenerate-after-text').textContent = result; document.getElementById('regenerate-compare-policy').textContent = policy === 'current' ? '方針: 現在・直近の情報を組み入れる' : '方針: 誤り・時制を修正'; const m = document.getElementById('regenerate-compare-modal'), p = document.getElementById('regenerate-compare-panel'); m.classList.remove('hidden'); void m.offsetWidth; m.classList.remove('opacity-0'); p.classList.remove('scale-95'); } catch (e) { this.showToast('問題再作成に失敗しました: ' + e.message, 'error'); }
    },
    applyRegeneratedQuestion() { if (!this.pendingRegeneratedQuestion) return; document.getElementById('detail-question-q').value = this.pendingRegeneratedQuestion.after; this.pendingRegeneratedQuestion = null; this.closeRegenerateCompareModal(); this.showToast('再作成後の問題文を編集欄へ反映しました。保存してください', 'success'); },
    async regenerateAnswerForQuestion() {
        if (!this.geminiApiKey) return this.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        const question = document.getElementById('detail-question-q').value.trim();
        const currentAnswer = document.getElementById('detail-question-a').value.trim();
        if (!question) return this.showToast('問題文を入力してください', 'error');
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
            this.showToast('解答候補を編集欄へ反映しました。内容を確認して保存してください', 'success');
        } catch (e) {
            this.showToast('解答再作成に失敗しました: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = oldText;
            btn.classList.remove('opacity-70', 'cursor-not-allowed');
        }
    },

    getQuestionId(q) { return q.questionId || q.id; }, getCycleSeenSet(set) { if (!set) return new Set(); if (!Array.isArray(set.cycleSeenQuestionIds)) set.cycleSeenQuestionIds = []; return new Set(set.cycleSeenQuestionIds); }, resetQuestionCycle(set) { if (set) { set.cycleSeenQuestionIds = []; set.cycleStartedAt = Date.now(); } }, isCycleCompleted(set, questions) { const seen = this.getCycleSeenSet(set); return questions.length > 0 && questions.map(q => this.getQuestionId(q)).every(id => seen.has(id)); }, markQuestionSeenInCycle(set, q) { if (!set || !q) return; const id = this.getQuestionId(q); const seen = this.getCycleSeenSet(set); seen.add(id); set.cycleSeenQuestionIds = Array.from(seen); if (!set.cycleStartedAt) set.cycleStartedAt = Date.now(); },

    getAccuracyRatio(q) {
        if (!q || !q.total) {
            return 0;
        }

        if (Number.isFinite(Number(q.accuracy))) {
            return Number(q.accuracy);
        }

        return (q.correct || 0) / q.total;
    },

    isHighAccuracyQuestion(q) {
        return ((q.total || 0) >= HIGH_ACCURACY_MIN_ATTEMPTS && this.getAccuracyRatio(q) >= HIGH_ACCURACY_THRESHOLD);
    },

    isHighAccuracyCooldown(q, now = Date.now()) {
        return !!(q.lastAnsweredAt && (now - Number(q.lastAnsweredAt)) < HIGH_ACCURACY_COOLDOWN_MS);
    },

    isLowAccuracyQuestion(q) {
        return ((q.total || 0) > 0 && this.getAccuracyRatio(q) < LOW_ACCURACY_THRESHOLD);
    },

    isStaleQuestion(q, now = Date.now()) {
        return !!(q.lastAnsweredAt && (now - Number(q.lastAnsweredAt)) >= STALE_REVIEW_MS);
    },

    renderQuestionList() {
        if (this.questionManager) {
            this.questionManager.renderQuestionList();
        }
    },

    renderLearningSummary() {
        const period = this.summaryPeriod;
        const values = [];

        for (let i = period - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);

            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            values.push(Number(this.dailyStats[key]) || 0);
        }

        const total = values.reduce((a, b) => a + b, 0);
        const max = Math.max(...values, 1);
        const average = Math.round(total / period);

        const totalEl = document.getElementById('stat-30day-total');
        if (totalEl) totalEl.textContent = total;

        const maxEl = document.getElementById('stat-30day-max');
        if (maxEl) maxEl.textContent = max;

        const avgEl = document.getElementById('stat-average');
        if (avgEl) avgEl.textContent = average;

        const periodLabel = document.getElementById('summary-period-label');
        if (periodLabel) periodLabel.textContent = period;

        const startLabel = document.getElementById('summary-start-label');
        if (startLabel) startLabel.textContent = `${period - 1}日前`;

        [7, 14, 30].forEach(days => {
            const btn = document.getElementById(`summary-tab-${days}`);
            if (!btn) return;
            btn.className = days === period
                ? 'px-3 py-1 text-xs rounded-md bg-soft-green-600 text-white font-bold'
                : 'px-3 py-1 text-xs rounded-md text-soft-green-700';
        });

        const svg = document.getElementById('learning-30day-chart');
        if (!svg) return;

        const chartOffsetX = 25;
        const width = 275;
        const height = 120;
        const barWidth = width / values.length;

        let html = '';

        html += `
            <text x="0" y="10" font-size="10" fill="#4b7f68">${max}</text>
            <text x="0" y="60" font-size="10" fill="#4b7f68">${Math.round(max / 2)}</text>
            <text x="0" y="118" font-size="10" fill="#4b7f68">0</text>
        `;

        html += `
            <line x1="20" y1="0" x2="300" y2="0" stroke="#d5e8dc" stroke-width="1"/>
            <line x1="20" y1="50" x2="300" y2="50" stroke="#d5e8dc" stroke-width="1"/>
            <line x1="20" y1="100" x2="300" y2="100" stroke="#d5e8dc" stroke-width="1"/>
        `;

        values.forEach((value, i) => {
            const h = (value / max) * 100;
            const x = chartOffsetX + i * barWidth + 1;
            const y = height - h;
            const d = new Date();
            d.setDate(d.getDate() - (period - 1 - i));
            const label = `${d.getMonth() + 1}/${d.getDate()} : ${value}問`;
            const fill = value > 0 ? '#3ba471' : '#dfece5';

            html += `
                <rect
                    x="${x}"
                    y="${y}"
                    width="${barWidth - 2}"
                    height="${h}"
                    rx="2"
                    fill="${fill}">
                    <title>${label}</title>
                </rect>`;
        });

        html += `
            <line
                x1="20"
                y1="120"
                x2="300"
                y2="120"
                stroke="#d5e8dc"
                stroke-width="1"/>
        `;

        svg.innerHTML = html;
    },

    changeSummaryPeriod(days) {
        this.summaryPeriod = days;
        this.renderLearningSummary();
    },

    updateStats() {
        const targetSet = this.studySets.find(s => s.id === this.activeSetId);
        if (!targetSet) return;
        const total = targetSet.questions.length;
        document.getElementById('stat-total-questions').textContent = total;
        const todayEl = document.getElementById('stat-today-answered'); if (todayEl) todayEl.textContent = this.getTodayAnsweredCount();

        let attempted = 0, correct = 0;
        targetSet.questions.forEach(q => { attempted += q.total; correct += q.correct; });

        const acc = attempted === 0 ? 0 : Math.round((correct / attempted) * 100);
        document.getElementById('stat-accuracy').textContent = attempted > 0 ? `${acc}%` : '--%';
        this.renderLearningSummary();
    },

    renderManagerStats() {
        const set = this.studySets.find(s => s.id === this.managerSetId);
        if (!set) return;
        const total = set.questions.length;
        document.getElementById('manager-total-count').textContent = total;
        document.getElementById('manager-capacity-bar').style.width = `${Math.min(100, total / MAX_QUESTIONS_PER_SET * 100)}%`;

        const unanswered = set.questions.filter(q => (q.total || 0) === 0).length;
        const noExp = set.questions.filter(q => !(q.explanation || '').trim()).length;
        const noGenre = set.questions.filter(q => !(q.genre || '').trim()).length;
        const u = document.getElementById('manager-summary-unanswered'), e = document.getElementById('manager-summary-no-explanation'), g = document.getElementById('manager-summary-no-genre');
        if (u) u.textContent = unanswered;
        if (e) e.textContent = noExp;
        if (g) g.textContent = noGenre;

        const chart = document.getElementById('manager-stats-chart');
        const distAccuracyTab = document.getElementById('distribution-tab-accuracy');
        const distMasteryTab = document.getElementById('distribution-tab-mastery');
        if (distAccuracyTab && distMasteryTab) {
            distAccuracyTab.className = `px-3 py-1.5 rounded-lg text-xs font-bold ${this.managerDistributionMetric === 'accuracy' ? 'bg-soft-green-600 text-white' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
            distMasteryTab.className = `px-3 py-1.5 rounded-lg text-xs font-bold ${this.managerDistributionMetric === 'mastery' ? 'bg-soft-green-600 text-white' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
        }
        if (chart) {
            const pctLabel = count => total ? `${count}問（${Math.round((count / total) * 100)}%）` : `${count}問（0%）`;
            if (!total) chart.innerHTML = '<p class="text-sm text-soft-green-500 py-2">データがありません</p>';
            else {
                const bins = [
                    { label: '0〜19%', min: 0, max: 20, count: 0 }, { label: '20〜39%', min: 20, max: 40, count: 0 },
                    { label: '40〜59%', min: 40, max: 60, count: 0 }, { label: '60〜79%', min: 60, max: 80, count: 0 },
                    { label: '80〜100%', min: 80, max: 101, count: 0 }
                ];
                set.questions.forEach(q => {
                    // 未回答問題は正解率・習熟度の各階級から除外し、専用行へ集計する。
                    if ((q.total || 0) === 0) return;
                    const value = this.managerDistributionMetric === 'mastery' ? this.getMasteryMetrics(q).score : this.getAccuracyRatio(q) * 100;
                    const bin = bins.find(b => value >= b.min && value < b.max) || bins[bins.length - 1];
                    bin.count++;
                });
                const unansweredCount = unanswered;
                const maxCount = Math.max(1, unansweredCount, ...bins.map(b => b.count));
                const rows = bins.map(b => `<div class="flex items-center gap-2"><div class="w-20 text-xs font-bold text-soft-green-700">${b.label}</div><div class="flex-1 bg-soft-green-100 rounded-full h-5 overflow-hidden"><div class="${this.managerDistributionMetric === 'mastery' ? 'bg-indigo-500' : 'bg-soft-green-500'} h-5 rounded-full transition-all" style="width:${Math.max(2, Math.round((b.count / maxCount) * 100))}%"></div></div><div class="w-24 text-right text-xs font-bold text-soft-green-800">${pctLabel(b.count)}</div></div>`).join('');
                const unansweredRow = `<div class="flex items-center gap-2"><div class="w-20 text-xs font-bold text-soft-green-500">未回答</div><div class="flex-1 bg-soft-green-100 rounded-full h-5 overflow-hidden"><div class="bg-gray-400 h-5 rounded-full transition-all" style="width:${Math.max(2, Math.round((unanswered / maxCount) * 100))}%"></div></div><div class="w-24 text-right text-xs font-bold text-soft-green-800">${pctLabel(unanswered)}</div></div>`;
                chart.innerHTML = rows + unansweredRow;
            }
        }

        const tabA = document.getElementById('genre-analysis-tab-aql'), tabQ = document.getElementById('genre-analysis-tab-qma');
        if (tabA && tabQ) {
            tabA.className = `px-3 py-1.5 rounded-lg text-xs font-bold ${this.managerGenreStandard === 'aql' ? 'bg-soft-green-600 text-white' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
            tabQ.className = `px-3 py-1.5 rounded-lg text-xs font-bold ${this.managerGenreStandard === 'qma' ? 'bg-soft-green-600 text-white' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
        }

        const genreBox = document.getElementById('manager-genre-summary');
        if (genreBox) {
            const map = new Map();
            set.questions.forEach(q => {
                const rawGenre = String(q.genre || '').trim();
                const definitions = this.getAISubgenres();
                let aql = definitions[rawGenre] ? rawGenre : '';
                if (!aql && rawGenre) {
                    const genreMatch = Object.entries(definitions).find(([, subgenres]) => subgenres.includes(rawGenre));
                    aql = genreMatch ? genreMatch[0] : '';
                }
                if (!aql && q.subgenre) {
                    const genreMatch = Object.entries(definitions).find(([, subgenres]) => subgenres.includes(String(q.subgenre).trim()));
                    aql = genreMatch ? genreMatch[0] : '';
                }
                aql = aql || '未設定';
                const name = this.managerGenreStandard === 'qma' ? this.toQMAGenre(aql) : aql;
                if (!map.has(name)) map.set(name, { total: 0, attempted: 0, correct: 0, unanswered: 0 });
                const r = map.get(name);
                r.total++;
                r.attempted += q.total || 0;
                r.correct += q.correct || 0;
                if ((q.total || 0) === 0) r.unanswered++;
            });
            const label = this.managerGenreStandard === 'qma' ? 'QMA基準' : 'AQL基準';
            const rows = [...map.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, r]) => `<tr class="border-t border-soft-green-100"><td class="px-3 py-2 font-semibold">${this.escapeHTML(name)}</td><td class="px-3 py-2 text-right">${r.total}</td><td class="px-3 py-2 text-right">${r.attempted ? Math.round(r.correct / r.attempted * 100) + '%' : '--%'}</td><td class="px-3 py-2 text-right">${r.unanswered}</td></tr>`).join('');
            genreBox.innerHTML = `<table class="w-full text-sm"><thead class="bg-soft-green-100 text-soft-green-800"><tr><th class="px-3 py-2 text-left">ジャンル（${label}）</th><th class="px-3 py-2 text-right">登録問題数</th><th class="px-3 py-2 text-right">平均正解率</th><th class="px-3 py-2 text-right">未回答数</th></tr></thead><tbody>${rows}</tbody></table>`;
        }
        this.questionManager.updateQuestionFilterOptions();
        this.renderQuestionList();
    },

    escapeCSVValue(value) {
        const str = String(value !== null && value !== undefined ? value : '');
        return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    },

    applyDictionary(text) { return this.applyPronunciations(text, null); },
    applyPronunciations(text, question = null) {
        let res = String(text !== null && text !== undefined ? text : '');
        const local = question && Array.isArray(question.pronunciations) ? question.pronunciations : [];
        const global = Array.isArray(this.dictionary) ? this.dictionary : [];
        const used = new Set();
        [...local, ...global]
            .filter(x => x && x.word && x.pronunciation)
            .sort((a, b) => b.word.length - a.word.length)
            .forEach(x => {
                if (used.has(x.word)) return;
                res = res.split(x.word).join(x.pronunciation);
                used.add(x.word);
            });
        return res;
    },

    normalizeAnswerForDuplicateCheck(text) {
        return String(text || '').normalize('NFKC').toLowerCase()
            .replace(/[\s　・･「」『』【】()（）\[\]［］]/g, '')
            .replace(/[.,，。・:：;；!?！？'"“”‘’]/g, '');
    },
    makeTextBigrams(text) {
        const normalized = String(text || '').normalize('NFKC').toLowerCase()
            .replace(/[\s　、。,.，・:：;；!?！？「」『』【】()（）\[\]［］]/g, '');
        const grams = new Set();
        if (normalized.length < 2) { if (normalized) grams.add(normalized); return grams; }
        for (let i = 0; i < normalized.length - 1; i++) grams.add(normalized.slice(i, i + 2));
        return grams;
    },
    textSimilarity(a, b) {
        const ga = this.makeTextBigrams(a), gb = this.makeTextBigrams(b);
        if (!ga.size || !gb.size) return 0;
        let common = 0;
        ga.forEach(x => { if (gb.has(x)) common++; });
        return common / Math.max(ga.size, gb.size);
    },
    isSimilarQuestionCandidate(item, accepted, existingQuestions) {
        const angleText = [item.angle, ...(Array.isArray(item.keywords) ? item.keywords : [])].join(' ');
        if (accepted.some(x => this.textSimilarity(angleText, [x.angle, ...(x.keywords || [])].join(' ')) >= 0.68)) return true;
        if (accepted.some(x => this.textSimilarity(item.q, x.q) >= 0.72)) return true;
        if (existingQuestions.some(x => this.textSimilarity(item.q, x.q) >= 0.78)) return true;
        return false;
    },
    async generateQuestionPlansWithAI({ count, genre, subgenre, topic, difficulty, excludedAnswers, excludedAngles }) {
        const defs = this.getAISubgenres();
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
        const parsed = this.parseAIJSON(await this.fetchGemini(prompt, true));
        return Array.isArray(parsed) ? parsed : [];
    },
    async generateQuestionBatchFromPlans(plans, difficulty, priorSummaries) {
        const prompt = `次の設計案ごとに早押しクイズ問題を1問ずつ作成してください。解答は設計案のanswerから変更しないでください。\n` +
            `早押しクイズらしく前半は広い手掛かり、後半ほど特定しやすくしてください。各手掛かりを内部でファクトチェックし、確実な事実だけを使ってください。\n` +
            `他の設計案や既に作成済みの問題と同じ趣旨・構成・手掛かりの並びを避けてください。\n` +
            `難易度:${difficulty}\n既に作成済みの概要(JSON):${JSON.stringify(priorSummaries)}\n` +
            `設計案(JSON):${JSON.stringify(plans)}\n` +
            `explanationは、${this.getAIExplanationInstruction()}\n` +
            `出力はJSON配列のみ。形式:[{"q":"問題文","a":"解答","explanation":"解説","genre":"ジャンル","subgenre":"サブジャンル","angle":"出題観点","keywords":["識別語"]}]`;
        const parsed = this.parseAIJSON(await this.fetchGemini(prompt, true));
        return Array.isArray(parsed) ? parsed : [];
    },
    openPronunciationModalFromQuiz() {
        const set = this.studySets.find(s => s.id === this.activeSetId);
        if (set && set.questions && set.questions[this.currentQuestionIndex]) {
            this.openPronunciationModal(set.questions[this.currentQuestionIndex]);
        }
    },
    openPronunciationModalFromDetail() { const id = document.getElementById('detail-question-id').value; this.openPronunciationModal(this.getQuestionByIdAcrossSets(id).q); },
    getQuestionByIdAcrossSets(id) { for (const set of this.studySets) { const index = set.questions.findIndex(q => this.getQuestionId(q) === id); if (index >= 0) return { set, q: this.normalizeQuestionData(set.questions[index]), index }; } return { set: null, q: null, index: -1 }; },
    openPronunciationModal(q) { if (!q) return; this.pronunciationTargetQuestion = q; document.getElementById('pronunciation-question-id').value = this.getQuestionId(q); const globals = new Set(this.dictionary.map(x => x.word)); this.pronunciationCandidates = (q.pronunciations || []).filter(x => !globals.has(x.word)).map(x => ({ ...x, selected: true, scope: 'question', saved: true })); this.renderPronunciationCandidates(); const m = document.getElementById('pronunciation-modal'), p = document.getElementById('pronunciation-panel'); m.classList.remove('hidden'); void m.offsetWidth; m.classList.remove('opacity-0'); p.classList.remove('scale-95'); },

    closePronunciationModal() {
        this.synth.cancel();
        const m = document.getElementById('pronunciation-modal'), p = document.getElementById('pronunciation-panel');
        m.classList.add('opacity-0');
        p.classList.add('scale-95'); setTimeout(() => m.classList.add('hidden'), 300);
    },

    async generatePronunciationCandidatesWithAI() { const q = this.pronunciationTargetQuestion; if (!this.geminiApiKey) return this.showToast('Gemini APIキーを設定してください', 'error'); const l = document.getElementById('pronunciation-loading'), b = document.getElementById('pronunciation-ai-btn'); l.classList.remove('hidden'); l.classList.add('flex'); b.disabled = true; try { const parsed = this.parseAIJSON(await this.fetchGemini(`問題文と解答から音声で誤読されやすい固有名詞を抽出し、文脈に合う読みをひらがなで示してください。入力に実在する完全一致文字列のみ。JSON配列のみ:[{"word":"対象","pronunciation":"よみ"}]\n問題文:${q.q}\n解答:${q.a}`, true)); const globals = new Set(this.dictionary.map(x => x.word)); let added = 0; (Array.isArray(parsed) ? parsed : []).forEach(x => { const word = String(x.word || '').trim(), pronunciation = String(x.pronunciation || x.reading || '').trim(); if (!word || !pronunciation || globals.has(word) || (!q.q.includes(word) && !q.a.includes(word))) return; if (!this.pronunciationCandidates.some(c => c.word === word)) { this.pronunciationCandidates.push({ word, pronunciation, selected: true, scope: 'question' }); added++; } }); this.renderPronunciationCandidates(); this.showToast(added ? `${added}件の候補を追加しました` : '新しい候補はありませんでした', added ? 'success' : 'info'); } catch (e) { this.showToast('AI候補作成に失敗しました: ' + e.message, 'error'); } finally { l.classList.add('hidden'); l.classList.remove('flex'); b.disabled = false; } },
    renderPronunciationCandidates() { const list = document.getElementById('pronunciation-candidate-list'), empty = document.getElementById('pronunciation-empty'), globals = new Set(this.dictionary.map(x => x.word)); this.pronunciationCandidates = (this.pronunciationCandidates || []).filter(x => !globals.has(x.word)); empty.classList.toggle('hidden', this.pronunciationCandidates.length > 0); list.innerHTML = this.pronunciationCandidates.map((x, i) => `<div class="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_1fr_auto] gap-2 items-center border rounded-xl p-3"><input type="checkbox" ${x.selected !== false ? 'checked' : ''} onchange="app.pronunciationCandidates[${i}].selected=this.checked"><input class="px-2 py-2 border rounded-lg text-sm" value="${this.escapeHTML(x.word)}" oninput="app.pronunciationCandidates[${i}].word=this.value"><input class="col-start-2 sm:col-start-auto px-2 py-2 border rounded-lg text-sm" value="${this.escapeHTML(x.pronunciation)}" oninput="app.pronunciationCandidates[${i}].pronunciation=this.value"><div class="col-start-2 sm:col-start-auto flex gap-1"><select class="px-2 py-2 border rounded-lg text-xs" onchange="app.pronunciationCandidates[${i}].scope=this.value"><option value="question" ${x.scope !== 'global' ? 'selected' : ''}>この問題だけ</option><option value="global" ${x.scope === 'global' ? 'selected' : ''}>すべての問題</option></select><button onclick="app.pronunciationCandidates.splice(${i},1);app.renderPronunciationCandidates()" class="text-red-600 text-xs">削除</button></div></div>`).join(''); },
    addPronunciationCandidate() { this.pronunciationCandidates.push({ word: '', pronunciation: '', selected: true, scope: 'question' }); this.renderPronunciationCandidates(); },
    testSelectedPronunciations() { const x = this.pronunciationCandidates.filter(x => x.selected && x.pronunciation); if (!x.length) return this.showToast('候補を選択してください', 'error'); const u = new SpeechSynthesisUtterance(x.map(x => x.pronunciation).join('、')); u.lang = 'ja-JP'; this.synth.cancel(); this.synth.speak(u); },
    savePronunciationSettings() { const r = this.getQuestionByIdAcrossSets(document.getElementById('pronunciation-question-id').value), globals = new Set(this.dictionary.map(x => x.word)), selected = this.pronunciationCandidates.filter(x => x.selected && x.word.trim() && x.pronunciation.trim() && !globals.has(x.word.trim())); if (!selected.length) return this.showToast('登録候補を選択してください', 'error'); const local = r.q.pronunciations || []; selected.forEach(x => { const e = { word: x.word.trim(), pronunciation: x.pronunciation.trim() }; if (x.scope === 'global') { this.dictionary.push(e); const i = local.findIndex(y => y.word === e.word); if (i >= 0) local.splice(i, 1); } else { const i = local.findIndex(y => y.word === e.word); if (i >= 0) local[i] = e; else local.push(e); } }); r.q.pronunciations = local; r.set.questions[r.index] = r.q; this.saveDictionary(); this.dictionaryManager.render(); this.saveStudySets(); this.renderDetailPronunciations(r.q); this.closePronunciationModal(); this.showToast(`${selected.length}件登録しました`, 'success'); },
    renderDetailPronunciations(q) { const box = document.getElementById('detail-pronunciation-list'); if (!box) return; const x = q && q.pronunciations ? q.pronunciations : []; box.innerHTML = x.length ? x.map((d, i) => `<div class="flex justify-between bg-white border rounded-lg px-3 py-2"><span class="text-sm">${this.escapeHTML(d.word)} → ${this.escapeHTML(d.pronunciation)}</span><button onclick="app.removeLocalPronunciation(${i})" class="text-red-600 text-xs">削除</button></div>`).join('') : '<p class="text-xs text-soft-green-500">この問題固有の読み方は未設定です。</p>'; },
    removeLocalPronunciation(i) { const r = this.getQuestionByIdAcrossSets(document.getElementById('detail-question-id').value); r.q.pronunciations.splice(i, 1); r.set.questions[r.index] = r.q; this.saveStudySets(); this.renderDetailPronunciations(r.q); },
    switchAIGeneratorTab(tab) {
        const memo = tab === 'memo';
        document.getElementById('ai-tab-normal').classList.toggle('hidden', memo);
        document.getElementById('ai-tab-memo').classList.toggle('hidden', !memo);
        const n = document.getElementById('ai-tab-btn-normal'), m = document.getElementById('ai-tab-btn-memo');
        n.className = `flex-1 px-4 py-2 rounded-xl font-bold text-sm ${!memo ? 'bg-soft-green-600 text-white shadow-sm' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
        m.className = `flex-1 px-4 py-2 rounded-xl font-bold text-sm ${memo ? 'bg-soft-green-600 text-white shadow-sm' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
    },
    resetMemoImport(showMessage = true) {
        const memo = document.getElementById('ai-memo-list'); if (memo) memo.value = '';
        const difficulty = document.getElementById('ai-memo-difficulty'); if (difficulty) difficulty.value = '中級';
        this.memoNormalizedAnswers = []; this.pendingMemoQuestions = [];
        const normalizedList = document.getElementById('ai-memo-normalized-list'); if (normalizedList) normalizedList.innerHTML = '';
        const previewList = document.getElementById('ai-memo-preview-list'); if (previewList) previewList.innerHTML = '';
        const memoNormalized = document.getElementById('ai-memo-normalized'); if (memoNormalized) memoNormalized.classList.add('hidden');
        const memoPreview = document.getElementById('ai-memo-preview'); if (memoPreview) memoPreview.classList.add('hidden');
        const generate = document.getElementById('btn-generate-memo'); if (generate) generate.textContent = '問題を一括作成';
        this.updateMemoCandidateCount();
        if (showMessage) this.showToast('メモ取り込み画面をリセットしました', 'info');
    },
    parseMemoCandidates() {
        const memoList = document.getElementById('ai-memo-list');
        const raw = memoList && memoList.value ? memoList.value : '';
        const seen = new Set(), items = [];
        raw.replace(/\r/g, '').split('\n').forEach(line => {
            const cleaned = line.replace(/^\s*(?:[-*・●■◆]|\d+[.)．、:]|[①-⑳])\s*/, '').trim();
            if (!cleaned) return;
            const parts = cleaned.split(/[\t　]+|\s{2,}/).map(x => x.trim()).filter(Boolean);
            let answer = parts.shift() || '';
            let supplement = parts.join(' ').trim();
            // 半角スペース1つだけの区切りも、末尾が短い役職・分野表現なら補足として扱う
            if (!supplement) {
                const m = cleaned.match(/^(.+?)\s+([^\s]{1,20})$/);
                if (m) { answer = m[1].trim(); supplement = m[2].trim(); }
            }
            const key = this.normalizeAnswerForDuplicateCheck(answer) + '|' + this.normalizeAnswerForDuplicateCheck(supplement);
            if (answer && key && !seen.has(key)) { seen.add(key); items.push({ raw: cleaned, answer, supplement }); }
        });
        return items;
    },
    updateMemoCandidateCount() {
        const count = this.parseMemoCandidates().length, el = document.getElementById('ai-memo-count');
        if (el) { el.textContent = `有効候補数: ${count} / 10`; el.classList.toggle('text-red-600', count > 10); }
        const btn = document.getElementById('btn-normalize-memo'); if (btn) btn.disabled = count === 0 || count > 10;
    },
    async normalizeMemoAnswersWithAI() {
        if (!this.geminiApiKey) return this.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        const inputs = this.parseMemoCandidates();
        if (!inputs.length) return this.showToast('メモを1行以上入力してください', 'error');
        if (inputs.length > MAX_MEMO_QUESTIONS) return this.showToast(`有効な解答候補は${MAX_MEMO_QUESTIONS}件以内にしてください`, 'error');
        const loader = document.getElementById('ai-loading'); loader.classList.remove('hidden'); loader.classList.add('flex');
        try {
            const prompt = `次のメモをクイズ作成用に補正してください。answerは解答候補、supplementは同姓同名や同名対象を区別し、問題の趣旨を決める補足事項です。タイプミス、誤変換、聞き取りミスを直してください。人物名は補足事項が示す対象に合う正式なフルネームにし、作品・施設・組織・出来事も正式名称にしてください。補足事項も誤記が明らかな場合は補正してください。別人・別対象に取り違えないでください。判断不能なら原文を維持してください。入力順を維持し、JSON配列のみ返してください。形式:[{"input":"原文","answer":"補正した解答","supplement":"補正した補足事項","note":"短い理由"}]\n入力:${JSON.stringify(inputs)}`;
            const parsed = this.parseAIJSON(await this.fetchGemini(prompt, true));
            this.memoNormalizedAnswers = inputs.map((input, i) => { const x = (Array.isArray(parsed) ? parsed : [])[i] || {}; return { input: input.raw, answer: String(x.answer || input.answer).trim(), supplement: String(x.supplement || input.supplement || '').trim(), note: String(x.note || '').trim() }; });
            const list = document.getElementById('ai-memo-normalized-list');
            list.innerHTML = this.memoNormalizedAnswers.map((x, i) => `<div class="bg-white border border-soft-green-200 rounded-xl p-3 space-y-2"><p class="text-xs text-soft-green-500">入力: ${this.escapeHTML(x.input)}${x.note ? ' / ' + this.escapeHTML(x.note) : ''}</p><div><label class="text-xs font-bold text-soft-green-700">解答候補</label><input class="w-full px-3 py-2 border rounded-lg text-sm font-semibold" value="${this.escapeHTML(x.answer)}" oninput="app.memoNormalizedAnswers[${i}].answer=this.value"></div><div><label class="text-xs font-bold text-soft-green-700">補足事項</label><input class="w-full px-3 py-2 border rounded-lg text-sm" value="${this.escapeHTML(x.supplement)}" oninput="app.memoNormalizedAnswers[${i}].supplement=this.value"></div></div>`).join('');
            document.getElementById('btn-generate-memo').textContent = `${this.memoNormalizedAnswers.length}問を一括作成`;
            document.getElementById('ai-memo-normalized').classList.remove('hidden');
            document.getElementById('ai-memo-preview').classList.add('hidden');
        } catch (e) { this.showToast('名称補正に失敗しました: ' + e.message, 'error'); }
        finally { loader.classList.add('hidden'); loader.classList.remove('flex'); }
    },
    async generateDerivativeData(answer, contextText = '', difficulty = '中級') {
        const genreCandidates = Object.entries(this.getAISubgenres()).map(([g, subs]) => `${g}: ${subs.join('、')}`).join('\n');
        const prompt = `「${answer}」が唯一の解答となる早押しクイズ問題を1問作成してください。前半は広い手掛かり、後半ほど特定しやすくしてください。すべての手掛かりを内部でファクトチェックし、確実な事実だけを使用してください。解答自体を問題文に書かないでください。難易度:${difficulty}。explanationは、${this.getAIExplanationInstruction()}\n候補からgenreと、その配下のsubgenreを1つずつ選んでください。\n${genreCandidates}\n出力JSON:{"q":"問題文","a":"${answer}","explanation":"解説","genre":"ジャンル","subgenre":"サブジャンル"}\n参考情報:${contextText}`;
        const data = this.parseAIJSON(await this.fetchGemini(prompt, true));
        const defs = this.getAISubgenres(), genre = String(data.genre || '').trim(), subgenre = String(data.subgenre || '').trim();
        if (!data.q || !defs[genre] || !defs[genre].includes(subgenre)) throw new Error(`「${answer}」の生成結果が不正です`);
        return { q: String(data.q).trim(), a: answer, explanation: String(data.explanation || '').trim(), genre, subgenre, selected: true };
    },
    async generateMemoQuestions() {
        const candidates = (this.memoNormalizedAnswers || []).map(x => ({ answer: String(x.answer || '').trim(), supplement: String(x.supplement || '').trim() })).filter(x => x.answer);
        if (!candidates.length || candidates.length > MAX_MEMO_QUESTIONS) return this.showToast(`補正済み候補を1〜${MAX_MEMO_QUESTIONS}件にしてください`, 'error');
        const targetSetId = await this.getTargetSetId('ai-target-set'); if (!targetSetId) return;
        const target = this.studySets.find(s => s.id === targetSetId), available = Math.min(MAX_QUESTIONS_PER_SET - target.questions.length, MAX_TOTAL_QUESTIONS - this.getTotalQuestionCount());
        if (candidates.length > available) return this.showToast(`登録可能数は残り${available}問です`, 'error');
        const loader = document.getElementById('ai-loading'); loader.classList.remove('hidden'); loader.classList.add('flex');
        try {
            // 同名でも補足事項が異なれば別候補として生成する。既存解答との重複は保存時に問題文も含めて確認する。
            const seen = new Set(), unique = [];
            candidates.forEach(x => { const k = this.normalizeAnswerForDuplicateCheck(x.answer) + '|' + this.normalizeAnswerForDuplicateCheck(x.supplement); if (k && !seen.has(k)) { seen.add(k); unique.push(x); } });
            const difficulty = document.getElementById('ai-memo-difficulty').value;
            const results = await this.mapWithConcurrency(unique, 2, async x => { try { const context = x.supplement ? `補足事項「${x.supplement}」で示される人物・対象だけを扱い、同姓同名・同名の別対象と混同しないこと。問題文の手掛かりはこの補足事項の趣旨に合わせること。` : 'メモ取り込みで指定された解答候補'; const data = await this.generateDerivativeData(x.answer, context, difficulty); data.supplement = x.supplement; return data; } catch (e) { return { a: x.answer, supplement: x.supplement, error: e.message, selected: false }; } });
            this.pendingMemoQuestions = results;
            document.getElementById('ai-memo-preview-list').innerHTML = results.map((x, i) => x.error ? `<div class="border border-red-200 bg-red-50 rounded-xl p-3"><p class="font-bold text-red-700">${this.escapeHTML(x.a)}${x.supplement ? '（' + this.escapeHTML(x.supplement) + '）' : ''}</p><p class="text-xs text-red-600">${this.escapeHTML(x.error)}</p></div>` : `<label class="block border border-soft-green-200 bg-white rounded-xl p-4"><div class="flex gap-3"><input type="checkbox" checked onchange="app.pendingMemoQuestions[${i}].selected=this.checked"><div><p class="font-bold text-amber-800">${this.escapeHTML(x.a)}${x.supplement ? ' <span class="text-xs text-soft-green-600">（' + this.escapeHTML(x.supplement) + '）</span>' : ''}</p><p class="text-sm mt-2">${this.escapeHTML(x.q)}</p></div></div></label>`).join('');
            document.getElementById('ai-memo-preview').classList.remove('hidden');
        } catch (e) { this.showToast('問題生成に失敗しました: ' + e.message, 'error'); }
        finally { loader.classList.add('hidden'); loader.classList.remove('flex'); }
    },
    async saveMemoQuestions() {
        const targetSetId = await this.getTargetSetId('ai-target-set'); if (!targetSetId) return;
        const target = this.studySets.find(s => s.id === targetSetId), items = (this.pendingMemoQuestions || []).filter(x => x.selected && !x.error);
        const available = Math.min(MAX_QUESTIONS_PER_SET - target.questions.length, MAX_TOTAL_QUESTIONS - this.getTotalQuestionCount());
        const batchKeys = new Set();
        const saved = []; items.slice(0, available).forEach(x => {
            const k = this.normalizeAnswerForDuplicateCheck(x.a) + '|' + this.normalizeAnswerForDuplicateCheck(x.supplement || '');
            const exactQuestionExists = target.questions.some(q => this.normalizeAnswerForDuplicateCheck(q.a) === this.normalizeAnswerForDuplicateCheck(x.a) && this.textSimilarity(q.q, x.q) >= 0.78);
            if (!batchKeys.has(k) && !exactQuestionExists) { batchKeys.add(k); target.questions.push(this.createQuestionData(x.q, x.a, x.explanation, { genre: x.genre, subgenre: x.subgenre, difficulty: document.getElementById('ai-memo-difficulty').value })); saved.push(x); }
        });
        this.saveStudySets(); this.updateSetSelectors(); this.resetMemoImport(false); this.showToast(`${saved.length}問を保存しました`, 'success');
    },
    async generateQuestionsWithAI() {
        if (!this.geminiApiKey) return this.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        const targetSetId = await this.getTargetSetId('ai-target-set');
        if (!targetSetId) return;
        const targetSet = this.studySets.find(s => s.id === targetSetId);
        const genre = document.getElementById('ai-genre').value;
        const subgenreElement = document.getElementById('ai-subgenre');
        const subgenre = subgenreElement && subgenreElement.value ? subgenreElement.value : '';
        const topic = genre ? '' : document.getElementById('ai-topic').value.trim();
        const requestedCount = parseInt(document.getElementById('ai-count').value, 10);
        const difficultyElement = document.getElementById('ai-difficulty');
        const difficulty = difficultyElement && difficultyElement.value ? difficultyElement.value : '中級';
        if (!genre && !topic) return this.showToast('ジャンルまたはテーマを入力してください', 'error');
        if (targetSet.questions.length + requestedCount > MAX_QUESTIONS_PER_SET) return this.showToast(`セットの登録上限(${MAX_QUESTIONS_PER_SET}問)を超過します。`, 'error');
        if (this.getTotalQuestionCount() + requestedCount > MAX_TOTAL_QUESTIONS) return this.showToast(`アプリ全体の登録上限(${MAX_TOTAL_QUESTIONS}問)を超過します。`, 'error');

        const btn = document.getElementById('btn-generate-ai');
        const loader = document.getElementById('ai-loading');
        const loadingTitle = loader.querySelector('p.text-sm');
        const originalLoadingText = loadingTitle ? loadingTitle.textContent : '';
        btn.classList.add('hidden'); loader.classList.remove('hidden'); loader.classList.add('flex');

        const existingQuestions = [...targetSet.questions];
        const usedAnswers = new Set(existingQuestions.map(q => this.normalizeAnswerForDuplicateCheck(q.a)).filter(Boolean));
        const accepted = [];
        const acceptedAngles = [];
        const defs = this.getAISubgenres();
        let retries = 0;
        try {
            while (accepted.length < requestedCount && retries < 3) {
                const shortage = requestedCount - accepted.length;
                if (loadingTitle) loadingTitle.textContent = `解答と出題観点を設計中... (${accepted.length}/${requestedCount})`;
                const plansRaw = await this.generateQuestionPlansWithAI({
                    count: shortage, genre, subgenre, topic, difficulty,
                    excludedAnswers: [...usedAnswers], excludedAngles: acceptedAngles
                });
                const planKeys = new Set();
                const plans = [];
                for (const raw of plansRaw) {
                    const answer = String(raw.answer || raw.a || '').trim();
                    const key = this.normalizeAnswerForDuplicateCheck(answer);
                    const aliases = Array.isArray(raw.aliases) ? raw.aliases.map(x => String(x).trim()).filter(Boolean) : [];
                    const aliasKeys = aliases.map(x => this.normalizeAnswerForDuplicateCheck(x));
                    if (!answer || !key || usedAnswers.has(key) || aliasKeys.some(k => usedAnswers.has(k)) || planKeys.has(key)) continue;
                    const angle = String(raw.angle || '').trim();
                    const keywords = Array.isArray(raw.keywords) ? raw.keywords.map(String) : [];
                    if (plans.some(p => this.textSimilarity([angle, ...keywords].join(' '), [p.angle, ...(p.keywords || [])].join(' ')) >= 0.68)) continue;
                    const assignedGenre = defs[raw.genre] ? raw.genre : (genre || 'ノンセク');
                    let assignedSubgenre = String(raw.subgenre || subgenre || '').trim();
                    if (!(defs[assignedGenre] || []).includes(assignedSubgenre)) assignedSubgenre = (defs[assignedGenre] || [])[0] || '';
                    plans.push({ answer, aliases, angle, keywords, genre: assignedGenre, subgenre: assignedSubgenre });
                    planKeys.add(key);
                    if (plans.length >= shortage) break;
                }
                if (!plans.length) { retries++; continue; }

                const batches = [];
                for (let i = 0; i < plans.length; i += 5) batches.push(plans.slice(i, i + 5));
                const priorSummaries = accepted.map(x => ({ answer: x.a, angle: x.angle, keywords: x.keywords }));
                let completedBatches = 0;
                const batchResults = await this.mapWithConcurrency(batches, 2, async batch => {
                    const result = await this.generateQuestionBatchFromPlans(batch, difficulty, priorSummaries);
                    completedBatches++;
                    if (loadingTitle) loadingTitle.textContent = `問題文を生成中... (${completedBatches}/${batches.length}バッチ)`;
                    return { batch, result };
                });

                for (const { batch, result } of batchResults) {
                    for (const item of result) {
                        const plan = batch.find(p => this.normalizeAnswerForDuplicateCheck(p.answer) === this.normalizeAnswerForDuplicateCheck(item.a));
                        if (!plan || !item.q || !item.a) continue;
                        const key = this.normalizeAnswerForDuplicateCheck(item.a);
                        if (usedAnswers.has(key)) continue;
                        const candidate = {
                            q: String(item.q).trim(), a: plan.answer,
                            explanation: String(item.explanation || '').trim(),
                            genre: plan.genre, subgenre: plan.subgenre,
                            angle: plan.angle, keywords: plan.keywords
                        };
                        if (this.isSimilarQuestionCandidate(candidate, accepted, existingQuestions)) continue;
                        usedAnswers.add(key);
                        plan.aliases.forEach(a => usedAnswers.add(this.normalizeAnswerForDuplicateCheck(a)));
                        accepted.push(candidate);
                        acceptedAngles.push(candidate.angle);
                        if (accepted.length >= requestedCount) break;
                    }
                    if (accepted.length >= requestedCount) break;
                }
                retries++;
            }

            // 保存直前の最終重複検査
            const finalExisting = new Set(targetSet.questions.map(q => this.normalizeAnswerForDuplicateCheck(q.a)));
            const finalItems = [];
            for (const item of accepted) {
                const key = this.normalizeAnswerForDuplicateCheck(item.a);
                if (!key || finalExisting.has(key)) continue;
                finalExisting.add(key);
                finalItems.push(item);
            }
            finalItems.forEach(item => targetSet.questions.push(this.createQuestionData(item.q, item.a, item.explanation, { genre: item.genre, subgenre: item.subgenre, difficulty })));
            this.saveStudySets();
            if (finalItems.length) this.showToast(`${finalItems.length}問生成しました${finalItems.length < requestedCount ? `（重複・類似を除外したため指定数未満）` : '！'}`, 'success');
            else this.showToast('重複しない問題を生成できませんでした。条件を変更して再試行してください。', 'error');
            if (finalItems.length && document.getElementById('ai-topic')) document.getElementById('ai-topic').value = '';
        } catch (e) {
            console.error('AI question generation error', e);
            this.showToast('生成失敗: ' + e.message, 'error');
        } finally {
            if (loadingTitle) loadingTitle.textContent = originalLoadingText;
            btn.classList.remove('hidden'); loader.classList.add('hidden'); loader.classList.remove('flex');
        }
    },

    async mapWithConcurrency(items, limit, worker) {
        const results = new Array(items.length);
        let nextIndex = 0;
        const run = async () => {
            while (true) {
                const index = nextIndex++;
                if (index >= items.length) return;
                results[index] = await worker(items[index], index);
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
        return results;
    },

    startQuiz(mode = 'voice') {
        return this.quizManager.startQuiz(mode);
    },

    nextQuestion() {
        return this.quizManager.nextQuestion();
    },

    stopTextReveal() {
        return this.quizManager.stopTextReveal();
    },
    startTextReveal(text) {
        return this.quizManager.startTextReveal(text);
    },
    buzz() {
        return this.quizManager.buzz();
    },

    showAnswer() {
        return this.quizManager.showAnswer();
    },

    skipQuestion() {
        return this.quizManager.skipQuestion();
    },

    recordResult(isCorrect) {
        return this.quizManager.recordResult(isCorrect);
    }
};

window.addEventListener('DOMContentLoaded', () => app.init());


function switchDataTab(tab) {
    document.querySelectorAll('.data-tab-panel').forEach(x => x.classList.add('hidden'));
    const dataTab = document.getElementById('data-tab-' + tab);
    if (dataTab) dataTab.classList.remove('hidden');
    document.querySelectorAll('.data-tab-btn').forEach(x => x.classList.remove('bg-soft-green-600', 'text-white'));
    const btnTab = document.getElementById('btn-tab-' + tab);
    if (btnTab) btnTab.classList.add('bg-soft-green-600', 'text-white');
}
document.addEventListener("DOMContentLoaded", () => setTimeout(() => switchDataTab('import'), 100));


window.exportSelectedSetBackup = function () {
    const sel = document.getElementById('backup-set-select'); if (!sel) return;
    const set = (app.studySets || []).find(x => x.id === sel.value); if (!set) { alert('学習セットを選択してください'); return; }
    const data = { version: '1.0', createdAt: Date.now(), studySet: set };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'quiz_backup_' + (set.name || 'set') + '.json'; a.click();
};
window.restoreSelectedSetBackup = function (file) {
    if (!file) { alert('バックアップファイルを選択してください'); return; }
    const r = new FileReader();
    r.onload = () => {
        const d = JSON.parse(r.result); const set = d.studySet; if (!set) return alert('不正なバックアップです');
        const existing = (app.studySets || []).find(x => x.name === set.name);
        const backupDate = d.createdAt ? new Date(d.createdAt).toLocaleString('ja-JP') : '不明'; if (existing && !confirm(`学習セット「${set.name}」

バックアップ日時:
${backupDate}

同名の学習セットが存在します。
上書きして復元しますか？`)) return;
        if (existing) { app.studySets = app.studySets.filter(x => x.id !== existing.id); }
        app.studySets.push(set);
        app.saveStudySets(); app.updateSetSelectors();
        alert('復元完了');
    };
    r.readAsText(file);
};


