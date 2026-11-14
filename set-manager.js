/** 学習セットの作成、選択、名称変更、削除を管理する。 */
class SetManager {
    constructor(app) {
        this.app = app;
    }

    createEmptySet(name) {
        return { id: `set-${Date.now()}${Math.random().toString(36).substring(2)}`, name, questions: [], favorite: false };
    }

    getDisplayOrderedSets() {
        return this.app.studySets
            .map((set, index) => ({ set, index }))
            .sort((left, right) => Number(right.set.favorite) - Number(left.set.favorite) || left.index - right.index)
            .map(({ set }) => set);
    }

    updateSetSelectors() {
        const sets = this.getDisplayOrderedSets();
        const createOptions = includeNew => {
            let html = sets.map(set => `<option value="${set.id}">${set.favorite ? '★ ' : ''}${Utils.escapeHTML(set.name)}</option>`).join('');
            if (includeNew) html += '<option value="_new_" class="font-bold text-soft-green-600">＋ 新しいセットを作成</option>';
            return html;
        };
        const selectors = [
            ['dashboard-active-set', this.app.activeSetId, false],
            ['manager-active-set', this.app.managerSetId, false],
            ['manager-question-set-select', this.app.managerSetId, false],
            ['csv-target-set', null, true],
            ['ai-target-set', null, true]
        ];
        selectors.forEach(([id, value, includeNew]) => {
            const select = document.getElementById(id);
            if (!select) return;
            select.innerHTML = createOptions(includeNew);
            if (value) select.value = value;
        });
        this.renderMergeSetSelectors();
        this.renderAudioExportSetSelector();
    }

    renderMergeSetSelectors() {
        const sets = this.getDisplayOrderedSets();
        const optionHTML = sets.map(set =>
            `<option value="${Utils.escapeHTML(set.id)}">${Utils.escapeHTML(set.name)}（${set.questions.length}問）</option>`
        ).join('');
        const source = document.getElementById('manager-merge-source');
        const target = document.getElementById('manager-merge-target');
        if (!source || !target) return;

        const previousTargetValue = target.value;
        const sourceValue = sets.some(set => set.id === source.value) ? source.value : (sets[0] ? sets[0].id : '');
        const targetValue = sets.some(set => set.id === target.value && set.id !== sourceValue)
            ? target.value
            : ((sets.find(set => set.id !== sourceValue) || {}).id || '');
        source.innerHTML = optionHTML;
        target.innerHTML = optionHTML;
        source.value = sourceValue;
        target.value = targetValue;
        source.disabled = sets.length < 2;
        target.disabled = sets.length < 2;

        const button = document.getElementById('manager-merge-button');
        if (button) button.disabled = sets.length < 2;
        if (previousTargetValue !== targetValue) this.changeMergeTarget();
        else this.updateMergeQuestionCount();
    }

    changeMergeTarget() {
        const targetSelect = document.getElementById('manager-merge-target');
        const nameInput = document.getElementById('manager-merge-name');
        if (!targetSelect || !nameInput) return;
        const target = this.app.studySets.find(set => set.id === targetSelect.value);
        nameInput.value = target ? target.name : '';
        this.updateMergeQuestionCount();
    }

    updateMergeQuestionCount() {
        const sourceSelect = document.getElementById('manager-merge-source');
        const targetSelect = document.getElementById('manager-merge-target');
        const count = document.getElementById('manager-merge-question-count');
        if (!sourceSelect || !targetSelect || !count) return;

        const source = this.app.studySets.find(set => set.id === sourceSelect.value);
        const target = this.app.studySets.find(set => set.id === targetSelect.value);
        count.textContent = source && target
            ? `${source.questions.length}問を移動（統合後: ${source.questions.length + target.questions.length}問）`
            : '統合元と統合先を選択してください';
    }

