/**
 * question-manager.js
 *
 * app.js から「問題管理機能」を切り出すための管理クラス。
 *
 * 責務:
 * - 問題一覧表示
 * - 問題詳細編集
 * - 一括編集
 * - 重複問題統合
 * - ジャンル自動判定
 * - AI解説生成
 * - 問題整理/削除
 */
/**
 * QuestionManager クラス
 * 問題管理UI（一覧表示、詳細編集、一括編集、重複統合、ジャンル自動判定、AI解説生成、問題整理）を担当するクラス。
 * 問題の表示・編集・削除・統合などの管理機能を一括処理。
 */
class QuestionManager {
    /**
     * コンストラクタ
     * @param {Object} app - メインアプリケーションインスタンス
     */
    constructor(app) {
        this.app = app;
    }

    // =========================
    // 問題一覧
    // =========================

    /**
     * 問題一覧をレンダリング
     * フィルタ条件（検索キーワード、ジャンル、習熟度）に基づいて問題を抽出し、ページネーション付きで表示
     */
    renderQuestionList() {
        const list = document.getElementById('manager-question-list');
        const empty = document.getElementById('manager-question-empty');
        const pager = document.getElementById('manager-question-pager');
        if (!list || !empty) return;

        const set = this.app.studySets.find(s => s.id === this.app.managerSetId);
        const all = set ? set.questions.map(q => this.app.normalizeQuestionData(q)) : [];
        const questionSearch = document.getElementById('manager-question-search');
        const search = (questionSearch && questionSearch.value ? questionSearch.value : '').toLowerCase();
        const genreFilter = document.getElementById('manager-filter-genre');
        const g = genreFilter && genreFilter.value ? genreFilter.value : '';
        const subgenreFilter = document.getElementById('manager-filter-subgenre');
        const sg = subgenreFilter && subgenreFilter.value ? subgenreFilter.value : '';
        const masteryFilterElement = document.getElementById('manager-filter-mastery');
        const masteryFilter = masteryFilterElement && masteryFilterElement.value ? masteryFilterElement.value : '';

        const filtered = all.filter(q => {
            const mastery = this.app.getMasteryMetrics(q).score;
            const masteryOk = !masteryFilter ||
                (masteryFilter === '0-19' && mastery >= 0 && mastery < 20) ||
                (masteryFilter === '20-39' && mastery >= 20 && mastery < 40) ||
                (masteryFilter === '40-59' && mastery >= 40 && mastery < 60) ||
                (masteryFilter === '60-79' && mastery >= 60 && mastery < 80) ||
                (masteryFilter === '80-100' && mastery >= 80 && mastery <= 100);
            return ((!g) || (g === '__UNSET__' ? !q.genre : q.genre === g)) &&
                (!sg || q.subgenre === sg) && masteryOk &&
                (!search || [q.q, q.a, q.explanation, q.genre, q.subgenre].some(v => String(v || '').toLowerCase().includes(search)));
        });

        const totalEl = document.getElementById('manager-question-total-count');
        const visibleEl = document.getElementById('manager-question-visible-count');
        if (totalEl) totalEl.textContent = all.length;
        if (visibleEl) visibleEl.textContent = filtered.length;

        const unsetGenreCount = all.filter(q => !(q.genre || '').trim()).length;
        const bulkStatus = document.getElementById('manager-bulk-genre-status');
        // BULK_GENRE_CLASSIFY_LIMIT はグローバル定数と想定
        if (bulkStatus) bulkStatus.textContent = `未設定: ${unsetGenreCount}問 / 1回あたり最大${typeof BULK_GENRE_CLASSIFY_LIMIT !== 'undefined' ? BULK_GENRE_CLASSIFY_LIMIT : 20}問`;

        const noExplanationCount = all.filter(q => !(q.explanation || '').trim()).length;
        const bulkExpStatus = document.getElementById('manager-bulk-explanation-status');
        if (bulkExpStatus) bulkExpStatus.textContent = `解説未設定: ${noExplanationCount}問 / 最大${typeof CSV_EXPLANATION_LIMIT !== 'undefined' ? CSV_EXPLANATION_LIMIT : 20}問`;

        const bulkExpBtn = document.getElementById('manager-bulk-explanation-btn');
        if (bulkExpBtn) bulkExpBtn.disabled = noExplanationCount === 0;

        if (filtered.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
            if (pager) pager.classList.add('hidden');
            return;
        }
        empty.classList.add('hidden');

        const size = 50;
        const totalPages = Math.max(1, Math.ceil(filtered.length / size));
        this.app.questionListTotalPages = totalPages;
        this.app.questionListPage = Math.max(1, Math.min(this.app.questionListPage || 1, totalPages));
        const start = (this.app.questionListPage - 1) * size;

        list.innerHTML = filtered.slice(start, start + size).map((q, i) =>
            `<div class="p-3 hover:bg-soft-green-50"><div class="flex flex-col sm:flex-row sm:items-start gap-3"><div class="flex-1 min-w-0"><div class="text-xs text-soft-green-500 font-semibold">#${start + i + 1} ・ ${this.app.escapeHTML(q.genre || '未設定')}${q.subgenre ? ' / ' + this.app.escapeHTML(q.subgenre) : ''}</div><p class="text-sm font-bold text-soft-green-900 truncate whitespace-nowrap overflow-hidden" title="${this.app.escapeHTML(q.q)}">${this.app.escapeHTML(q.q)}</p><p class="text-xs text-soft-green-700 mt-1">解答: <span class="font-semibold">${this.app.escapeHTML(q.a)}</span> / 正解率: ${q.total > 0 ? Math.round((q.correct / q.total) * 100) + '%' : '--%'} / 習熟度: ${this.app.getMasteryMetrics(q).score}点 / 確定比: ${this.app.getMasteryMetrics(q).avgRatioText}</p></div><button onclick="app.questionManager.openQuestionDetail('${q.id}')" class="px-3 py-2 bg-soft-green-100 hover:bg-soft-green-200 text-soft-green-800 rounded-lg font-bold transition-colors text-xs whitespace-nowrap">詳細</button></div></div>`
        ).join('');

        if (pager) {
            pager.classList.remove('hidden');
            const info = document.getElementById('manager-question-page-info');
            if (info) info.textContent = `${this.app.questionListPage} / ${totalPages}`;
            const first = document.getElementById('manager-question-first');
            const prev = document.getElementById('manager-question-prev');
            const next = document.getElementById('manager-question-next');
            const last = document.getElementById('manager-question-last');
            [first, prev].forEach(b => { if (b) b.disabled = this.app.questionListPage <= 1; });
            [next, last].forEach(b => { if (b) b.disabled = this.app.questionListPage >= totalPages; });
        }
    }

