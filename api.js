// api.js
const api = {
    /** Gemini APIへプロンプトを送信し、生成されたテキストを取得する。 */
    async fetchGemini(apiKey, prompt, isJson = false) {
        const key = apiKey || "";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${key}`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }]
        };
        if (isJson) payload.generationConfig = { responseMimeType: "application/json" };

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const err = await res.json();
                const errorMessage = err && err.error && err.error.message ? err.error.message : `HTTP ${res.status}`;
                throw new Error(errorMessage);
            }
            const data = await res.json();
            return data.candidates[0].content.parts[0].text;
        } catch (e) {
            console.error("Gemini API Error:", e);
            throw new Error("Gemini APIエラー: " + e.message);
        }
    },

    /** Tavilyで公開情報を検索する。 */
    async searchTavily(apiKey, query, dates = null) {
        if (!apiKey) throw new Error('Tavily APIキーを設定画面で登録してください');
        const payload = {
            query, topic: 'news', search_depth: 'basic', chunks_per_source: 1,
            max_results: 20, include_raw_content: false
        };
        if (dates) {
            payload.start_date = dates.start;
            payload.end_date = dates.end;
            payload.filter_by_published_date = true;
        }
        const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`Tavily検索に失敗しました (HTTP ${res.status})`);
        const data = await res.json();
        if (!Array.isArray(data.results)) throw new Error('Tavily検索結果の形式が不正です');
        const results = data.results.filter(x => {
            try {
                const url = new URL(x.url);
                return (url.protocol === 'https:' || url.protocol === 'http:') && typeof x.content === 'string' && x.content.trim();
            } catch (e) {
                return false;
            }
        }).map(x => ({ title: String(x.title || ''), url: x.url, content: x.content, publishedDate: x.published_date || '' }));
        if (!results.length) throw new Error('参考にできる検索結果がありません。条件を変更して再試行してください');
        return results;
    },

    /** Google Cloud Text-to-Speech APIでSSMLを音声データへ変換する。 */
    async fetchCloudTextToSpeechAPI(apiKey, ssml) {
        if (!apiKey) throw new Error("Google Cloud Text-to-Speech APIキーが設定されていません。");
        const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;

        const payload = {
            input: { ssml: ssml },
            voice: { languageCode: "ja-JP", name: "ja-JP-Neural2-B" },
            audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 }
        };

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const err = await res.json();
                const errorMessage = err && err.error && err.error.message ? err.error.message : `HTTP ${res.status}`;
                throw new Error(errorMessage);
            }
            const data = await res.json();
            return data.audioContent;
        } catch (e) {
            console.error("Cloud TTS API Error:", e);
            throw new Error("Cloud TTS APIエラー: " + e.message);
        }
    }
};