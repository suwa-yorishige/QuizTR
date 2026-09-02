/** 学習セットの作成、選択、名称変更、削除を管理する。 */
class SetManager {
    constructor(app) {
        this.app = app;
    }

    createEmptySet(name) {
        return { id: `set-${Date.now()}${Math.random().toString(36).substring(2)}`, name, questions: [] };
    }

    updateSetSelectors() {
        const createOptions = includeNew => {
            let html = this.app.studySets.map(set => `<option value="${set.id}">${Utils.escapeHTML(set.name)}</option>`).join('');
            if (includeNew) html += '<option value="_new_" class="font-bold text-soft-green-600">＋ 新しいセットを作成</option>';
            return html;
        };
        const selectors = [
            ['dashboard-active-set', this.app.activeSetId, false],
            ['manager-active-set', this.app.managerSetId, false],
            ['manager-question-set-select', this.app.managerSetId, false],
            ['csv-target-set', null, true],
            ['audio-export-target-set', null, false],
            ['ai-target-set', null, true]
        ];
        selectors.forEach(([id, value, includeNew]) => {
            const select = document.getElementById(id);
            if (!select) return;
            select.innerHTML = createOptions(includeNew);
            if (value) select.value = value;
        });
    }

    changeActiveSet(id) {
        this.app.activeSetId = id;
        this.app.statsManager.updateStats();
    }

    changeManagerSet(id) {
        this.app.managerSetId = id;
        this.app.questionListPage = 1;
        const set = this.app.studySets.find(item => item.id === id);
        if (set) document.getElementById('manager-set-name').value = set.name;
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