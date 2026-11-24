const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function load(file, name, globals = {}) {
    const context = vm.createContext({ URL, console, ...globals });
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8') + `\nthis.exported = ${name};`, context);
    return context.exported;
}

const defs = { 理系: ['化学'], ノンセク: ['ジャンル不明'] };
const utils = {
    normalizeAnswerForDuplicateCheck: x => String(x).toLowerCase(),
    textSimilarity: () => 0,
    mapWithConcurrency: async (items, limit, fn) => Promise.all(items.map(fn))
};
const AIManager = load('ai-manager.js', 'AIManager', { AI_SUBGENRES: defs, Utils: utils });
const source = { title: '発表', url: 'https://example.com/news', content: '受賞を発表', publishedDate: '2026-10-07' };
const validNews = { q: '文'.repeat(60), explanation: '解説', reading: 'じんぶつ', aliases: [], referenceMonth: '2026-10', newsType: 'C', relatedTags: ['科学'] };

test('Gemini requests use the configured Flash model', async () => {
    let request;
    const api = load('api.js', 'api', {
        fetch: async (url, options) => {
            request = { url, options };
            return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'result' }] } }] }) };
        }
    });
    assert.equal(await api.fetchGemini('test-key', 'prompt', true), 'result');
    assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=test-key');
    assert.equal(JSON.parse(request.options.body).generationConfig.responseMimeType, 'application/json');
});

test('periods use local calendar dates and clamp month ends', () => {
    const manager = new AIManager({});
    const now = new Date(2026, 2, 31, 23, 59);
    const expected = {
        '1w': '2026-03-24', '2w': '2026-03-17', '1m': '2026-02-28',
        '3m': '2025-12-31', '6m': '2025-09-30', '1y': '2025-03-31'
    };
    for (const [period, start] of Object.entries(expected)) {
        const range = manager.getNewsDateRange(period, now);
        assert.equal(range.start, start);
        assert.equal(range.end, '2026-03-31');
    }
    assert.throws(() => manager.getNewsDateRange('2y', now), /期間/);
    const range = manager.getNewsDateRange('1y', new Date(2024, 1, 29));
    assert.equal(range.start, '2023-02-28');
    assert.equal(manager.isDateInRange('2024-02-30', range), false);
    assert.equal(manager.isDateInRange(range.start, range), true);
    assert.equal(manager.isDateInRange(range.end, range), true);
    assert.equal(manager.isDateInRange('2024-03-01', range), false);
});

test('search plans require a valid event date, fact and source', () => {
    const manager = new AIManager({});
    const plan = { answer: '人物', angle: '受賞', keywords: ['化学'], genre: '理系', subgenre: '化学', eventDate: '2026-10-07', fact: '化学賞を受賞', sourceIndexes: [0] };
    const range = { start: '2026-10-01', end: '2026-10-31' };
    const filter = x => manager._validateAndFilterPlans([x], new Set(), '', '', defs, range, [source]);
    assert.equal(filter(plan).length, 1);
    for (const invalid of [
        { eventDate: '2026-09-30' }, { eventDate: '2026-11-01' },
        { eventDate: '2026-10-32' }, { eventDate: '' }, { fact: '' },
        { sourceIndexes: [1] }, { sourceIndexes: ['0'] }
    ]) assert.equal(filter({ ...plan, ...invalid }).length, 0);
    assert.equal(manager._validateAndFilterPlans([{ answer: '人物' }], new Set(), '', '', defs).length, 1);
});

test('Tavily request passes exact date range and rejects unusable sources', async () => {
    let request;
    const api = load('api.js', 'api', {
        fetch: async (url, options) => {
            request = { url, options };
            return { ok: true, json: async () => ({ results: [source, { url: 'javascript:alert(1)', content: 'bad' }] }) };
        }
    });
    const result = await api.searchTavily('key', 'query', { start: '2026-01-01', end: '2026-11-21' });
    assert.equal(result.length, 1);
    assert.equal(request.options.headers.Authorization, 'Bearer key');
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.start_date, '2026-01-01');
    assert.equal(payload.end_date, '2026-11-21');
    assert.equal(payload.filter_by_published_date, true);
    await assert.rejects(api.searchTavily('', 'query'), /APIキー/);
    const empty = load('api.js', 'api', { fetch: async () => ({ ok: true, json: async () => ({ results: [] }) }) });
    await assert.rejects(empty.searchTavily('key', 'query'), /検索結果/);
    const failure = load('api.js', 'api', { fetch: async () => ({ ok: false, status: 401 }) });
    await assert.rejects(failure.searchTavily('key', 'query'), /HTTP 401/);
});

