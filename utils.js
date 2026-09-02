/** HTMLへ安全に埋め込めるよう特殊文字をエスケープする。 */
function escapeHTML(str) {
    return String(str !== null && str !== undefined ? str : '').replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

/** 解答の表記ゆれを除去して重複判定用の文字列へ正規化する。 */
function normalizeAnswerForDuplicateCheck(text) {
    return String(text || '').normalize('NFKC').toLowerCase()
        .replace(/[\s　・･「」『』【】()（）\[\]［］]/g, '')
        .replace(/[.,，。・:：;；!?！？'"“”‘’]/g, '');
}

/** 文字列から類似度計算に用いる重複なしの2文字組を作成する。 */
function makeTextBigrams(text) {
    const normalized = String(text || '').normalize('NFKC').toLowerCase()
        .replace(/[\s　、。,.，・:：;；!?！？「」『』【】()（）\[\]［］]/g, '');
    const grams = new Set();
    if (normalized.length < 2) {
        if (normalized) grams.add(normalized);
        return grams;
    }
    for (let index = 0; index < normalized.length - 1; index++) grams.add(normalized.slice(index, index + 2));
    return grams;
}

/** 2つの文字列の2文字組が一致する割合を返す。 */
function textSimilarity(a, b) {
    const first = makeTextBigrams(a);
    const second = makeTextBigrams(b);
    if (!first.size || !second.size) return 0;
    let common = 0;
    first.forEach(value => { if (second.has(value)) common++; });
    return common / Math.max(first.size, second.size);
}

/** 指定した並列数の範囲で非同期処理を実行し、入力順に結果を返す。 */
async function mapWithConcurrency(items, limit, worker) {
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
}

window.Utils = { escapeHTML, normalizeAnswerForDuplicateCheck, makeTextBigrams, textSimilarity, mapWithConcurrency };