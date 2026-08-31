/**
 * 読み上げ辞書機能を管理するクラス
 * app.js から辞書関連のロジックを抽出・分割したもの。
 * 
 * 使い方:
 * 1. app.js の初期化時にインスタンス化する
 *    app.dictionaryManager = new DictionaryManager(app);
 * 2. データのロード時に呼び出す
 *    app.dictionaryManager.load();
 * 3. HTML側のイベントハンドラを以下のように書き換える
 *    onclick="app.addDictionaryEntry()" -> onclick="app.dictionaryManager.addEntry()"
 *    onchange="app.handleDictionaryFileUpload(event)" -> onchange="app.dictionaryManager.handleFileUpload(event)"
 *    onclick="app.exportDictionaryCSV()" -> onclick="app.dictionaryManager.exportCSV()"
 */
class DictionaryManager {
    /**
     * @param {Object} appContext - UI操作や共通メソッド(showToast, showModal, escapeHTML, parseCSVContent, escapeCSVValue)を持つappオブジェクト
     */
    constructor(appContext) {
        this.app = appContext;
        this.dictionary = [];
    }

    /**
     * 辞書データをローカルストレージから読み込む
     */
    load() {
        try {
            const savedD = localStorage.getItem('quiz_dictionary');
            if (savedD) {
                this.dictionary = JSON.parse(savedD);
            }
        } catch (e) {
            console.error("Dictionary loading error", e);
            this.dictionary = [];
        }
    }

    /**
     * 辞書データをローカルストレージに保存する
     */
    save() {
        localStorage.setItem('quiz_dictionary', JSON.stringify(this.dictionary));
    }

    /**
     * グローバル辞書のみを適用する
     * @param {string} text 
     * @returns {string}
     */
    applyDictionary(text) {
        return this.applyPronunciations(text, null);
    }

    /**
     * 問題固有の読み方とグローバル辞書を適用する
     * @param {string} text 
     * @param {Object} question 
     * @returns {string}
     */
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
    }

    /**
     * 辞書CSVファイルのアップロード処理
     * @param {Event} event 
     */
    async handleFileUpload(event) {
        const input = event.target; 
        const file = input.files[0]; 
        if (!file) return;
        
        try {
            const text = await new Promise((resolve, reject) => { 
                const reader = new FileReader(); 
                reader.onload = e => resolve(e.target.result); 
                reader.onerror = () => reject(new Error('CSVファイルの読み込みに失敗しました')); 
                reader.readAsText(file, 'UTF-8'); 
            });
            await this.processCSVText(text);
        } catch (err) { 
            this.app.showToast(err.message || 'CSV取り込みでエラーが発生しました。', 'error'); 
            console.error(err); 
        } finally { 
            input.value = ''; 
        }
    }

    /**
     * 辞書CSVテキストのパースと取り込み
     * @param {string} rawText 
     */
    async processCSVText(rawText) {
        let text = rawText || ''; 
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        if (text.includes('\uFFFD')) throw new Error('文字化けを検出しました。UTF-8形式のCSVファイルで再試行してください。');
        
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const rows = this.app.parseCSVContent(text); 
        const entries = [];
        
        rows.forEach((row, index) => { 
            const word = (row[0] || '').trim(); 
            const pronunciation = (row[1] || '').trim(); 
            if (index === 0 && word === '単語' && pronunciation === '読み方') return; 
            if (word && pronunciation) entries.push({ word, pronunciation }); 
        });
        
        if (entries.length === 0) throw new Error('有効な辞書データが見つかりませんでした。1列目に単語、2列目に読み方を入れてください。');
        
        const confirmed = await this.app.showModal('CSV取り込みの確認', `${entries.length}件の辞書データを取り込みます。\n同じ単語がある場合は読み方を上書きします。`); 
        if (!confirmed) return;
        
        let added = 0, updated = 0; 
        entries.forEach(entry => { 
            const idx = this.dictionary.findIndex(d => d.word === entry.word); 
            if (idx >= 0) { 
                this.dictionary[idx].pronunciation = entry.pronunciation; 
                updated++; 
            } else { 
                this.dictionary.push(entry); 
                added++; 
            } 
        });
        
        this.save(); 
        this.render(); 
        this.app.showToast(`CSVを取り込みました（追加: ${added}件、更新: ${updated}件）`, 'success');
    }

    /**
     * 辞書データをCSVとしてエクスポートする
     */
    exportCSV() {
        if (this.dictionary.length === 0) return this.app.showToast('保存する辞書データがありません', 'error');
        
        const rows = [['単語', '読み方'], ...this.dictionary.map(d => [d.word, d.pronunciation])];
        const csv = rows.map(row => row.map(v => this.app.escapeCSVValue(v)).join(',')).join('\r\n');
        
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); 
        const url = URL.createObjectURL(blob); 
        const a = document.createElement('a'); 
        a.href = url; 
        a.download = `quiz_dictionary_${new Date().getTime()}.csv`; 
        a.click(); 
        URL.revokeObjectURL(url); 
        
        this.app.showToast('辞書CSVを保存しました', 'success');
    }

    /**
     * 入力フォームから辞書エントリを追加する
     */
    addEntry() {
        const w = document.getElementById('dict-word').value.trim();
        const p = document.getElementById('dict-pronunciation').value.trim();
        if (!w || !p) return this.app.showToast('単語と読み方を入力してください', 'error');
        
        const idx = this.dictionary.findIndex(d => d.word === w);
        if (idx >= 0) {
            this.dictionary[idx].pronunciation = p;
        } else {
            this.dictionary.push({ word: w, pronunciation: p });
        }
        
        this.save();
        this.render();
        
        document.getElementById('dict-word').value = '';
        document.getElementById('dict-pronunciation').value = '';
        this.app.showToast('登録しました', 'success');
    }

    /**
     * 指定されたインデックスの辞書エントリを削除する
     * @param {number} i 
     */
    removeEntry(i) {
        this.dictionary.splice(i, 1);
        this.save();
        this.render();
    }

    /**
     * 辞書一覧のHTMLを描画する
     */
    render() {
        const tbody = document.getElementById('dict-list');
        const empty = document.getElementById('dict-empty');
        if (!tbody || !empty) return;

        tbody.innerHTML = '';
        
        if (this.dictionary.length === 0) {
            empty.classList.remove('hidden');
        } else {
            empty.classList.add('hidden');
            this.dictionary.forEach((d, i) => {
                tbody.innerHTML += `
                    <tr class="hover:bg-soft-green-50">
                        <td class="px-4 py-3 border-t border-soft-green-100">${this.app.escapeHTML(d.word)}</td>
                        <td class="px-4 py-3 border-t border-soft-green-100">${this.app.escapeHTML(d.pronunciation)}</td>
                        <td class="px-4 py-3 border-t border-soft-green-100 text-right">
                            <button onclick="app.dictionaryManager.removeEntry(${i})" class="text-red-500 hover:text-red-700 text-sm font-bold">削除</button>
                        </td>
                    </tr>`;
            });
        }
    }


}