test('search-backed memo generation requires references and retains the requested answer', async () => {
    const manager = new AIManager({});
    let prompt;
    manager.fetchGemini = async text => {
        prompt = text;
        return JSON.stringify({ q: '2026年の化学賞を受賞した人物は？', a: '別人', genre: '理系', subgenre: '化学', explanation: '解説', sourceIndexes: [0] });
    };
    const result = await manager.generateDerivativeData('硤合憲三', '2026年ノーベル化学賞', '中級', [source]);
    assert.equal(result.a, '硤合憲三');
    assert.match(prompt, /2026年ノーベル化学賞/);
    assert.match(prompt, /検索資料だけを根拠/);
    assert.equal(result.explanation, '解説');
    assert.equal(result.sources[0].url, 'https://example.com/news');
    assert.equal(result.sources[0].content, undefined);
    manager.fetchGemini = async () => JSON.stringify({ supported: false });
    await assert.rejects(manager.generateDerivativeData('硤合憲三', '', '中級', [source]), /確認できません/);
    manager.fetchGemini = async () => JSON.stringify({ q: '問題', genre: '理系', subgenre: '化学', sourceIndexes: [3] });
    await assert.rejects(manager.generateDerivativeData('硤合憲三', '', '中級', [source]), /確認できません/);
});

test('news prompts prefer one full date while allowing year-only clues', async () => {
    const manager = new AIManager({});
    const prompts = [];
    manager.fetchGemini = async text => {
        prompts.push(text);
        if (text.startsWith('次の設計案')) return '[]';
        return JSON.stringify({ ...validNews, genre: '理系', subgenre: '化学', sourceIndexes: [0], eventDate: '2026-10-07' });
    };
    const range = { start: '2026-10-01', end: '2026-10-31' };
    await manager.generateQuestionBatchFromPlans([{ fact: '受賞発表', eventDate: '2026-10-07' }], '中級', []);
    await manager.generateDerivativeData('硤合憲三', '', '中級', [source], range);
    for (const prompt of prompts) {
        assert.match(prompt, /年月日を含む日付は原則として問題文に1回だけ/);
        assert.match(prompt, /年だけの手掛かりは別扱い/);
        assert.match(prompt, /記事の公開日を出来事の日付と決めつけず/);
        assert.match(prompt, /死亡日、死去の発表日、死去が報じられた日を区別/);
        assert.match(prompt, /死因や年齢は資料で確認できる場合だけ/);
    }
    assert.match(prompts[1], /2026-10-01から2026-10-31/);
    assert.match(prompts[1], /死亡日が期間外でも、期間内に発表または報道された/);
});

test('all question creation and regeneration prompts request quiz-style phrasing', async () => {
    const elements = {
        'detail-question-q': { value: '元の問題' }, 'detail-question-a': { value: '人物' },
        'regenerate-before-text': {}, 'regenerate-after-text': {}, 'regenerate-compare-policy': {},
        'regenerate-compare-modal': { classList: { remove() {} } },
        'regenerate-compare-panel': { classList: { remove() {} } }
    };
    const Manager = load('ai-manager.js', 'AIManager', {
        AI_SUBGENRES: defs, Utils: utils,
        document: { getElementById: id => elements[id], querySelector: () => ({ value: 'correct' }) }
    });
    const manager = new Manager({ geminiApiKey: 'key', closeRegeneratePolicyModal() {}, showToast() {} });
    const prompts = [];
    manager.fetchGemini = async (prompt, json) => {
        prompts.push(prompt);
        if (!json) return '再作成した問題';
        if (prompt.startsWith('次の設計案')) return '[]';
        return JSON.stringify({ ...validNews, genre: '理系', subgenre: '化学', sourceIndexes: [0], eventDate: '2026-10-07' });
    };
    const range = { start: '2026-10-01', end: '2026-10-31' };
    await manager.generateQuestionBatchFromPlans([{}], '中級', []);
    await manager.generateQuestionBatchFromPlans([{ fact: '事実' }], '中級', []);
    await manager.generateDerivativeData('人物');
    await manager.generateDerivativeData('人物', '', '中級', [source], range);
    await manager.regenerateQuestionForDetail();
    assert.equal(prompts.length, 5);
    for (const prompt of prompts) {
        assert.match(prompt, /別名を『春告草』や『好文木』といい、/);
        assert.match(prompt, /別名を『春告草』や『好文木』という、/);
        assert.match(prompt, /文意や文法に合うように/);
    }
    assert.equal(manager.pendingRegeneratedQuestion.after, '再作成した問題');
});

