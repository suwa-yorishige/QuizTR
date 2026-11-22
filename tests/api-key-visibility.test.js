const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('settings keys start masked and share one visibility control', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    for (const id of ['setting-gemini-key', 'setting-tavily-key', 'setting-tts-key']) {
        const input = html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`))[0];
        assert.match(input, /type="password"/);
        assert.match(input, /\bsetting-api-key\b/);
    }
    assert.match(html, /onchange="app\.setApiKeyVisibility\(this\.checked\)"/);
});

test('visibility toggles all keys without changing values and resets on reopening settings', () => {
    const inputs = ['gemini', 'tavily', 'tts'].map(value => ({ type: 'password', value }));
    const toggle = { checked: false };
    const views = Object.fromEntries(
        ['dashboard', 'csv-import', 'manager', 'dictionary', 'ai-generator', 'audio-export', 'settings', 'quiz']
            .map(id => [`view-${id}`, { classList: { add() {}, remove() {} } }])
    );
    const document = {
        getElementById: id => id === 'setting-show-api-keys' ? toggle : views[id],
        querySelectorAll: selector => {
            assert.equal(selector, '#view-settings .setting-api-key');
            return inputs;
        }
    };
    const context = vm.createContext({
        document,
        window: { speechSynthesis: { cancel() {} }, addEventListener() {} },
        Utils: { escapeHTML() {} }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8') + '\nthis.app = app;', context);
    vm.runInContext(fs.readFileSync(path.join(root, 'ui-manager.js'), 'utf8') + '\nthis.UIManager = UIManager;', context);
    const app = context.app;
    app.stopTextReveal = () => {};
    app.uiManager = new context.UIManager(app);

    app.setApiKeyVisibility(true);
    assert.equal(toggle.checked, true);
    assert.deepEqual(inputs.map(input => input.type), ['text', 'text', 'text']);
    app.setApiKeyVisibility(false);
    assert.deepEqual(inputs.map(input => input.type), ['password', 'password', 'password']);
    app.setApiKeyVisibility(true);
    app.switchView('settings');
    assert.equal(toggle.checked, false);
    assert.deepEqual(inputs.map(input => input.type), ['password', 'password', 'password']);
    assert.deepEqual(inputs.map(input => input.value), ['gemini', 'tavily', 'tts']);
});