    /**
     * 問題フィルタのジャンルオプション更新
     * 利用可能なジャンル一覧をドロップダウンに反映し、サブジャンルを再更新
     */
    updateQuestionFilterOptions() {
        const gs = document.getElementById('manager-filter-genre');
        if (!gs) return;
        const cur = gs.value || '';
        gs.innerHTML = this.app.getGenreOptionsHTML(cur, true);
        gs.value = cur;
        this.updateQuestionFilterSubgenreOptions();
    }

    /**
     * 問題フィルタのサブジャンルオプション更新
     * 選択されたジャンルに対応したサブジャンルをドロップダウンに反映
     */
    updateQuestionFilterSubgenreOptions() {
        const genreElement = document.getElementById('manager-filter-genre');
        const g = genreElement && genreElement.value ? genreElement.value : '';
        const ss = document.getElementById('manager-filter-subgenre');
        if (!ss) return;
        const cur = ss.value || '';
        ss.innerHTML = this.app.getSubgenreOptionsHTML(g, cur, true);
        if ([...ss.options].some(o => o.value === cur)) ss.value = cur;
    }

    // =========================
    // 問題詳細編集
    // =========================

    /**
     * IDから問題と所属セットを検索
     * 指定されたIDの問題をマネージャーのアクティブセット内から検索し、セット・問題・インデックスを返す
     * @param {string} id - 検索対象の問題ID
     * @returns {Object} {set, q, index} 問題が見つからない場合はq=null
     */
    findManagerQuestionById(id) {
        const set = this.app.studySets.find(s => s.id === this.app.managerSetId);
        if (!set) {
            return { set: null, q: null, index: -1 };
        }
        const index = set.questions.findIndex(q => (q.id || q.questionId) === id);
        return { set, q: index >= 0 ? this.app.normalizeQuestionData(set.questions[index]) : null, index };
    }

    /**
     * 問題詳細編集モーダルを開く
     * 指定ID の問題をフォームに読み込み、詳細編集用モーダルウィンドウを表示
     * @param {string} id - 開く問題のID
     */
    openQuestionDetail(id) {
        const r = this.findManagerQuestionById(id);
        if (!r.q) return this.app.showToast('問題が見つかりません', 'error');

        document.getElementById('detail-question-id').value = r.q.id;
        document.getElementById('detail-question-q').value = r.q.q;
        document.getElementById('detail-confirm-point').value = r.q.confirmPoint || r.q.q.length;
        this.app.syncConfirmPointLimit();
        document.getElementById('detail-question-a').value = r.q.a;

        const mastery = this.app.getMasteryMetrics(r.q);
        document.getElementById('question-detail-meta').textContent = `回答 ${r.q.total}回 / 正解 ${r.q.correct}回 / 習熟度 ${mastery.score}点 / 平均確定ポイント比 ${mastery.avgRatioText}`;
        document.getElementById('detail-question-explanation').value = r.q.explanation || '';

        const moveSelect = document.getElementById('detail-question-move-set');
        if (moveSelect) {
            moveSelect.innerHTML = this.app.getDisplayOrderedSets().map(set => `<option value="${set.id}">${set.favorite ? '★ ' : ''}${this.app.escapeHTML(set.name)}</option>`).join('');
            moveSelect.value = r.set.id;
        }

        const gs = document.getElementById('detail-question-genre');
        const ss = document.getElementById('detail-question-subgenre');
        gs.innerHTML = this.app.getGenreOptionsHTML(r.q.genre || '', false);
        gs.value = r.q.genre || '';
        ss.innerHTML = this.app.getSubgenreOptionsHTML(r.q.genre || '', r.q.subgenre || '', false);
        ss.value = r.q.subgenre || '';

        this.app.renderDetailPronunciations(r.q);
        this.app.switchQuestionDetailTab('basic');
        const modal = document.getElementById('question-detail-modal');
        const panel = document.getElementById('question-detail-panel');
        modal.classList.remove('hidden');
        void modal.offsetWidth;
        modal.classList.remove('opacity-0');
        panel.classList.remove('scale-95');
    }

    /**
     * 問題詳細編集モーダルを閉じる
     */
    closeQuestionDetail() {
        const modal = document.getElementById('question-detail-modal');
        const panel = document.getElementById('question-detail-panel');
        modal.classList.add('opacity-0');
        panel.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }

