/** 画面遷移、モーダル、通知、タブ切替を管理する。 */
class UIManager {
    constructor(app) {
        this.app = app;
    }

    /**
     * 画面を切り替える
     * @param {*} viewId 
     */
    switchView(viewId) {
        if (viewId === 'csv-import') {
            setTimeout(() => {
                const source = document.getElementById('manager-question-set-select');
                const exportSelect = document.getElementById('csv-export-set');
                const backupSelect = document.getElementById('backup-set-select');
                if (exportSelect && source) exportSelect.innerHTML = source.innerHTML;
                if (backupSelect && source) backupSelect.innerHTML = source.innerHTML;
            }, 50);
        }
        this.app.synth.cancel();
        this.app.stopTextReveal();
        if (this.app.audioElement) this.app.audioElement.pause();
        ['dashboard', 'csv-import', 'manager', 'dictionary', 'ai-generator', 'audio-export', 'settings', 'quiz'].forEach(id => document.getElementById(`view-${id}`).classList.add('hidden'));
        document.getElementById(`view-${viewId}`).classList.remove('hidden');
        if (viewId === 'manager') {
            this.app.statsManager.renderManagerStats();
            this.app.questionManager.renderQuestionList();
            this.app.questionManager.renderBulkEditList();
            this.switchManagerTab(this.app.managerTab || 'overview');
        }
    }