test('only unrestricted news plans request an optional mix of obituaries', async () => {
    const manager = new AIManager({});
    const prompts = [];
    manager.fetchGemini = async prompt => { prompts.push(prompt); return '[]'; };
    const options = { count: 10, genre: '', subgenre: '', topic: '', difficulty: '中級', excludedAnswers: [], excludedAngles: [], newsRange: { start: '2026-10-01', end: '2026-10-31' }, sources: [source] };
    await manager.generateQuestionPlansWithAI(options);
    await manager.generateQuestionPlansWithAI({ ...options, genre: '理系' });
    await manager.generateQuestionPlansWithAI({ ...options, topic: '科学' });
    await manager.generateQuestionPlansWithAI({ ...options, newsRange: null });
    assert.match(prompts[0], /10問あたり1〜2問程度以上/);
    assert.match(prompts[0], /上限や必須件数ではなく/);
    assert.match(prompts[0], /死亡日、死去の発表日、死去が報じられた日を区別/);
    assert.match(prompts[0], /死亡日が期間外でも、期間内に発表または報道された/);
    for (const prompt of prompts.slice(1)) assert.doesNotMatch(prompt, /10問あたり1〜2問程度以上/);
});

test('unrestricted news adds obituary sources once, and reports search failure without blocking other news', async () => {
    for (const scenario of ['unrestricted', 'genre', 'topic', 'standard', 'failure']) {
        const searches = [], planInputs = [], messages = [];
        const obituary = { title: '訃報', url: 'https://example.com/obituary', content: '死去を発表', publishedDate: '2026-10-08' };
        const Manager = load('ai-manager.js', 'AIManager', {
            AI_SUBGENRES: defs, Utils: utils, console: { warn() {}, error() {} },
            api: { searchTavily: async (key, query, range) => {
                searches.push({ query, range });
                if (query.startsWith('訃報')) {
                    if (scenario === 'failure') throw new Error('追加検索エラー');
                    return [obituary, source];
                }
                return [source];
            } }
        });
        const manager = new Manager({ tavilyApiKey: 'key', showToast: (...args) => messages.push(args) });
        const range = { start: '2026-10-01', end: '2026-10-31' };
        manager._validateGenerationInput = async () => ({
            targetSet: { questions: [] }, genre: scenario === 'genre' ? '理系' : '',
            subgenre: '', topic: scenario === 'topic' ? '科学' : '', requestedCount: 1,
            difficulty: '中級', newsRange: scenario === 'standard' ? null : range
        });
        manager._setupGenerationUI = () => ({});
        manager.generateQuestionPlansWithAI = async options => { planInputs.push(options); return [{ answer: '人物' }]; };
        manager._validateAndFilterPlans = plans => plans;
        manager._generateAndAcceptBatch = async (plans, difficulty, accepted) => {
            if (planInputs.length === 2) accepted.push({ a: '人物' });
        };
        manager._finalizeGeneration = () => {};
        await manager.generateQuestionsWithAI();
        assert.equal(planInputs.length, 2);
        const obituarySearches = searches.filter(x => x.query.startsWith('訃報'));
        assert.equal(obituarySearches.length, ['unrestricted', 'failure'].includes(scenario) ? 1 : 0);
        if (scenario === 'unrestricted') {
            assert.equal(obituarySearches[0].range, range);
            assert.deepEqual(Array.from(planInputs[0].sources, x => x.url), [source.url, obituary.url]);
            assert.deepEqual(Array.from(planInputs[1].sources, x => x.url), [source.url, obituary.url]);
        }
        if (scenario === 'failure') {
            assert.equal(planInputs[0].sources.length, 1);
            assert.match(messages[0][0], /訃報の追加検索に失敗/);
        } else assert.equal(messages.length, 0);
        if (scenario === 'standard') assert.equal(searches.length, 0);
    }
});