    /**
     * 問題詳細の変更を保存
     * フォーム内容を問題データに反映し、セット間移動・上限チェック・UI更新を実行
     */
    saveQuestionDetail() {
        const id = document.getElementById('detail-question-id').value;
        const r = this.findManagerQuestionById(id);
        if (!r.q) return this.app.showToast('問題が見つかりません', 'error');

        const qText = document.getElementById('detail-question-q').value.trim();
        const aText = document.getElementById('detail-question-a').value.trim();
        if (!qText || !aText) return this.app.showToast('問題文と解答を入力してください', 'error');

        const moveSetSelect = document.getElementById('detail-question-move-set');
        const destinationId = moveSetSelect && moveSetSelect.value ? moveSetSelect.value : r.set.id;
        const destination = this.app.studySets.find(set => set.id === destinationId);
        if (!destination) return this.app.showToast('移動先の学習セットが見つかりません', 'error');

        const isMoving = destination.id !== r.set.id;
        // MAX_QUESTIONS_PER_SET はグローバル定数と想定
        const maxQuestions = typeof MAX_QUESTIONS_PER_SET !== 'undefined' ? MAX_QUESTIONS_PER_SET : 1000;
        if (isMoving && destination.questions.length >= maxQuestions) return this.app.showToast(`移動先の登録上限(${maxQuestions}問)に達しています。`, 'error');

        r.q.q = qText;
        const confirmPointElement = document.getElementById('detail-confirm-point');
        const cpInput = Number(confirmPointElement && confirmPointElement.value ? confirmPointElement.value : 0);
        r.q.confirmPoint = Number.isFinite(cpInput) && cpInput > 0 ? Math.min(qText.length, Math.round(cpInput)) : 0;
        r.q.a = aText;
        r.q.explanation = document.getElementById('detail-question-explanation').value.trim();
        r.q.genre = document.getElementById('detail-question-genre').value || '';
        r.q.subgenre = r.q.genre ? (document.getElementById('detail-question-subgenre').value || '') : '';

        if (isMoving) {
            r.set.questions.splice(r.index, 1);
            destination.questions.push(r.q);
        } else {
            r.set.questions[r.index] = r.q;
        }

        this.app.saveStudySets();
        this.app.updateSetSelectors();
        this.app.renderManagerStats();
        this.renderQuestionList();

        const quizSet = this.app.studySets.find(set => set.id === this.app.activeSetId);
        const current = quizSet && quizSet.questions && quizSet.questions[this.app.currentQuestionIndex] ? quizSet.questions[this.app.currentQuestionIndex] : null;
        if (current && this.app.getQuestionId(current) === id) {
            document.getElementById('quiz-question-text').textContent = r.q.q;
            document.getElementById('quiz-answer-text').textContent = r.q.a;
            document.getElementById('quiz-explanation-text').textContent = r.q.explanation || '解説はありません。';
        }
        this.closeQuestionDetail();
        this.app.showToast(isMoving ? `問題を「${destination.name}」へ移動して保存しました` : '問題を保存しました', 'success');
    }

    /**
     * 問題詳細モーダルから問題を削除
     * ユーザー確認後、問題を削除しモーダルを閉じる
     */
    async deleteQuestionFromDetail() {
        const id = document.getElementById('detail-question-id').value;
        const r = this.findManagerQuestionById(id);
        if (!r.q) return;
        if (!(await this.app.showModal('問題の削除', `この問題を削除しますか？\n\n${r.q.q}`, '削除する', 'bg-red-600 hover:bg-red-700'))) return;
        r.set.questions.splice(r.index, 1);
        this.app.saveStudySets();
        this.app.renderManagerStats();
        this.renderQuestionList();
        this.closeQuestionDetail();
        this.app.showToast('問題を削除しました', 'success');
    }

    /**
     * 現在のクイズ出題中の問題を詳細編集で開く
     * クイズ中の問題をマネージャーで即座に編集できるショートカット
     */
    openCurrentQuizQuestionDetail() {
        const set = this.app.studySets.find(s => s.id === this.app.activeSetId);
        const q = set && set.questions && this.app.currentQuestionIndex >= 0 ? set.questions[this.app.currentQuestionIndex] : null;
        if (!q) return this.app.showToast('現在の問題が見つかりません', 'error');
        this.app.managerSetId = this.app.activeSetId;
        this.app.updateSetSelectors();
        this.openQuestionDetail(this.app.getQuestionId(q));
    }

    // =========================
    // 一括編集
    // =========================

    /**
     * 一括編集対象のセットを取得
     * 優先順位：bulkEditSetId > managerSetId > 最初のセット
     * @returns {Object|null} 一括編集対象のセット
     */
    getBulkEditSet() {
        const fallbackId = this.app.studySets && this.app.studySets.length ? this.app.studySets[0].id : null;
        const id = this.app.bulkEditSetId || this.app.managerSetId || fallbackId;
        return this.app.studySets.find(set => set.id === id) || this.app.studySets[0] || null;
    }

