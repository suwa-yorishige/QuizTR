// app.modular.js

const app = {
    escapeHTML: Utils.escapeHTML,
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
    theme: 'default',


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
        this.aiManager = new AIManager(this);
        this.dataManager = new DataManager(this);

        this.dataManager.bindEvents();
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
            this.theme = this.getStoredTheme();
            this.applyTheme(this.theme);

            document.getElementById('setting-gemini-key').value = this.geminiApiKey;
            document.getElementById('setting-tts-key').value = this.ttsApiKey;
            document.querySelector(`input[name="setting-theme"][value="${this.theme}"]`).checked = true;
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
        const selectedTheme = document.querySelector('input[name="setting-theme"]:checked')?.value;
        this.theme = this.normalizeTheme(selectedTheme);
        this.applyTheme(this.theme);
        localStorage.setItem('quiz_gemini_key', this.geminiApiKey);
        localStorage.setItem('quiz_tts_key', this.ttsApiKey);
        localStorage.setItem('quiz_theme', this.theme);
        this.showToast('設定を保存しました', 'success');
    },

    normalizeTheme(theme) {
        return ['default', 'aqua', 'dark'].includes(theme) ? theme : 'default';
    },

    getStoredTheme() {
        return this.normalizeTheme(localStorage.getItem('quiz_theme'));
    },

    applyTheme(theme) {
        const normalizedTheme = this.normalizeTheme(theme);
        document.documentElement.dataset.theme = normalizedTheme === 'default' ? '' : normalizedTheme;
        this.renderLearningSummary();
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

    updateSetSelectors() {
        const sets = this.studySets;
        const createOptions = (includeNew) => {
            let html = sets.map(s => `<option value="${s.id}">${Utils.escapeHTML(s.name)}</option>`).join('');
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
        const options = AI_SUBGENRES[genre] || [];
        subgenreSelect.innerHTML = '<option value=""></option>' + options.map(s => `<option value="${Utils.escapeHTML(s)}">${Utils.escapeHTML(s)}</option>`).join('');
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
        return await this.aiManager.fetchGemini(prompt, isJson);
    },

    async fetchCloudTextToSpeechAPI(ssml) {
        return await api.fetchCloudTextToSpeechAPI(this.ttsApiKey, ssml);
    },

    // AI関連メソッドの委譲（互換性維持）
    getAIExplanationInstruction() {
        return this.aiManager.getAIExplanationInstruction();
    },

    buildAIExplanationPrompt(q, a) {
        return this.aiManager.buildAIExplanationPrompt(q, a);
    },

    buildBatchAIExplanationPrompt(items) {
        return this.aiManager.buildBatchAIExplanationPrompt(items);
    },

    async fillExplanationsWithAI(items, loadingText = null, batchSize = CSV_EXPLANATION_BATCH_SIZE, maxPrompts = Infinity) {
        return await this.aiManager.fillExplanationsWithAI(items, loadingText, batchSize, maxPrompts);
    },

    async fetchGeminiSSML(text) {
        return await this.aiManager.fetchGeminiSSML(text);
    },

    async generateQuestionsWithAI() {
        return await this.aiManager.generateQuestionsWithAI();
    },

    async normalizeMemoAnswersWithAI() {
        return await this.aiManager.normalizeMemoAnswersWithAI();
    },

    async generateMemoQuestions() {
        return await this.aiManager.generateMemoQuestions();
    },

    async saveMemoQuestions() {
        return await this.aiManager.saveMemoQuestions();
    },

    async regenerateQuestionForDetail() {
        return await this.aiManager.regenerateQuestionForDetail();
    },

    applyRegeneratedQuestion() {
        return this.aiManager.applyRegeneratedQuestion();
    },

    async regenerateAnswerForQuestion() {
        return await this.aiManager.regenerateAnswerForQuestion();
    },

    async generatePronunciationCandidatesWithAI() {
        return await this.aiManager.generatePronunciationCandidatesWithAI();
    },

    async generateDerivativeData(answer, contextText = '', difficulty = '中級') {
        return await this.aiManager.generateDerivativeData(answer, contextText, difficulty);
    },

    getGenreOptionsHTML(selectedGenre = '', includeAll = false) { const genres = Object.keys(AI_SUBGENRES); let html = includeAll ? '<option value="">ジャンル: すべて</option><option value="__UNSET__">未設定</option>' : '<option value="">未設定</option>'; html += genres.map(g => `<option value="${Utils.escapeHTML(g)}" ${g === selectedGenre ? 'selected' : ''}>${Utils.escapeHTML(g)}</option>`).join(''); return html; },
    getSubgenreOptionsHTML(genre = '', selectedSubgenre = '', includeAll = false) { const prefix = includeAll ? '<option value="">サブジャンル: すべて</option>' : '<option value="">未設定</option>'; if (genre === '__UNSET__') return prefix; const options = genre ? (AI_SUBGENRES[genre] || []) : []; return prefix + options.map(x => `<option value="${Utils.escapeHTML(x)}" ${x === selectedSubgenre ? 'selected' : ''}>${Utils.escapeHTML(x)}</option>`).join(''); },

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
            <text x="0" y="10" font-size="10" fill="var(--color-chart-text)">${max}</text>
            <text x="0" y="60" font-size="10" fill="var(--color-chart-text)">${Math.round(max / 2)}</text>
            <text x="0" y="118" font-size="10" fill="var(--color-chart-text)">0</text>
        `;

        html += `
            <line x1="20" y1="0" x2="300" y2="0" stroke="var(--color-chart-grid)" stroke-width="1"/>
            <line x1="20" y1="50" x2="300" y2="50" stroke="var(--color-chart-grid)" stroke-width="1"/>
            <line x1="20" y1="100" x2="300" y2="100" stroke="var(--color-chart-grid)" stroke-width="1"/>
        `;

        values.forEach((value, i) => {
            const h = (value / max) * 100;
            const x = chartOffsetX + i * barWidth + 1;
            const y = height - h;
            const d = new Date();
            d.setDate(d.getDate() - (period - 1 - i));
            const label = `${d.getMonth() + 1}/${d.getDate()} : ${value}問`;
            const fill = value > 0 ? 'var(--color-chart-bar)' : 'var(--color-chart-empty-bar)';

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
                stroke="var(--color-chart-grid)"
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
                const definitions = AI_SUBGENRES;
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
            const rows = [...map.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, r]) => `<tr class="border-t border-soft-green-100"><td class="px-3 py-2 font-semibold">${Utils.escapeHTML(name)}</td><td class="px-3 py-2 text-right">${r.total}</td><td class="px-3 py-2 text-right">${r.attempted ? Math.round(r.correct / r.attempted * 100) + '%' : '--%'}</td><td class="px-3 py-2 text-right">${r.unanswered}</td></tr>`).join('');
            genreBox.innerHTML = `<table class="w-full text-sm"><thead class="bg-soft-green-100 text-soft-green-800"><tr><th class="px-3 py-2 text-left">ジャンル（${label}）</th><th class="px-3 py-2 text-right">登録問題数</th><th class="px-3 py-2 text-right">平均正解率</th><th class="px-3 py-2 text-right">未回答数</th></tr></thead><tbody>${rows}</tbody></table>`;
        }
        this.questionManager.updateQuestionFilterOptions();
        this.renderQuestionList();
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

    isSimilarQuestionCandidate(item, accepted, existingQuestions) {
        const angleText = [item.angle, ...(Array.isArray(item.keywords) ? item.keywords : [])].join(' ');
        if (accepted.some(x => Utils.textSimilarity(angleText, [x.angle, ...(x.keywords || [])].join(' ')) >= 0.68)) return true;
        if (accepted.some(x => Utils.textSimilarity(item.q, x.q) >= 0.72)) return true;
        if (existingQuestions.some(x => Utils.textSimilarity(item.q, x.q) >= 0.78)) return true;
        return false;
    },
    async generateQuestionPlansWithAI({ count, genre, subgenre, topic, difficulty, excludedAnswers, excludedAngles }) {
        const defs = AI_SUBGENRES;
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
        const parsed = this.aiManager.parseAIJSON(await this.fetchGemini(prompt, true));
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
        const parsed = this.aiManager.parseAIJSON(await this.fetchGemini(prompt, true));
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
    openPronunciationModal(q) { if (!q) return; this.pronunciationTargetQuestion = q; document.getElementById('pronunciation-question-id').value = this.getQuestionId(q); const globals = new Set(this.dictionary.map(x => x.word)); this.aiManager.pronunciationCandidates = (q.pronunciations || []).filter(x => !globals.has(x.word)).map(x => ({ ...x, selected: true, scope: 'question', saved: true })); this.renderPronunciationCandidates(); const m = document.getElementById('pronunciation-modal'), p = document.getElementById('pronunciation-panel'); m.classList.remove('hidden'); void m.offsetWidth; m.classList.remove('opacity-0'); p.classList.remove('scale-95'); },

    closePronunciationModal() {
        this.synth.cancel();
        const m = document.getElementById('pronunciation-modal'), p = document.getElementById('pronunciation-panel');
        m.classList.add('opacity-0');
        p.classList.add('scale-95'); setTimeout(() => m.classList.add('hidden'), 300);
    },
    renderPronunciationCandidates() { const list = document.getElementById('pronunciation-candidate-list'), empty = document.getElementById('pronunciation-empty'), globals = new Set(this.dictionary.map(x => x.word)); this.aiManager.pronunciationCandidates = (this.aiManager.pronunciationCandidates || []).filter(x => !globals.has(x.word)); empty.classList.toggle('hidden', this.aiManager.pronunciationCandidates.length > 0); list.innerHTML = this.aiManager.pronunciationCandidates.map((x, i) => `<div class="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_1fr_auto] gap-2 items-center border rounded-xl p-3"><input type="checkbox" ${x.selected !== false ? 'checked' : ''} onchange="app.aiManager.pronunciationCandidates[${i}].selected=this.checked"><input class="px-2 py-2 border rounded-lg text-sm" value="${this.escapeHTML(x.word)}" oninput="app.aiManager.pronunciationCandidates[${i}].word=this.value"><input class="col-start-2 sm:col-start-auto px-2 py-2 border rounded-lg text-sm" value="${this.escapeHTML(x.pronunciation)}" oninput="app.aiManager.pronunciationCandidates[${i}].pronunciation=this.value"><div class="col-start-2 sm:col-start-auto flex gap-1"><select class="px-2 py-2 border rounded-lg text-xs" onchange="app.aiManager.pronunciationCandidates[${i}].scope=this.value"><option value="question" ${x.scope !== 'global' ? 'selected' : ''}>この問題だけ</option><option value="global" ${x.scope === 'global' ? 'selected' : ''}>すべての問題</option></select><button onclick="app.aiManager.pronunciationCandidates.splice(${i},1);app.renderPronunciationCandidates()" class="text-red-600 text-xs">削除</button></div></div>`).join(''); },
    addPronunciationCandidate() { this.aiManager.pronunciationCandidates.push({ word: '', pronunciation: '', selected: true, scope: 'question' }); this.renderPronunciationCandidates(); },
    testSelectedPronunciations() { const x = this.aiManager.pronunciationCandidates.filter(x => x.selected && x.pronunciation); if (!x.length) return this.showToast('候補を選択してください', 'error'); const u = new SpeechSynthesisUtterance(x.map(x => x.pronunciation).join('、')); u.lang = 'ja-JP'; this.synth.cancel(); this.synth.speak(u); },
    savePronunciationSettings() { const r = this.getQuestionByIdAcrossSets(document.getElementById('pronunciation-question-id').value), globals = new Set(this.dictionary.map(x => x.word)), selected = this.aiManager.pronunciationCandidates.filter(x => x.selected && x.word.trim() && x.pronunciation.trim() && !globals.has(x.word.trim())); if (!selected.length) return this.showToast('登録候補を選択してください', 'error'); const local = r.q.pronunciations || []; selected.forEach(x => { const e = { word: x.word.trim(), pronunciation: x.pronunciation.trim() }; if (x.scope === 'global') { this.dictionary.push(e); const i = local.findIndex(y => y.word === e.word); if (i >= 0) local.splice(i, 1); } else { const i = local.findIndex(y => y.word === e.word); if (i >= 0) local[i] = e; else local.push(e); } }); r.q.pronunciations = local; r.set.questions[r.index] = r.q; this.saveDictionary(); this.dictionaryManager.render(); this.saveStudySets(); this.renderDetailPronunciations(r.q); this.closePronunciationModal(); this.showToast(`${selected.length}件登録しました`, 'success'); },
    renderDetailPronunciations(q) { const box = document.getElementById('detail-pronunciation-list'); if (!box) return; const x = q && q.pronunciations ? q.pronunciations : []; box.innerHTML = x.length ? x.map((d, i) => `<div class="flex justify-between bg-white border rounded-lg px-3 py-2"><span class="text-sm">${Utils.escapeHTML(d.word)} → ${Utils.escapeHTML(d.pronunciation)}</span><button onclick="app.removeLocalPronunciation(${i})" class="text-red-600 text-xs">削除</button></div>`).join('') : '<p class="text-xs text-soft-green-500">この問題固有の読み方は未設定です。</p>'; },
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
        this.aiManager.memoNormalizedAnswers = []; this.aiManager.pendingMemoQuestions = [];
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
            const key = Utils.normalizeAnswerForDuplicateCheck(answer) + '|' + Utils.normalizeAnswerForDuplicateCheck(supplement);
            if (answer && key && !seen.has(key)) { seen.add(key); items.push({ raw: cleaned, answer, supplement }); }
        });
        return items;
    },
    updateMemoCandidateCount() {
        const count = this.parseMemoCandidates().length, el = document.getElementById('ai-memo-count');
        if (el) { el.textContent = `有効候補数: ${count} / 10`; el.classList.toggle('text-red-600', count > 10); }
        const btn = document.getElementById('btn-normalize-memo'); if (btn) btn.disabled = count === 0 || count > 10;
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

window.addEventListener('DOMContentLoaded', () => {
    app.init();
    app.dataManager.switchTab('import');
});