    async mergeStudySets() {
        const sourceId = document.getElementById('manager-merge-source').value;
        const targetId = document.getElementById('manager-merge-target').value;
        const nameInput = document.getElementById('manager-merge-name');
        const source = this.app.studySets.find(set => set.id === sourceId);
        const target = this.app.studySets.find(set => set.id === targetId);
        if (!source || !target) return this.app.showToast('統合元と統合先を選択してください', 'error');
        if (source.id === target.id) return this.app.showToast('統合元と統合先には別のセットを選択してください', 'error');

        const name = nameInput.value.trim().substring(0, MAX_SET_NAME_LENGTH);
        if (!name) return this.app.showToast('統合後のセット名を入力してください', 'error');

        const mergedQuestionCount = source.questions.length + target.questions.length;
        if (mergedQuestionCount > MAX_QUESTIONS_PER_SET) {
            return this.app.showToast(`統合後の問題数がセット上限の${MAX_QUESTIONS_PER_SET}問を超えます`, 'error');
        }

        const confirmed = await this.app.showModal(
            '学習セットの統合',
            `「${source.name}」の${source.questions.length}問を「${target.name}」へ移動します。\n統合後の名称: ${name}（${mergedQuestionCount}問）\n統合元のセットは削除され、出題サイクル情報はリセットされます。問題の重複はそのまま残ります。`,
            '統合する'
        );
        if (!confirmed) return;

        const usedQuestionIds = new Set();
        this.app.studySets.filter(set => set.id !== source.id).forEach(set => {
            set.questions.forEach(question => {
                [question.id, question.questionId].filter(Boolean).forEach(id => usedQuestionIds.add(String(id)));
            });
        });
        const movedQuestions = source.questions.map(question => {
            const moved = this.app.normalizeQuestionData({ ...question });
            let id = String(this.app.getQuestionId(moved) || '');
            if (!id || usedQuestionIds.has(id)) {
                do {
                    id = `q-${Date.now()}${Math.random().toString(36).substring(2)}`;
                } while (usedQuestionIds.has(id));
            }
            moved.id = id;
            moved.questionId = id;
            usedQuestionIds.add(id);
            return moved;
        });

        const originalSets = this.app.studySets;
        const mergedTarget = {
            ...target,
            name,
            favorite: !!(source.favorite || target.favorite),
            questions: target.questions.concat(movedQuestions),
            cycleSeenQuestionIds: [],
            cycleStartedAt: null
        };
        this.app.studySets = originalSets
            .filter(set => set.id !== source.id)
            .map(set => set.id === target.id ? mergedTarget : set);

        if (!this.app.saveStudySets()) {
            this.app.studySets = originalSets;
            return;
        }

        if (this.app.activeSetId === source.id) this.app.activeSetId = target.id;
        this.app.managerSetId = target.id;
        this.app.statsManager.updateStats();
        this.updateSetSelectors();
        this.changeManagerSet(target.id);
        this.app.uiManager.showToast(`${source.questions.length}問を「${name}」に統合しました`, 'success');
    }

    renderAudioExportSetSelector() {
        const container = document.getElementById('audio-export-target-sets');
        if (!container) return;
        const selectedIds = new Set([...container.querySelectorAll('input:checked')].map(input => input.value));
        if (!selectedIds.size && this.app.studySets.length) selectedIds.add(this.app.studySets[0].id);
        container.innerHTML = this.getDisplayOrderedSets().map(set => `
            <label class="flex items-center gap-3 p-3 rounded-lg border border-soft-green-200 bg-white hover:bg-soft-green-50 cursor-pointer">
                <input type="checkbox" value="${Utils.escapeHTML(set.id)}"${selectedIds.has(set.id) ? ' checked' : ''}
                    class="audio-export-target-checkbox w-5 h-5 text-soft-green-600 border-soft-green-300 rounded focus:ring-soft-green-500 cursor-pointer">
                <span class="text-sm font-semibold text-primary">${set.favorite ? '★ ' : ''}${Utils.escapeHTML(set.name)}（${set.questions.length}問）</span>
            </label>
        `).join('');
        container.querySelectorAll('input').forEach(checkbox => {
            checkbox.addEventListener('change', event => {
                if (container.querySelectorAll('input:checked').length > 5) {
                    event.target.checked = false;
                    this.app.showToast('学習セットは最大5件まで選択できます', 'error');
                }
                this.updateAudioExportSelectionSummary();
            });
        });
        this.updateAudioExportSelectionSummary();
    }

    updateAudioExportSelectionSummary() {
        const selectedSets = this.app.getSelectedAudioSets();
        const setCount = document.getElementById('audio-export-selected-set-count');
        const questionCount = document.getElementById('audio-export-selected-question-count');
        if (setCount) setCount.textContent = selectedSets.length;
        if (questionCount) questionCount.textContent = selectedSets.reduce((total, set) => total + set.questions.length, 0);
    }