    /**
     * 一括編集リストをレンダリング
     * セット内の問題を20問ずつ表示し、チェックボックスで選択、ページネーション対応。
     * 各問題の選択状態・ページ内全選択状態を同期
     */
    renderBulkEditList() {
        const sourceSelect = document.getElementById('manager-bulk-set-select');
        if (!sourceSelect) return;
        if (!this.app.bulkEditSetId || !this.app.studySets.some(set => set.id === this.app.bulkEditSetId)) {
            const fallbackId = this.app.studySets && this.app.studySets.length ? this.app.studySets[0].id : null;
            this.app.bulkEditSetId = this.app.managerSetId || fallbackId || null;
        }
        sourceSelect.innerHTML = this.app.getDisplayOrderedSets().map(set => `<option value="${set.id}">${set.favorite ? '★ ' : ''}${this.app.escapeHTML(set.name)}</option>`).join('');
        sourceSelect.value = this.app.bulkEditSetId || '';

        const targetSelect = document.getElementById('manager-bulk-move-target');
        if (targetSelect) {
            const current = targetSelect.value;
            const targets = this.app.studySets.filter(set => set.id !== this.app.bulkEditSetId);
            targetSelect.innerHTML = targets.length ? targets.map(set => `<option value="${set.id}">${this.app.escapeHTML(set.name)}</option>`).join('') : '<option value="">移動先がありません</option>';
            if (targets.some(set => set.id === current)) targetSelect.value = current;
        }

        const set = this.getBulkEditSet();
        const questions = set && set.questions ? set.questions : [];
        const size = 20;
        const validIds = new Set(questions.map(q => this.app.getBulkQuestionKey(q)));
        this.app.bulkEditSelectedIds = new Set([...this.app.bulkEditSelectedIds].filter(id => validIds.has(id)));

        this.app.bulkEditTotalPages = Math.max(1, Math.ceil(questions.length / size));
        this.app.bulkEditPage = Math.max(1, Math.min(this.app.bulkEditPage || 1, this.app.bulkEditTotalPages));
        const start = (this.app.bulkEditPage - 1) * size;
        const pageItems = questions.slice(start, start + size);

        const list = document.getElementById('manager-bulk-question-list');
        const empty = document.getElementById('manager-bulk-question-empty');
        const pager = document.getElementById('manager-bulk-question-pager');

        if (list) {
            list.innerHTML = pageItems.map((q, i) => {
                const key = this.app.getBulkQuestionKey(q);
                const checked = this.app.bulkEditSelectedIds.has(key);
                return `<label class="p-3 hover:bg-soft-green-50 flex items-start gap-3 cursor-pointer"><input type="checkbox" data-bulk-question-id="${this.app.escapeHTML(key)}" ${checked ? 'checked' : ''} onchange="app.questionManager.toggleBulkQuestionSelection('${this.app.escapeHTML(key)}',this.checked)" class="mt-1 w-4 h-4 rounded text-soft-green-600"><div class="min-w-0 flex-1"><div class="text-xs text-soft-green-500 font-semibold">#${start + i + 1} ・ ${this.app.escapeHTML(q.genre || '未設定')}${q.subgenre ? ' / ' + this.app.escapeHTML(q.subgenre) : ''}</div><p class="text-sm font-bold text-soft-green-900 break-words">${this.app.escapeHTML(q.q)}</p><p class="text-xs text-soft-green-700 mt-1">解答: <span class="font-semibold">${this.app.escapeHTML(q.a)}</span></p></div></label>`;
            }).join('');
        }

        if (list) list.classList.toggle('hidden', !questions.length);
        if (empty) empty.classList.toggle('hidden', !!questions.length);
        if (pager) pager.classList.toggle('hidden', !questions.length);

        const info = document.getElementById('manager-bulk-page-info');
        if (info) info.textContent = `${this.app.bulkEditPage} / ${this.app.bulkEditTotalPages}`;

        [['manager-bulk-first', this.app.bulkEditPage <= 1],
         ['manager-bulk-prev', this.app.bulkEditPage <= 1],
         ['manager-bulk-next', this.app.bulkEditPage >= this.app.bulkEditTotalPages],
         ['manager-bulk-last', this.app.bulkEditPage >= this.app.bulkEditTotalPages]].forEach(([id, disabled]) => {
            const b = document.getElementById(id);
            if (b) b.disabled = disabled;
        });

        const pageSelect = document.getElementById('manager-bulk-select-page');
        if (pageSelect) {
            pageSelect.checked = pageItems.length > 0 && pageItems.every(q => this.app.bulkEditSelectedIds.has(this.app.getBulkQuestionKey(q)));
            pageSelect.indeterminate = pageItems.some(q => this.app.bulkEditSelectedIds.has(this.app.getBulkQuestionKey(q))) && !pageSelect.checked;
        }
        const count = document.getElementById('manager-bulk-selected-count');
        if (count) count.textContent = this.app.bulkEditSelectedIds.size;
    }

    /**
     * 一括編集対象セットを切り替え
     * セット変更時は選択状態をリセットしページを初期化
     * @param {string} id - 新しい対象セットID
     */
    changeBulkEditSet(id) {
        this.app.bulkEditSetId = id;
        this.app.bulkEditPage = 1;
        this.app.bulkEditSelectedIds.clear();
        this.renderBulkEditList();
    }

    /**
     * 一括編集で選択した問題を削除
     * ユーザー確認後、選択問題をセットから削除
     */
    async deleteSelectedBulkQuestions() {
        const set = this.getBulkEditSet();
        const count = this.app.bulkEditSelectedIds.size;
        if (!set || !count) return this.app.showToast('削除する問題を選択してください', 'info');
        if (!(await this.app.showModal('問題の一括削除', `選択した${count}問を削除しますか？`, '削除する', 'bg-red-600 hover:bg-red-700'))) return;

        set.questions = set.questions.filter(q => !this.app.bulkEditSelectedIds.has(this.app.getBulkQuestionKey(q)));
        this.app.bulkEditSelectedIds.clear();
        this.app.saveStudySets();
        this.app.renderManagerStats();
        this.renderQuestionList();
        this.renderBulkEditList();
        this.app.showToast(`${count}問を削除しました`, 'success');
    }

    /**
     * 一括編集で選択した問題を別セットに移動
     * 移動先の上限チェック、ユーザー確認後に問題を移動
     */
    async moveSelectedBulkQuestions() {
        const source = this.getBulkEditSet();
        const targetSelect = document.getElementById('manager-bulk-move-target');
        const targetId = targetSelect && targetSelect.value ? targetSelect.value : '';
        const target = this.app.studySets.find(set => set.id === targetId);
        const count = this.app.bulkEditSelectedIds.size;

        if (!source || !count) return this.app.showToast('移動する問題を選択してください', 'info');
        if (!target) return this.app.showToast('移動先の学習セットを選択してください', 'error');

        const maxQuestions = typeof MAX_QUESTIONS_PER_SET !== 'undefined' ? MAX_QUESTIONS_PER_SET : 1000;
        if (target.questions.length + count > maxQuestions) return this.app.showToast(`移動先の登録上限(${maxQuestions}問)を超えます`, 'error');

        if (!(await this.app.showModal('問題の一括移動', `選択した${count}問を「${target.name}」へ移動しますか？`, '移動する', 'bg-indigo-600 hover:bg-indigo-700'))) return;

        const moving = source.questions.filter(q => this.app.bulkEditSelectedIds.has(this.app.getBulkQuestionKey(q)));
        source.questions = source.questions.filter(q => !this.app.bulkEditSelectedIds.has(this.app.getBulkQuestionKey(q)));
        target.questions.push(...moving);
        this.app.bulkEditSelectedIds.clear();
        this.app.saveStudySets();
        this.app.renderManagerStats();
        this.renderQuestionList();
        this.renderBulkEditList();
        this.app.showToast(`${moving.length}問を移動しました`, 'success');
    }