test('memo news rejects missing or out-of-period event dates', async () => {
    const manager = new AIManager({});
    const range = { start: '2026-10-01', end: '2026-10-31' };
    const response = { ...validNews, genre: '理系', subgenre: '化学', sourceIndexes: [0] };
    for (const date of ['2026-09-30', '2026-11-01', '2026-10-32', '']) {
        manager.fetchGemini = async () => JSON.stringify({ ...response, eventDate: date });
        await assert.rejects(manager.generateDerivativeData('人物', '', '中級', [source], range), /指定期間内/);
    }
    for (const date of ['2026-10-01', '2026-10-31']) {
        manager.fetchGemini = async () => JSON.stringify({ ...response, eventDate: date });
        assert.equal((await manager.generateDerivativeData('人物', '', '中級', [source], range)).a, '人物');
    }
    await assert.rejects(manager.generateDerivativeData('人物', '', '中級', [], range), /参考資料/);
});

test('memo search uses the selected news period without changing non-search generation', async () => {
    const elements = {
        'ai-memo-search': { checked: true },
        'ai-memo-news-period': { value: '1m' },
        'ai-memo-difficulty': { value: '中級' },
        'ai-memo-question-length': { value: 'long' },
        'ai-loading': { classList: { add() {}, remove() {} } },
        'ai-memo-preview': { classList: { remove() {} } },
        'ai-memo-preview-list': { innerHTML: '' }
    };
    const searches = [], generated = [];
    const MemoManager = load('ai-manager.js', 'AIManager', {
        AI_SUBGENRES: defs, Utils: utils, MAX_MEMO_QUESTIONS: 10,
        MAX_QUESTIONS_PER_SET: 1500, MAX_TOTAL_QUESTIONS: 10000,
        document: { getElementById: id => elements[id] },
        api: { searchTavily: async (...args) => { searches.push(args); return [source]; } }
    });
    const manager = new MemoManager({
        tavilyApiKey: 'key', dataManager: { getTargetSetId: async () => 'set' },
        studySets: [{ id: 'set', questions: [] }], getTotalQuestionCount: () => 0,
        escapeHTML: x => String(x), showToast: message => { throw new Error(message); }
    });
    manager.memoNormalizedAnswers = [{ answer: '人物', supplement: '受賞' }];
    manager.getNewsDateRange = period => {
        assert.equal(period, '1m');
        return { start: '2026-10-01', end: '2026-10-31' };
    };
    manager.generateDerivativeData = async (...args) => {
        generated.push(args);
        return { a: args[0], q: '問題', explanation: '', sources: args[3], news: { reading: 'じんぶつ', aliases: [], referenceMonth: '2026-10', type: 'C', tags: ['科学'] }, selected: true };
    };
    await manager.generateMemoQuestions();
    assert.equal(searches[0][2].start, '2026-10-01');
    assert.equal(generated[0][4].end, '2026-10-31');
    assert.equal(generated[0][5], 'long');
    elements['ai-memo-search'].checked = false;
    elements['ai-memo-question-length'].value = 'short';
    await manager.generateMemoQuestions();
    assert.equal(searches.length, 1);
    assert.equal(generated[1][4], null);
    assert.equal(generated[1][5], 'short');
});

test('batch generation keeps search evidence and saves source references', async () => {
    const manager = new AIManager({ isSimilarQuestionCandidate: () => false });
    let generatedPlans;
    manager.generateQuestionBatchFromPlans = async plans => {
        generatedPlans = plans;
        return [{ ...validNews, a: '人物' }];
    };
    const accepted = [];
    const plan = { answer: '人物', aliases: [], angle: '受賞', keywords: [], genre: '理系', subgenre: '化学', eventDate: '2026-10-07', fact: '賞を受賞', sources: [source] };
    const count = await manager._generateAndAcceptBatch([plan], '中級', accepted, [], new Set(), [], {});
    assert.equal(count, 1);
    assert.equal(generatedPlans[0].fact, '賞を受賞');
    assert.equal(accepted[0].explanation, '解説');
    assert.equal(accepted[0].sources[0].url, 'https://example.com/news');
    assert.equal(accepted[0].news.reading, 'じんぶつ');
});

