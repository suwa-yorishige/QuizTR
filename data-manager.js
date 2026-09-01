/**
 * データ管理機能を提供するクラス
 */
class DataManager {
    /** アプリ本体への参照を受け取り、データ管理機能を初期化する。 */
    constructor(app) {
        this.app = app;
    }

    /** データ管理画面の操作イベントを登録する。 */
    bindEvents() {
        document.getElementById('data-tab-import-button').addEventListener('click', () => this.switchTab('import'));
        document.getElementById('data-tab-export-button').addEventListener('click', () => this.switchTab('export'));
        document.getElementById('data-tab-backup-button').addEventListener('click', () => this.switchTab('backup'));
        document.getElementById('csv-upload').addEventListener('change', event => this.handleFileUpload(event));
        document.getElementById('btn-csv-upload-trigger').addEventListener('click', () => document.getElementById('csv-upload').click());
        document.getElementById('csv-export-button').addEventListener('click', () => this.exportQuestionsCSV());
        document.getElementById('backup-export-button').addEventListener('click', () => this.exportSetBackup());
        document.getElementById('backup-restore-button').addEventListener('click', () => {
            this.restoreSetBackup(document.getElementById('backup-file').files[0]);
        });
    }

    /** 指定したデータ管理タブを表示し、選択状態を更新する。 */
    switchTab(tab) {
        document.querySelectorAll('.data-tab-panel').forEach(panel => panel.classList.add('hidden'));
        document.getElementById(`data-tab-${tab}`).classList.remove('hidden');
        document.querySelectorAll('.data-tab-btn').forEach(button => button.classList.remove('bg-soft-green-600', 'text-white'));
        document.getElementById(`data-tab-${tab}-button`).classList.add('bg-soft-green-600', 'text-white');
    }

    /** 選択された取込先セットのIDを取得し、新規作成時はセットを追加する。 */
    async getTargetSetId(selectElementId, defaultSetName = '') {
        const selectElement = document.getElementById(selectElementId);
        const value = selectElement.value;
        if (value !== '_new_') return value;

        if (this.app.studySets.length >= MAX_SETS) {
            this.app.showToast(`学習セットは最大${MAX_SETS}個までです。`, 'error');
            selectElement.value = this.app.studySets[0].id;
            return null;
        }
        const initialSetName = String(defaultSetName || '').trim().substring(0, MAX_SET_NAME_LENGTH);
        const name = await this.app.showPromptModal('セットの作成', '新しい学習セットの名前を入力してください', initialSetName, '最大30文字', MAX_SET_NAME_LENGTH);
        if (name === null) {
            selectElement.value = this.app.studySets[0].id;
            return null;
        }
        const trimmedName = name.trim().substring(0, MAX_SET_NAME_LENGTH);
        if (!trimmedName) {
            this.app.showToast('セット名が無効です', 'error');
            selectElement.value = this.app.studySets[0].id;
            return null;
        }
        const newSet = this.app.createEmptySet(trimmedName);
        this.app.studySets.push(newSet);
        this.app.saveStudySets();
        this.app.updateSetSelectors();
        selectElement.value = newSet.id;
        return newSet.id;
    }

    /** 選択されたCSVファイルを読み込み、指定セットへの取込処理を開始する。 */
    async handleFileUpload(event) {
        const input = event.target;
        const file = input.files[0];
        if (!file) return;

        const targetSetId = await this.getTargetSetId('csv-target-set', file.name);
        if (!targetSetId) {
            input.value = '';
            return;
        }
        const targetSet = this.app.studySets.find(set => set.id === targetSetId);
        if (targetSet.questions.length >= MAX_QUESTIONS_PER_SET) {
            this.app.showToast(`対象セットの登録上限(${MAX_QUESTIONS_PER_SET}問)に達しています。`, 'error');
            input.value = '';
            return;
        }

        const encoding = document.getElementById('csv-encoding').value || 'UTF-8';
        try {
            const text = await this.readFileAsText(file, encoding);
            await this.processCSVText(text, targetSet);
        } catch (error) {
            this.app.showToast(error.message || '予期せぬエラーが発生しました。', 'error');
            console.error(error);
        } finally {
            input.value = '';
        }
    }

