// api.js
const api = {
    /** Gemini APIへプロンプトを送信し、生成されたテキストを取得する。 */
    async fetchGemini(apiKey, prompt, isJson = false) {
        const key = apiKey || "";
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`;

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