test('news metadata and character limits are validated for both generation paths', () => {
    const manager = new AIManager({});
    for (const [preset, min, max] of [['short', 40, 60], ['standard', 60, 80], ['long', 80, 120]]) {
        for (const length of [min, max]) {
            const result = manager.validateNewsResult({ ...validNews, q: '😀'.repeat(length), aliases: ['別名', '別名'] }, '人物', '2026-10-07', preset);
            assert.equal(result.aliases.length, 1);
            assert.equal(result.referenceMonth, '2026-10');
        }
        for (const length of [min - 1, max + 1]) {
            assert.throws(() => manager.validateNewsResult({ ...validNews, q: '問'.repeat(length) }, '人物', '2026-10-07', preset), new RegExp(`${min}〜${max}`));
        }
    }
    for (const invalid of [
        { explanation: '説'.repeat(101) }, { reading: '' }, { reading: 'カタカナ' },
        { aliases: null }, { aliases: [''] }, { referenceMonth: '2026-09' },
        { newsType: 'D' }, { relatedTags: [] }
    ]) assert.throws(() => manager.validateNewsResult({ ...validNews, ...invalid }, '人物', '2026-10-07'));
});

test('all length selectors display the actual ranges and default to standard', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const manager = new AIManager({});
    for (const id of ['ai-question-length', 'ai-memo-question-length', 'derivative-question-length']) {
        const select = html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
        assert.ok(select, id);
        for (const preset of ['short', 'standard', 'long']) {
            const { min, max } = manager.getQuestionLengthRange(preset);
            assert.match(select[1], new RegExp(`<option value="${preset}"[^>]*>[^<]*${min}〜${max}文字`));
        }
        assert.match(select[1], /<option value="standard" selected>/);
    }
});

test('all question generation prompts use the selected length without conflicting news limits', async () => {
    const manager = new AIManager({});
    const prompts = [];
    manager.fetchGemini = async text => {
        prompts.push(text);
        if (text.startsWith('次の設計案')) return '[]';
        return JSON.stringify({ ...validNews, q: '問'.repeat(80), genre: '理系', subgenre: '化学', sourceIndexes: [0], eventDate: '2026-10-07' });
    };
    const range = { start: '2026-10-01', end: '2026-10-31' };
    for (const [preset, min, max] of [['short', 40, 60], ['standard', 60, 80], ['long', 80, 120]]) {
        await manager.generateQuestionBatchFromPlans([{}], '中級', [], preset);
        await manager.generateQuestionBatchFromPlans([{ fact: '事実' }], '中級', [], preset);
        await manager.generateDerivativeData('人物', '', '中級', [], null, preset);
        const responseLength = preset === 'short' ? 60 : 80;
        manager.fetchGemini = async text => {
            prompts.push(text);
            return JSON.stringify({ ...validNews, q: '問'.repeat(responseLength), genre: '理系', subgenre: '化学', sourceIndexes: [0], eventDate: '2026-10-07' });
        };
        await manager.generateDerivativeData('人物', '', '中級', [source], range, preset);
        for (const prompt of prompts.splice(0)) {
            assert.match(prompt, new RegExp(`問題文は${min}〜${max}文字`));
            assert.doesNotMatch(prompt, /問題文は60〜110文字/);
        }
        manager.fetchGemini = async text => {
            prompts.push(text);
            if (text.startsWith('次の設計案')) return '[]';
            return JSON.stringify({ ...validNews, q: '問'.repeat(80), genre: '理系', subgenre: '化学' });
        };
    }
    await assert.rejects(manager.generateQuestionBatchFromPlans([], '中級', [], 'invalid'), /長さの指定が不正/);
});