    /** ファイルを指定文字コードのテキストとして非同期で読み込む。 */
    readFileAsText(file, encoding) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = event => resolve(event.target.result);
            reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'));
            reader.readAsText(file, encoding);
        });
    }

    /** CSVテキストを行と列の配列に解析する。 */
    parseCSVContent(text) {
        return CSVUtils.parse(text);
    }

    /** CSVの各行をアプリで利用する問題データへ変換する。 */
    convertRowsToQuestions(rows) {
        return rows.reduce((questions, row) => {
            const question = (row[0] || '').trim();
            const answer = (row[1] || '').trim();
            if (question && answer) {
                questions.push(this.app.createQuestionData(question, answer, (row[2] || '').trim(), {
                    genre: (row[3] || '').trim(),
                    subgenre: (row[4] || '').trim()
                }));
            }
            return questions;
        }, []);
    }

    /** 取込対象の問題数と登録上限を検証し、利用者の確認を受ける。 */
    async validateImportQuestions(questions, targetSet) {
        if (questions.length === 0) {
            throw new Error('有効な問題データが見つかりませんでした。ファイル形式をご確認ください。');
        }
        const availableSpace = Math.min(MAX_QUESTIONS_PER_SET - targetSet.questions.length, MAX_TOTAL_QUESTIONS - this.app.getTotalQuestionCount());
        if (availableSpace <= 0) throw new Error(`登録上限に達しています（セット上限${MAX_QUESTIONS_PER_SET}問、アプリ全体上限${MAX_TOTAL_QUESTIONS}問）。`);

        if (questions.length > availableSpace) {
            const confirmed = await this.app.showModal('上限オーバー', `セットの登録上限を超えるため、最初の${availableSpace}問のみ追加します。取り込みますか？`);
            return confirmed ? questions.slice(0, availableSpace) : null;
        }
        const confirmed = await this.app.showModal('確認', `${questions.length}問の問題があります。「${targetSet.name}」に取り込みますか？`);
        return confirmed ? questions : null;
    }

    /** CSVテキストを正規化して解析・検証・登録・AI解説補完を順に実行する。 */
    async processCSVText(rawText, targetSet) {
        let text = rawText;
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        if (text.includes('\uFFFD')) throw new Error('文字化けを検出しました。文字コード(UTF-8 / Shift_JIS)を変更して再試行してください。');
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const questions = this.convertRowsToQuestions(this.parseCSVContent(text));
        const importQuestions = await this.validateImportQuestions(questions, targetSet);
        if (!importQuestions) return;
        await this.importQuestions(importQuestions, targetSet);
        await this.generateMissingExplanations(importQuestions);
    }

    /** 問題を対象セットへ登録して永続化し、完了通知を表示する。 */
    async importQuestions(questions, targetSet) {
        targetSet.questions.push(...questions);
        this.app.saveStudySets();
        this.app.showToast(`${questions.length}件の問題を取り込みました！`, 'success');
    }

    /** 解説がない取込済み問題に対し、設定に応じてAI解説を生成する。 */
    async generateMissingExplanations(questions) {
        const shouldAddExplanations = document.getElementById('csv-add-explanation').checked;
        const missingExplanations = questions.filter(question => !question.explanation);
        if (!shouldAddExplanations || missingExplanations.length === 0) return;
        if (!this.app.geminiApiKey) {
            this.app.showToast('CSV取り込みは完了しました。Gemini APIキー未設定のため、解説自動生成はスキップしました。', 'info');
            return;
        }

        const targetItems = missingExplanations.slice(0, CSV_EXPLANATION_LIMIT);
        const skippedCount = Math.max(0, missingExplanations.length - targetItems.length);
        const uploadButton = document.getElementById('btn-csv-upload-trigger');
        const loading = document.getElementById('csv-loading');
        const loadingText = document.getElementById('csv-loading-text');
        uploadButton.classList.add('hidden');
        loading.classList.remove('hidden');
        loading.classList.add('flex');
        try {
            loadingText.textContent = `CSV取り込み完了。AI解説生成中... (0/${targetItems.length})`;
            await this.app.aiManager.fillExplanationsWithAI(targetItems, loadingText, CSV_EXPLANATION_BATCH_SIZE, CSV_EXPLANATION_PROMPT_LIMIT);
            this.app.saveStudySets();
            this.app.showToast(`AI解説を${targetItems.length}件追加しました${skippedCount ? `（上限超過のため${skippedCount}件は未生成）` : ''}`, 'success');
        } catch (error) {
            this.app.saveStudySets();
            this.app.showToast(error.message || 'CSV取り込みは完了しましたが、一部の解説生成に失敗しました。', 'error');
        } finally {
            uploadButton.classList.remove('hidden');
            loading.classList.add('hidden');
            loading.classList.remove('flex');
        }
    }

    /** 選択された学習セットの問題をUTF-8 BOM付きCSVとして保存する。 */
    exportQuestionsCSV() {
        const setSelect = document.getElementById('csv-export-set');
        const target = this.app.studySets.find(set => set.id === setSelect.value);
        if (!target) return this.app.showToast('保存対象の学習セットが見つかりません', 'error');
        if (!target.questions.length) return this.app.showToast('保存する問題がありません', 'error');
        const rows = target.questions.map(question => [question.q || '', question.a || '', question.explanation || '', question.genre || '', question.subgenre || '']);
        this.download(new Blob(['\uFEFF' + CSVUtils.export(rows)], { type: 'text/csv;charset=utf-8;' }), `${this.safeFileName(target.name || 'questions')}_questions.csv`);
        this.app.showToast(`「${target.name}」の${rows.length}問をCSV保存しました`, 'success');
    }

    /** 選択された学習セットをJSONバックアップとして保存する。 */
    exportSetBackup() {
        const selectElement = document.getElementById('backup-set-select');
        const set = this.app.studySets.find(item => item.id === selectElement.value);
        if (!set) return this.app.showToast('学習セットを選択してください', 'error');
        const data = { version: '1.0', createdAt: Date.now(), studySet: set };
        this.download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `quiz_backup_${this.safeFileName(set.name || 'set')}.json`);
        this.app.showToast('バックアップを保存しました', 'success');
    }

    /** JSONバックアップを読み込み、確認後に学習セットとして復元する。 */
    restoreSetBackup(file) {
        if (!file) return this.app.showToast('バックアップファイルを選択してください', 'error');
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const data = JSON.parse(reader.result);
                const set = data.studySet;
                if (!set || !set.id || !set.name || !Array.isArray(set.questions)) throw new Error('不正なバックアップです');
                const existing = this.app.studySets.find(item => item.name === set.name);
                const backupDate = data.createdAt ? new Date(data.createdAt).toLocaleString('ja-JP') : '不明';
                if (existing && !await this.app.showModal('バックアップの復元', `学習セット「${set.name}」\n\nバックアップ日時:\n${backupDate}\n\n同名の学習セットが存在します。\n上書きして復元しますか？`, '復元する')) return;
                if (existing) this.app.studySets = this.app.studySets.filter(item => item.id !== existing.id);
                this.app.studySets.push(set);
                this.app.saveStudySets();
                this.app.updateSetSelectors();
                this.app.showToast('復元完了', 'success');
            } catch (error) {
                this.app.showToast(error.message || 'バックアップの復元に失敗しました', 'error');
            }
        };
        reader.onerror = () => this.app.showToast('ファイルの読み込みに失敗しました', 'error');
        reader.readAsText(file);
    }

    /** Blobを指定ファイル名でブラウザからダウンロードする。 */
    download(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    /** ファイル名に利用できない文字をアンダースコアへ置換する。 */
    safeFileName(name) {
        return String(name).replace(/[\\/:*?"<>|]/g, '_');
    }
}