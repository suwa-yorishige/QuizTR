/** CSVデータの解析と生成を提供するユーティリティクラス。 */
class CSVUtils {
    /** CSVまたはTSVのテキストを行と列の配列に解析する。 */
    static parse(text) {
        const delimiter = (text.indexOf(',') === -1 && text.indexOf('\t') !== -1) ? '\t' : ',';
        const rows = [];
        let row = [];
        let cell = '';
        let inQuotes = false;

        for (let index = 0; index < text.length; index++) {
            const character = text[index];
            if (character === '"') {
                if (inQuotes && text[index + 1] === '"') {
                    cell += '"';
                    index++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (character === delimiter && !inQuotes) {
                row.push(cell);
                cell = '';
            } else if (character === '\n' && !inQuotes) {
                row.push(cell);
                if (row.some(value => value.trim() !== '')) rows.push(row);
                row = [];
                cell = '';
            } else {
                cell += character;
            }
        }
        if (cell || row.length > 0) {
            row.push(cell);
            if (row.some(value => value.trim() !== '')) rows.push(row);
        }
        return rows;
    }

    /** CSVフィールドをエスケープし、必要に応じて引用符で囲む。 */
    static escape(value) {
        const stringValue = String(value !== null && value !== undefined ? value : '');
        return /[",\r\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
    }

    /** 行データの配列をCSV形式の文字列へ変換する。 */
    static export(rows) {
        return rows.map(row => row.map(value => this.escape(value)).join(',')).join('\r\n');
    }
}