    moveSet(fromIndex, toIndex) {
        const orderedSets = this.getDisplayOrderedSets();
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= orderedSets.length || toIndex >= orderedSets.length) return;
        if (orderedSets[fromIndex].favorite !== orderedSets[toIndex].favorite) return;
        const [set] = orderedSets.splice(fromIndex, 1);
        orderedSets.splice(toIndex, 0, set);
        this.app.studySets = orderedSets;
        this.app.saveStudySets();
        this.updateSetSelectors();
        this.changeManagerSet(set.id);
    }

    moveCurrentSetUp() {
        const index = this.getDisplayOrderedSets().findIndex(set => set.id === this.app.managerSetId);
        this.moveSet(index, index - 1);
    }

    moveCurrentSetDown() {
        const index = this.getDisplayOrderedSets().findIndex(set => set.id === this.app.managerSetId);
        this.moveSet(index, index + 1);
    }

    toggleFavoriteSet() {
        const set = this.app.studySets.find(item => item.id === this.app.managerSetId);
        if (!set) return;
        set.favorite = !set.favorite;
        this.app.saveStudySets();
        this.updateSetSelectors();
        this.changeManagerSet(set.id);
        this.app.uiManager.showToast(set.favorite ? 'セットをピン留めしました' : 'セットのピン留めを解除しました', 'success');
    }

    changeActiveSet(id) {
        this.app.activeSetId = id;
        this.app.statsManager.updateStats();
    }

    changeManagerSet(id) {
        this.app.managerSetId = id;
        this.app.questionListPage = 1;
        const set = this.app.studySets.find(item => item.id === id);
        if (set) {
            document.getElementById('manager-set-name').value = set.name;
            const favoriteButton = document.getElementById('manager-favorite-set');
            if (favoriteButton) favoriteButton.textContent = set.favorite ? '★ ピン解除' : '★ ピン留め';
        }
        const questionSelect = document.getElementById('manager-question-set-select');
        if (questionSelect) questionSelect.value = id;
        this.app.statsManager.renderManagerStats();
        this.app.questionManager.renderQuestionList();
    }

    changeQuestionListSet(id) {
        this.changeManagerSet(id);
    }

    async createNewSet() {
        if (this.app.studySets.length >= MAX_SETS) return this.app.uiManager.showToast(`学習セットは最大${MAX_SETS}個までです。`, 'error');
        const name = await this.app.uiManager.showPromptModal('学習セットの新規作成', '新しい学習セットの名前を入力してください', '', '最大30文字', MAX_SET_NAME_LENGTH);
        if (name === null) return;
        const trimmedName = name.trim().substring(0, MAX_SET_NAME_LENGTH);
        if (!trimmedName) return this.app.uiManager.showToast('セット名が無効です', 'error');
        const newSet = this.createEmptySet(trimmedName);
        this.app.studySets.push(newSet);
        this.app.saveStudySets();
        this.updateSetSelectors();
        this.changeManagerSet(newSet.id);
        this.app.uiManager.showToast('新しいセットを作成しました', 'success');
    }

    async deleteManagerSet() {
        const set = this.app.studySets.find(item => item.id === this.app.managerSetId);
        if (!set) return;
        const confirmed = await this.app.uiManager.showModal('学習セットの削除', `学習セット「${set.name}」を削除しますか？\nセット内のすべての問題（${set.questions.length}問）も削除されます。`, '削除する', 'bg-red-600 hover:bg-red-700');
        if (!confirmed) return;
        this.app.studySets = this.app.studySets.filter(item => item.id !== set.id);
        if (!this.app.studySets.length) this.app.studySets.push(this.createEmptySet('最初の学習セット'));
        this.app.saveStudySets();
        if (!this.app.studySets.some(item => item.id === this.app.activeSetId)) this.app.activeSetId = this.app.studySets[0].id;
        this.updateSetSelectors();
        this.changeManagerSet(this.app.studySets[0].id);
        this.app.uiManager.showToast('セットを削除しました', 'success');
    }

    renameManagerSet() {
        const input = document.getElementById('manager-set-name');
        const set = this.app.studySets.find(item => item.id === this.app.managerSetId);
        if (!input || !set) return;
        const name = input.value.trim().substring(0, MAX_SET_NAME_LENGTH);
        if (!name) {
            this.app.uiManager.showToast('セット名を入力してください', 'error');
            input.value = set.name;
            return;
        }
        set.name = name;
        this.app.saveStudySets();
        this.updateSetSelectors();
        this.app.uiManager.showToast('セット名を変更しました', 'success');
    }
}