    /**
     * 画面下部にトースト通知を表示する
     * @param {*} message 
     * @param {*} type 
     */
    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        document.getElementById('toast-message').textContent = message;
        document.getElementById('toast-icon').textContent = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
        toast.classList.remove('translate-y-24', 'opacity-0');
        setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), 4000);
    }

    /**
     * 入力を受け付けるモーダルを表示する
     * @param {*} title 
     * @param {*} message 
     * @param {*} defaultText 
     * @param {*} placeholder 
     * @param {*} maxLength 
     * @returns 
     */
    showPromptModal(title, message, defaultText = '', placeholder = '', maxLength = 20) {
        return new Promise(resolve => {
            const modal = document.getElementById('custom-modal');
            const panel = document.getElementById('custom-modal-panel');
            const input = document.getElementById('modal-input');
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-message').textContent = message;
            input.classList.remove('hidden'); input.value = defaultText; input.placeholder = placeholder;
            if (maxLength) input.maxLength = maxLength;
            const confirm = document.getElementById('modal-btn-confirm');
            const cancel = document.getElementById('modal-btn-cancel');
            cancel.classList.remove('hidden'); confirm.textContent = '決定';
            confirm.className = 'px-5 py-2.5 rounded-xl font-semibold text-white transition-colors shadow-md bg-soft-green-600 hover:bg-soft-green-700';
            const cleanup = () => {
                modal.classList.add('opacity-0'); panel.classList.add('scale-95');
                setTimeout(() => { modal.classList.add('hidden'); input.classList.add('hidden'); }, 300);
                confirm.removeEventListener('click', onConfirm); cancel.removeEventListener('click', onCancel);
            };
            const onConfirm = () => { cleanup(); resolve(input.value); };
            const onCancel = () => { cleanup(); resolve(null); };
            confirm.addEventListener('click', onConfirm); cancel.addEventListener('click', onCancel);
            modal.classList.remove('hidden'); void modal.offsetWidth; modal.classList.remove('opacity-0'); panel.classList.remove('scale-95');
            setTimeout(() => input.focus(), 100);
        });
    }

    /**
     * 決定・キャンセルボタン付きのモーダルを表示する
     * @param {*} title 
     * @param {*} message 
     * @param {*} confirmText 
     * @param {*} confirmColor 
     * @param {*} showCancel 
     * @returns 
     */
    showModal(title, message, confirmText = '実行する', confirmColor = 'bg-soft-green-600 hover:bg-soft-green-700', showCancel = true) {
        return new Promise(resolve => {
            const modal = document.getElementById('custom-modal');
            const panel = document.getElementById('custom-modal-panel');
            const input = document.getElementById('modal-input');
            document.getElementById('modal-title').textContent = title;
            document.getElementById('modal-message').textContent = message;
            input.classList.add('hidden');
            const confirm = document.getElementById('modal-btn-confirm');
            const cancel = document.getElementById('modal-btn-cancel');
            confirm.textContent = confirmText;
            confirm.className = `px-5 py-2.5 rounded-xl font-semibold text-white transition-colors shadow-md ${confirmColor}`;
            cancel.classList.toggle('hidden', !showCancel);
            const cleanup = () => {
                modal.classList.add('opacity-0'); panel.classList.add('scale-95');
                setTimeout(() => { modal.classList.add('hidden'); cancel.classList.remove('hidden'); }, 300);
                confirm.removeEventListener('click', onConfirm); cancel.removeEventListener('click', onCancel);
            };
            const onConfirm = () => { cleanup(); resolve(true); };
            const onCancel = () => { cleanup(); resolve(false); };
            confirm.addEventListener('click', onConfirm);
            if (showCancel) cancel.addEventListener('click', onCancel);
            modal.classList.remove('hidden'); void modal.offsetWidth; modal.classList.remove('opacity-0'); panel.classList.remove('scale-95');
        });
    }

    /**
     * 学習セット管理画面のタブを切り替える
     * @param {*} tab 
     */
    switchManagerTab(tab) {
        this.app.managerTab = ['overview', 'questions', 'bulk'].includes(tab) ? tab : 'overview';
        document.querySelectorAll('.manager-overview-section').forEach(element => element.classList.toggle('hidden', this.app.managerTab !== 'overview'));
        document.querySelectorAll('.manager-questions-section').forEach(element => element.classList.toggle('hidden', this.app.managerTab !== 'questions'));
        document.querySelectorAll('.manager-bulk-section').forEach(element => element.classList.toggle('hidden', this.app.managerTab !== 'bulk'));
        const buttons = { overview: document.getElementById('manager-tab-btn-overview'), questions: document.getElementById('manager-tab-btn-questions'), bulk: document.getElementById('manager-tab-btn-bulk') };
        Object.entries(buttons).forEach(([key, button]) => { if (button) button.className = `flex-1 px-4 py-2 rounded-xl font-bold text-sm transition-colors ${this.app.managerTab === key ? 'bg-soft-green-600 text-white shadow-sm' : 'text-soft-green-800 hover:bg-soft-green-100'}`; });
        if (this.app.managerTab === 'questions') this.app.questionManager.renderQuestionList();
        if (this.app.managerTab === 'bulk') this.app.questionManager.renderBulkEditList();
    }

    /**
     * 学習成績の分布タブを切り替える
     * @param {'accuracy'|'mastery'} metric
     */
    switchDistributionTab(metric) {
        this.app.managerDistributionMetric = metric === 'mastery' ? 'mastery' : 'accuracy';
        this.app.statsManager.renderManagerStats();
    }

    /**
     * 
     * @param {'aql'|'qma'} standard
     */
    switchGenreAnalysisTab(standard) {
        this.app.managerGenreStandard = standard === 'qma' ? 'qma' : 'aql';
        this.app.statsManager.renderManagerStats();
    }

    /**
     * AI問題生成タブを切り替える
     * @param {'normal'|'memo'} tab
     */
    switchAIGeneratorTab(tab) {
        const memo = tab === 'memo';
        document.getElementById('ai-tab-normal').classList.toggle('hidden', memo);
        document.getElementById('ai-tab-memo').classList.toggle('hidden', !memo);
        const normal = document.getElementById('ai-tab-btn-normal');
        const memoButton = document.getElementById('ai-tab-btn-memo');
        normal.className = `flex-1 px-4 py-2 rounded-xl font-bold text-sm ${!memo ? 'bg-soft-green-600 text-white shadow-sm' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
        memoButton.className = `flex-1 px-4 py-2 rounded-xl font-bold text-sm ${memo ? 'bg-soft-green-600 text-white shadow-sm' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
    }

    /** 問題詳細編集モーダルのタブを切り替える */
    switchQuestionDetailTab(tab) {
        const advanced = tab === 'advanced';
        document.getElementById('detail-tab-panel-basic').classList.toggle('hidden', advanced);
        document.getElementById('detail-tab-panel-advanced').classList.toggle('hidden', !advanced);
        const buttons = {
            basic: document.getElementById('detail-tab-basic'),
            advanced: document.getElementById('detail-tab-advanced')
        };
        Object.entries(buttons).forEach(([key, button]) => {
            if (button) button.setAttribute('aria-selected', String((key === 'advanced') === advanced));
        });
    }
}