test('selected news length is enforced by batch and memo generation', async () => {
    const manager = new AIManager({ isSimilarQuestionCandidate: () => false });
    const plan = { answer: '人物', aliases: [], angle: '', keywords: [], genre: '理系', subgenre: '化学', eventDate: '2026-10-07', fact: '事実', sources: [source] };
    let questionLength = 120, passedLength;
    manager.generateQuestionBatchFromPlans = async (plans, difficulty, summaries, length) => {
        passedLength = length;
        return [{ ...validNews, q: '問'.repeat(questionLength), a: '人物' }];
    };
    const accepted = [];
    assert.equal(await manager._generateAndAcceptBatch([plan], '中級', accepted, [], new Set(), [], {}, 'long'), 1);
    assert.equal(passedLength, 'long');
    questionLength = 121;
    assert.equal(await manager._generateAndAcceptBatch([plan], '中級', [], [], new Set(), [], {}, 'long'), 0);

    const range = { start: '2026-10-01', end: '2026-10-31' };
    manager.fetchGemini = async () => JSON.stringify({ ...validNews, q: '問'.repeat(questionLength), genre: '理系', subgenre: '化学', sourceIndexes: [0], eventDate: '2026-10-07' });
    await assert.rejects(manager.generateDerivativeData('人物', '', '中級', [source], range, 'long'), /80〜120/);
    assert.equal((await manager.generateDerivativeData('人物', '', '中級', [], null, 'long')).q.length, 121);
});

test('normal and news generation capture the selected length from the form', async () => {
    const elements = {
        'ai-genre': { value: '理系' }, 'ai-subgenre': { value: '' },
        'ai-topic': { value: '' }, 'ai-count': { value: '1' },
        'ai-difficulty': { value: '中級' }, 'ai-question-length': { value: 'long' },
        'ai-generation-mode': { value: 'standard' }, 'ai-news-period': { value: '1m' }
    };
    const Manager = load('ai-manager.js', 'AIManager', {
        AI_SUBGENRES: defs, Utils: utils, MAX_QUESTIONS_PER_SET: 100, MAX_TOTAL_QUESTIONS: 100,
        document: { getElementById: id => elements[id] },
        api: { searchTavily: async () => [source] }
    });
    const messages = [], seen = [];
    const manager = new Manager({
        geminiApiKey: 'key', tavilyApiKey: 'key',
        dataManager: { getTargetSetId: async () => 'set' },
        studySets: [{ id: 'set', questions: [] }], getTotalQuestionCount: () => 0,
        showToast: (...args) => messages.push(args)
    });
    manager._setupGenerationUI = () => ({});
    manager.generateQuestionPlansWithAI = async () => [{}];
    manager._validateAndFilterPlans = plans => plans;
    manager._generateAndAcceptBatch = async (plans, difficulty, accepted, angles, answers, existing, ui, length) => {
        seen.push(length);
        accepted.push({ a: '人物' });
    };
    manager._finalizeGeneration = () => {};
    await manager.generateQuestionsWithAI();
    elements['ai-generation-mode'].value = 'news';
    elements['ai-question-length'].value = 'short';
    await manager.generateQuestionsWithAI();
    assert.deepEqual(seen, ['long', 'short']);
    elements['ai-question-length'].value = 'invalid';
    await manager.generateQuestionsWithAI();
    assert.match(messages[0][0], /長さの指定が不正/);
    assert.equal(messages[0][1], 'error');
});

test('derivative selection passes its length through the app to the AI manager', async () => {
    const elements = {
        'derivative-question-length': { value: 'short' },
        'derivative-preview-list': { innerHTML: '' },
        'derivative-target-set': { innerHTML: '', value: '' },
        'derivative-step-text': { textContent: '' }
    };
    const QuizManager = load('quiz-manager.js', 'QuizManager', { Utils: utils, window: {}, document: { getElementById: id => elements[id] } });
    const app = load('app.js', 'app', { Utils: { escapeHTML: String }, window: { speechSynthesis: {}, addEventListener() {} } });
    let received;
    app.aiManager = { generateDerivativeData: async (...args) => { received = args; return { a: args[0], q: '問題', selected: true }; } };
    app.derivativeCandidates = [{ word: '人物', selected: true }];
    app.activeSetId = 'set';
    app.studySets = [{ id: 'set', questions: [{ q: '元の問題' }] }];
    app.currentQuestionIndex = 0;
    app.getDisplayOrderedSets = () => app.studySets;
    app.escapeHTML = String;
    const manager = new QuizManager(app);
    manager.setDerivativeView = () => {};
    await manager.generateSelectedDerivativeQuestions();
    assert.equal(received[1], '元の問題');
    assert.equal(received[5], 'short');
});