    /**
     * 一括編集で問題の選択状態を切り替え
     * チェックボックス状態を内部状態に同期してリスト再表示
     * @param {string} id - 問題キー
     * @param {boolean} checked - 選択状態
     */
    toggleBulkQuestionSelection(id, checked) {
        if (checked) this.app.bulkEditSelectedIds.add(String(id));
        else this.app.bulkEditSelectedIds.delete(String(id));
        this.renderBulkEditList();
    }

    /**
     * 一括編集でページ内の全問題を一括選択/解除
     * 現在表示されているページの20問を一括で選択状態切り替え
     * @param {boolean} checked - 選択状態
     */
    toggleBulkPageSelection(checked) {
        const set = this.getBulkEditSet();
        const size = 20;
        const start = (this.app.bulkEditPage - 1) * size;
        const questions = set && set.questions ? set.questions : [];
        questions.slice(start, start + size).forEach(q => {
            const id = this.app.getBulkQuestionKey(q);
            if (checked) this.app.bulkEditSelectedIds.add(id);
            else this.app.bulkEditSelectedIds.delete(id);
        });
        this.renderBulkEditList();
    }

    // =========================
    // AI機能
    // =========================

    /**
     * 問題詳細から単一問題の解説をAI生成
     * Gemini APIで問題文・解答から自動解説を生成してフォームに設定
     */
    async generateExplanationForQuestion() {
        if (!this.app.geminiApiKey) {
            return this.app.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        }
        const q = document.getElementById('detail-question-q').value.trim();
        const a = document.getElementById('detail-question-a').value.trim();

        if (!q || !a) {
            return this.app.showToast('問題文と解答を入力してください', 'error');
        }

        const btn = document.getElementById('detail-ai-explanation-btn');
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '生成中...';

        try {
            const prompt = this.app.buildAIExplanationPrompt(q, a);
            const exp = (await this.app.fetchGemini(prompt, false)).trim().replace(/^```[a-z]*|```$/gi, '').trim();
            document.getElementById('detail-question-explanation').value = exp;
            this.app.showToast('AI解説を再セットしました', 'success');
        } catch (e) {
            this.app.showToast('AI解説生成に失敗しました: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = oldText;
        }
    }

    /**
     * マネージャーセット内の解説未設定問題を一括でAI生成
     * 優先度順（不正解多い→未学習→既習）に最大制限問を生成し、バッチ処理で効率化
     */
    async createBulkExplanationsForManagerSet() {
        if (!this.app.geminiApiKey) return this.app.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        const set = this.app.studySets.find(s => s.id === this.app.managerSetId);
        if (!set) return this.app.showToast('学習セットが見つかりません', 'error');

        const priority = q => {
            const total = Number(q.total) || 0;
            const accuracy = total > 0 ? (Number(q.correct) || 0) / total : 1;
            if (total > 0 && accuracy === 0) return 1;
            if (total > 0 && accuracy < 0.5) return 2;
            if (total === 0) return 3;
            return 4;
        };

        const limit = typeof CSV_EXPLANATION_LIMIT !== 'undefined' ? CSV_EXPLANATION_LIMIT : 20;
        const maxPrompts = typeof CSV_EXPLANATION_PROMPT_LIMIT !== 'undefined' ? CSV_EXPLANATION_PROMPT_LIMIT : 10;
        const batchSize = typeof CSV_EXPLANATION_BATCH_SIZE !== 'undefined' ? CSV_EXPLANATION_BATCH_SIZE : 10;

        const targets = set.questions.filter(q => !(q.explanation || '').trim())
            .map((q, index) => ({ q, index, priority: priority(q) }))
            .sort((a, b) => a.priority - b.priority || a.index - b.index)
            .slice(0, limit).map(x => x.q);

        const remaining = set.questions.filter(q => !(q.explanation || '').trim()).length;
        if (!targets.length) return this.app.showToast('解説未設定の問題はありません', 'success');

        const confirmed = await this.app.showModal('AI解説一括作成', `解説未設定の${remaining}問から、優先度順に最大${limit}問の解説を作成します。\nプロンプトは最大${maxPrompts}回です。実行しますか？`, '作成する', 'bg-amber-500 hover:bg-amber-600');
        if (!confirmed) return;

        const btn = document.getElementById('manager-bulk-explanation-btn');
        const status = document.getElementById('manager-bulk-explanation-status');
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '解説作成中...';
        btn.classList.add('opacity-70', 'cursor-not-allowed');

        try {
            await this.app.fillExplanationsWithAI(targets, status, batchSize, maxPrompts);
            const created = targets.filter(q => (q.explanation || '').trim()).length;
            this.app.saveStudySets();
            this.app.renderManagerStats();
            this.renderQuestionList();
            this.app.showToast(`${created}問のAI解説を作成して保存しました`, 'success');
        } catch (e) {
            this.app.saveStudySets();
            this.renderQuestionList();
            this.app.showToast('AI解説一括作成に失敗しました: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = oldText;
            btn.classList.remove('opacity-70', 'cursor-not-allowed');
        }
    }

    /**
     * 問題詳細から単一問題のジャンルをAI自動判定
     * Gemini APIで問題文・解答からジャンル・サブジャンルを判定してドロップダウンに反映
     */
    async classifyQuestionGenreForDetail() {
        if (!this.app.geminiApiKey) return this.app.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        const q = document.getElementById('detail-question-q').value.trim();
        const a = document.getElementById('detail-question-a').value.trim();
        if (!q || !a) return this.app.showToast('問題文と解答を入力してください', 'error');

        const btn = document.getElementById('detail-ai-genre-btn');
        const old = btn.textContent;
        btn.disabled = true;
        btn.textContent = '判定中...';

        try {
            const candidates = Object.entries(AI_SUBGENRES).map(([g, subs]) => `${g}: ${subs.join('、')}`).join('\n');
            const prompt = `以下のクイズ問題を候補のジャンルとサブジャンルから分類してください。JSONのみ返してください。\n形式:{"genre":"ジャンル","subgenre":"サブジャンル"}\n候補:\n${candidates}\nQ:${q}\nA:${a}`;
            const parsed = this.app.aiManager.parseAIJSON(await this.app.fetchGemini(prompt, true));
            const genre = String(parsed.genre || '');
            const sub = String(parsed.subgenre || '');
            const defs = AI_SUBGENRES;

            if (!defs[genre]) throw new Error('候補内のジャンルを判定できませんでした');
            document.getElementById('detail-question-genre').value = genre;

            const ss = document.getElementById('detail-question-subgenre');
            ss.innerHTML = this.app.getSubgenreOptionsHTML(genre, sub, false);
            if ([...ss.options].some(o => o.value === sub)) ss.value = sub;
            this.app.showToast(`ジャンルを自動判定しました: ${genre}${sub ? ' / ' + sub : ''}`, 'success');
        } catch (e) {
            this.app.showToast('ジャンル自動判定に失敗しました: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = old;
        }
    }

    /**
     * マネージャーセット内のジャンル未設定問題を一括でAI判定
     * 優先度順に最大制限問を判定し、ジャンル・サブジャンルを自動セット
     */
    async classifyUnsetGenresForManagerSet() {
        if (!this.app.geminiApiKey) return this.app.showToast('Gemini APIキーを設定画面で登録してください', 'error');
        const set = this.app.studySets.find(s => s.id === this.app.managerSetId);
        if (!set) return this.app.showToast('学習セットが見つかりません', 'error');

        const targets = set.questions.filter(q => !(q.genre || '').trim());
        if (targets.length === 0) return this.app.showToast('ジャンル未設定の問題はありません', 'success');

        const limit = typeof BULK_GENRE_CLASSIFY_LIMIT !== 'undefined' ? BULK_GENRE_CLASSIFY_LIMIT : 20;
        const batch = targets.slice(0, limit).map((q, idx) => ({ idx, q: this.app.normalizeQuestionData(q) }));
        const confirmed = await this.app.showModal('ジャンル一括自動判定', `ジャンル未設定の問題 ${targets.length}問のうち、1回あたり最大${limit}問を自動判定します。\n今回 ${batch.length}問を判定して保存しますか？`, '判定する', 'bg-soft-green-600 hover:bg-soft-green-700');
        if (!confirmed) return;

        const btn = document.getElementById('manager-bulk-genre-btn');
        const status = document.getElementById('manager-bulk-genre-status');
        const oldText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '判定中...'; btn.classList.add('opacity-70', 'cursor-not-allowed'); }
        if (status) status.textContent = `${batch.length}問を判定中...`;

        try {
            const candidates = Object.entries(AI_SUBGENRES).map(([g, subs]) => `${g}: ${subs.join('、')}`).join('\n');
            const items = batch.map(item => `[${item.idx}] Q:${item.q.q}\nA:${item.q.a}`).join('\n\n');
            const prompt = `以下のクイズ問題を、候補のジャンルとサブジャンルから分類してください。\n出力は必ずJSON配列のみとし、説明文やMarkdownは不要です。\n形式:[{"idx":0,"genre":"ジャンル","subgenre":"サブジャンル"}]\nidxは入力の番号をそのまま返してください。genreは候補ジャンルから、subgenreはそのgenreの候補サブジャンルから選んでください。判断が難しい場合も最も近い候補を1つ選んでください。\n\n候補:\n${candidates}\n\n問題:\n${items}`;
            const parsed = this.app.aiManager.parseAIJSON(await this.app.fetchGemini(prompt, true));

            if (!Array.isArray(parsed)) throw new Error('JSON配列として解析できませんでした');
            const defs = AI_SUBGENRES;
            let updated = 0, skipped = 0;

            parsed.forEach(item => {
                const idx = Number(item.idx);
                const target = batch.find(x => x.idx === idx);
                if (!target) { skipped++; return; }
                const genre = String(item.genre || '').trim();
                let subgenre = String(item.subgenre || '').trim();
                if (!defs[genre]) { skipped++; return; }
                if (subgenre && !defs[genre].includes(subgenre)) subgenre = '';
                target.q.genre = genre;
                target.q.subgenre = subgenre;
                updated++;
            });

            this.app.saveStudySets();
            this.app.renderManagerStats();
            this.renderQuestionList();
            this.app.showToast(`${updated}問のジャンルを自動判定して保存しました${skipped ? `（スキップ: ${skipped}問）` : ''}`, 'success');
        } catch (e) {
            this.app.showToast('ジャンル一括自動判定に失敗しました: ' + e.message, 'error');
            this.renderQuestionList();
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = oldText || 'ジャンル一括自動判定'; btn.classList.remove('opacity-70', 'cursor-not-allowed'); }
        }
    }

    // =========================
    // 重複統合
    // =========================

    /**
     * 重複問題の自動検出とマージUI表示
     * 完全一致は自動統合、同一解答で異なる問題文は確認ダイアログで統合対象を選択
     */
    async checkAndMergeDuplicateQuestions() {
        const select = document.getElementById('manager-question-set-select');
        const setId = select && select.value ? select.value : this.app.managerSetId;
        const set = this.app.studySets.find(s => s.id === setId);
        if (!set) return this.app.showToast('選択中の学習セットが見つかりません', 'error');
        if (set.questions.length < 2) return this.app.showToast('重複チェック対象の問題がありません', 'info');

        const exactMap = new Map();
        set.questions.forEach((q, index) => {
            const key = `${this.normalizeQuestionForDuplicateMerge(q.q)}|${this.normalizeQuestionForDuplicateMerge(q.a)}`;
            if (!exactMap.has(key)) exactMap.set(key, []);
            exactMap.get(key).push({ q, index });
        });

        let exactMerged = 0;
        [...exactMap.values()].filter(group => group.length > 1).forEach(group => {
            exactMerged += this.mergeExactDuplicateGroup(set, group);
        });

        const answerMap = new Map();
        set.questions.forEach((q, index) => {
            const key = this.normalizeQuestionForDuplicateMerge(q.a);
            if (!key) return;
            if (!answerMap.has(key)) answerMap.set(key, []);
            answerMap.get(key).push({ q, index });
        });

        const ambiguous = [...answerMap.values()].filter(group => {
            if (group.length < 2) return false;
            return new Set(group.map(x => this.normalizeQuestionForDuplicateMerge(x.q.q))).size > 1;
        });

        if (!ambiguous.length) {
            if (exactMerged > 0) {
                this.app.saveStudySets();
                this.app.renderManagerStats();
                this.renderQuestionList();
                return this.app.showToast(`問題文・解答が同一の重複を${exactMerged}問統合しました`, 'success');
            }
            return this.app.showToast('統合対象の重複問題はありませんでした', 'info');
        }

        this.app.pendingDuplicateMerge = { setId, groups: ambiguous, exactMerged };
        document.getElementById('duplicate-merge-summary').textContent =
            `完全一致の自動統合: ${exactMerged}問 / 選択が必要な同一解答グループ: ${ambiguous.length}件`;
        document.getElementById('duplicate-merge-groups').innerHTML = ambiguous.map((group, groupIndex) => {
            const answer = this.app.escapeHTML(group[0].q.a || '');
            const options = group.map((entry, optionIndex) => {
                const q = entry.q;
                const accuracy = Number(q.total) > 0 ? Math.round((Number(q.correct) || 0) / Number(q.total) * 100) + '%' : '--%';
                return `<label class="block border border-soft-green-200 rounded-xl p-3 hover:bg-purple-50 cursor-pointer">
                    <div class="flex gap-3 items-start">
                        <input type="radio" name="duplicate-group-${groupIndex}" value="${optionIndex}" ${optionIndex === 0 ? 'checked' : ''} class="mt-1">
                        <div class="min-w-0">
                            <p class="text-sm font-bold text-soft-green-900 whitespace-pre-wrap">${this.app.escapeHTML(q.q || '')}</p>
                            <p class="text-xs text-soft-green-600 mt-1">ID: ${this.app.escapeHTML(q.questionId || q.id || '')} / 成績: ${Number(q.correct) || 0}正解・${Number(q.total) || 0}回答 / 正解率: ${accuracy}</p>
                        </div>
                    </div>
                </label>`;
            }).join('');
            const noMerge = `<label class="block border border-gray-300 rounded-xl p-3 hover:bg-gray-50 cursor-pointer"><div class="flex gap-3 items-start"><input type="radio" name="duplicate-group-${groupIndex}" value="none" class="mt-1"><div><p class="text-sm font-bold text-gray-800">統合しない</p><p class="text-xs text-gray-600 mt-1">このグループの問題をすべて残します。</p></div></div></label>`;
            return `<section class="border border-purple-200 rounded-2xl p-4 bg-purple-50/30">
                <h4 class="font-bold text-purple-900 mb-3">解答: ${answer}</h4>
                <div class="space-y-2">${options}${noMerge}</div>
            </section>`;
        }).join('');

        const modal = document.getElementById('duplicate-merge-modal');
        const panel = document.getElementById('duplicate-merge-panel');
        modal.classList.remove('hidden');
        void modal.offsetWidth;
        modal.classList.remove('opacity-0');
        panel.classList.remove('scale-95');
    }

    /**
     * 重複統合ダイアログで選択された統合を実行
     * ユーザーが選択した統合対象を削除し、成績データを統合
     */
    applySelectedDuplicateMerges() {
        const pending = this.app.pendingDuplicateMerge;
        const set = pending && pending.setId ? this.app.studySets.find(s => s.id === pending.setId) : null;
        if (!pending || !set) return this.app.showToast('統合対象が見つかりません', 'error');

        const remove = new Set();
        pending.groups.forEach((group, groupIndex) => {
            const checkedInput = document.querySelector(`input[name="duplicate-group-${groupIndex}"]:checked`);
            const selectedValue = checkedInput && checkedInput.value ? checkedInput.value : '0';
            if (selectedValue === 'none') return;
            const selected = Number(selectedValue);
            group.forEach((entry, optionIndex) => { if (optionIndex !== selected) remove.add(entry.q); });
        });

        set.questions = set.questions.filter(q => !remove.has(q));
        const selectedMerged = remove.size;
        this.app.pendingDuplicateMerge = null;

        this.app.saveStudySets();
        this.app.renderManagerStats();
        this.renderQuestionList();
        this.closeDuplicateMergeModal();
        this.app.showToast(`重複問題を統合しました（完全一致: ${pending.exactMerged}問、選択統合: ${selectedMerged}問）`, 'success');
    }

    /**
     * 重複統合ダイアログを閉じる
     */
    closeDuplicateMergeModal() {
        const modal = document.getElementById('duplicate-merge-modal');
        const panel = document.getElementById('duplicate-merge-panel');
        modal.classList.add('opacity-0');
        panel.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }

    // =========================
    // 問題整理
    // =========================

    /**
     * 高い正解率・習熟度の問題を削除
     * 習熟度または正解率の上位を指定数またはパーセント削除。十分理解した問題の整理に使用
     */
    async deleteHighAccuracyQuestions() {
        const targetSet = this.app.studySets.find(s => s.id === this.app.managerSetId);
        if (!targetSet || targetSet.questions.length === 0) return this.app.showToast('問題がありません', 'error');

        const metricElement = document.getElementById('manager-delete-metric');
        const metric = metricElement && metricElement.value ? metricElement.value : 'mastery';
        const modeElement = document.getElementById('manager-delete-mode');
        const mode = modeElement && modeElement.value ? modeElement.value : 'percent';
        const percentElement = document.getElementById('manager-delete-percent');
        const percent = parseInt(percentElement && percentElement.value ? percentElement.value : '10', 10);
        const inputCountElement = document.getElementById('manager-delete-count');
        const inputCount = parseInt(inputCountElement && inputCountElement.value ? inputCountElement.value : '', 10);

        const metricLabel = metric === 'mastery' ? '習熟度' : '正解率';
        const deletable = metric === 'mastery' ? [...targetSet.questions] : targetSet.questions.filter(q => q.total > 0 && this.app.getAccuracyRatio(q) > 0);

        if (!deletable.length) return this.app.showToast(`削除対象の問題がありません`, 'error');

        deletable.sort((a, b) => {
            const valueA = metric === 'mastery' ? this.app.getMasteryMetrics(a).score : this.app.getAccuracyRatio(a);
            const valueB = metric === 'mastery' ? this.app.getMasteryMetrics(b).score : this.app.getAccuracyRatio(b);
            if (valueA !== valueB) return valueB - valueA;
            return (b.total || 0) - (a.total || 0);
        });

        let deleteCount, label;
        if (mode === 'count') {
            if (!Number.isInteger(inputCount) || inputCount < 1 || inputCount > 999) return this.app.showToast('削除する問題数は1〜999の整数で入力してください', 'error');
            deleteCount = Math.min(inputCount, deletable.length);
            label = `${metricLabel}上位 ${deleteCount}問`;
        } else {
            deleteCount = Math.ceil(deletable.length * (percent / 100));
            label = `${metricLabel}上位 ${percent}%（${deleteCount}問）`;
        }

        if (!(await this.app.showModal('確認', `${label} の問題を削除しますか？`, '削除する', 'bg-red-600 hover:bg-red-700'))) return;

        const toDelete = new Set(deletable.slice(0, deleteCount));
        const initialLen = targetSet.questions.length;
        targetSet.questions = targetSet.questions.filter(q => !toDelete.has(q));

        this.app.saveStudySets();
        this.app.renderManagerStats();
        this.renderQuestionList();
        this.renderBulkEditList();
        this.app.showToast(`${initialLen - targetSet.questions.length}問を削除しました`, 'success');
    }

    /**
     * マネージャーセット内の全問題データをリセット
     * セット自体は保持したまま、問題すべてを削除。確認ダイアログ付き
     */
    async clearManagerSetData() {
        const targetSet = this.app.studySets.find(s => s.id === this.app.managerSetId);
        const confirmed = await this.app.showModal('確認', `学習セット「${targetSet.name}」の問題をすべてリセットしますか？\nセット自体は削除されません。`, 'リセットする', 'bg-red-600 hover:bg-red-700');
        if (confirmed) {
            targetSet.questions = [];
            this.app.saveStudySets();
            this.app.renderManagerStats();
            this.app.showToast('問題データをリセットしました', 'info');
        }
    }

    // =========================
    // ユーティリティ
    // =========================
    /**
     * 重複判定用にテキストを正規化
     * NFKC 正規化、小文字化、スペース・句読点・記号を除去して比較可能に
     * @param {string} text - 正規化対象テキスト
     * @returns {string} 正規化済みテキスト
     */    normalizeQuestionForDuplicateMerge(text) {
        return String(text || '').normalize('NFKC').toLowerCase()
            .replace(/[\s 、。,.，・:：;；!?！？'"“”‘’「」『』【】()（）\[\]［］]/g, '');
    }

    /**
     * 完全重複グループを統合
     * 複数の重複問題から1つを保持し、成績データを合算。説明・ジャンル・音声設定をマージ
     * @param {Object} set - 対象のセット
     * @param {Array} entries - 重複グループの問題配列
     * @returns {number} 削除した問題数
     */
    mergeExactDuplicateGroup(set, entries) {
        const ordered = [...entries].sort((a, b) =>
            this.getQuestionIdOrderValue(a.q, a.index) - this.getQuestionIdOrderValue(b.q, b.index) || a.index - b.index
        );
        const keeper = ordered[0].q;
        keeper.correct = ordered.reduce((sum, x) => sum + (Number(x.q.correct) || 0), 0);
        keeper.total = ordered.reduce((sum, x) => sum + (Number(x.q.total) || 0), 0);
        keeper.accuracy = keeper.total > 0 ? keeper.correct / keeper.total : 0;

        const latest = [...ordered].sort((a, b) => (Number(b.q.lastAnsweredAt) || 0) - (Number(a.q.lastAnsweredAt) || 0))[0];
        const latestQ = latest ? latest.q : null;
        keeper.lastAnsweredAt = latestQ ? latestQ.lastAnsweredAt || null : null;
        keeper.lastResult = latestQ && (latestQ.lastResult === true || latestQ.lastResult === false) ? latestQ.lastResult : null;
        keeper.streak = Number(latestQ && latestQ.streak ? latestQ.streak : 0) || 0;
        keeper.level = Math.max(...ordered.map(x => Number(x.q.level) || 0));

        const fields = ['explanation', 'genre', 'subgenre', 'difficulty'];
        fields.forEach(field => {
            if (!String(keeper[field] || '').trim()) {
                const source = ordered.find(x => String(x.q[field] || '').trim());
                if (source) keeper[field] = source.q[field];
            }
        });

        const pronunciationMap = new Map();
        ordered.forEach(x => {
            const pronunciations = Array.isArray(x.q.pronunciations) ? x.q.pronunciations : [];
            pronunciations.forEach(item => {
                if (item && item.word && item.pronunciation && !pronunciationMap.has(item.word)) pronunciationMap.set(item.word, item);
            });
        });
        if (pronunciationMap.size) keeper.pronunciations = [...pronunciationMap.values()];

        const remove = new Set(ordered.slice(1).map(x => x.q));
        set.questions = set.questions.filter(q => !remove.has(q));
        return ordered.length - 1;
    }

    /**
     * 問題IDの数値部分を抽出してソート用スコア化
     * IDに含まれる数字を結合して数値化、含まれない場合は大きい値を返す
     * @param {Object} q - 問題オブジェクト
     * @param {number} fallbackIndex - フォールバック時のインデックス
     * @returns {number} ソート用スコア
     */
    getQuestionIdOrderValue(q, fallbackIndex = 0) {
        const safeQ = q || {};
        const id = String(safeQ.questionId || safeQ.id || '');
        const matches = id.match(/\d+/g);
        if (matches && matches.length) {
            const value = Number(matches.join(''));
            if (Number.isFinite(value)) return value;
        }
        return Number.MAX_SAFE_INTEGER - 100000 + fallbackIndex;
    }
}

window.QuestionManager = QuestionManager;