test('ordinary generation continues to accept short questions without news metadata', async () => {
    const manager = new AIManager({ isSimilarQuestionCandidate: () => false });
    manager.generateQuestionBatchFromPlans = async () => [{ q: '短い問題', a: '人物' }];
    const accepted = [];
    const plan = { answer: '人物', aliases: [], angle: '', keywords: [], genre: '理系', subgenre: '化学' };
    assert.equal(await manager._generateAndAcceptBatch([plan], '中級', accepted, [], new Set(), [], {}), 1);
    assert.equal(accepted[0].news, undefined);
});

test('news metadata and reading survive storage and apply to speech', () => {
    const app = load('app.js', 'app', { Utils: { escapeHTML: String }, window: { speechSynthesis: {}, addEventListener() {} } });
    const news = { reading: 'そあいけんそう', aliases: ['Soai'], referenceMonth: '2026-10', type: 'C', tags: ['科学'] };
    const saved = app.createQuestionData(validNews.q, '硤合憲三', validNews.explanation, { news });
    const restored = JSON.parse(JSON.stringify(saved));
    assert.equal(restored.news.aliases[0], 'Soai');
    assert.equal(restored.news.referenceMonth, '2026-10');
    assert.equal(restored.pronunciations[0].word, '硤合憲三');
    const DictionaryManager = load('dictionary-manager.js', 'DictionaryManager');
    const dictionary = new DictionaryManager({});
    assert.equal(dictionary.applyPronunciations(restored.a, restored), 'そあいけんそう');
    assert.equal(app.createQuestionData('通常問題', '通常解答').news, undefined);
});

test('merging identical questions retains news metadata and sources', () => {
    const QuestionManager = load('question-manager.js', 'QuestionManager', { window: {} });
    const manager = new QuestionManager({});
    const first = { id: 'q-1', q: '問題', a: '解答', correct: 0, total: 0 };
    const second = { id: 'q-2', q: '問題', a: '解答', correct: 0, total: 0, news: { referenceMonth: '2026-10', type: 'C', aliases: ['別名'], tags: ['科学'] }, sources: [{ title: '出典', url: 'https://example.com' }], pronunciations: [{ word: '解答', pronunciation: 'かいとう' }] };
    const set = { questions: [first, second] };
    assert.equal(manager.mergeExactDuplicateGroup(set, [{ q: first, index: 0 }, { q: second, index: 1 }]), 1);
    assert.equal(set.questions[0].news.aliases[0], '別名');
    assert.equal(set.questions[0].sources[0].url, 'https://example.com');
    assert.equal(set.questions[0].pronunciations[0].pronunciation, 'かいとう');
});

test('news generation preserves accepted questions if a later search fails', async () => {
    let searches = 0;
    const newsManager = load('ai-manager.js', 'AIManager', {
        AI_SUBGENRES: defs, Utils: utils, console: { error() {} },
        api: { searchTavily: async (key, query) => { if (!query.startsWith('訃報') && ++searches === 2) throw new Error('HTTP 429'); return [source]; } }
    });
    const messages = [];
    const target = { questions: [] };
    const manager = new newsManager({ tavilyApiKey: 'key', showToast: (...args) => messages.push(args) });
    manager._validateGenerationInput = async () => ({ targetSet: target, genre: '', subgenre: '', topic: '', requestedCount: 2, difficulty: '中級', newsRange: { start: '2026-01-01', end: '2026-12-01' } });
    manager._initializeGenerationState = () => ({ usedAnswers: new Set(), accepted: [], acceptedAngles: [], existingQuestions: [], defs });
    manager._setupGenerationUI = () => ({});
    manager.generateQuestionPlansWithAI = async () => [{}];
    manager._validateAndFilterPlans = () => [{}];
    manager._generateAndAcceptBatch = async (plans, difficulty, accepted) => accepted.push({ a: '人物' });
    manager._finalizeGeneration = (set, accepted) => { set.questions.push(...accepted); };
    await manager.generateQuestionsWithAI();
    assert.equal(target.questions.length, 1);
    assert.match(messages[0][0], /HTTP 429/);
    assert.equal(messages[0][1], 'error');
});
