/**
 * 音声生成・再生機能を管理するクラス
 * app.js から音声関連のロジックを抽出・分割したもの。
 *
 * 主な機能:
 * - Google Cloud Text-to-Speech を利用した音声生成
 * - SSMLの組み立て
 * - 音声データの結合
 * - MP3変換
 * - ブラウザでの再生・停止
 * - MP3ファイルのダウンロード
 *
 * 使い方:
 * 1. app.js の初期化時にインスタンス化する
 *    app.audioManager = new AudioManager(app);
 *
 * 2. index.html のイベントハンドラを以下のように書き換える
 *    onclick="app.startAudioExport()"
 *      -> onclick="app.audioManager.startAudioExport()"
 *
 *    onclick="app.playExportedAudio()"
 *      -> onclick="app.audioManager.playExportedAudio()"
 *
 *    onclick="app.stopExportedAudio()"
 *      -> onclick="app.audioManager.stopExportedAudio()"
 *
 *    onclick="app.downloadExportedAudio()"
 *      -> onclick="app.audioManager.downloadExportedAudio()"
 *
 * 3. app.js から以下のメソッドを削除する
 *    - base64ToAudioBuffer()
 *    - createSilentBuffer()
 *    - encodeMonoAudioBufferToMP3()
 *    - escapeXML()
 *    - buildQuestionSSML()
 *    - startAudioExport()
 *    - playExportedAudio()
 *    - stopExportedAudio()
 *    - downloadExportedAudio()
 *
 * 4. AudioManager内部から app の機能を利用する
 *    - this.app.fetchCloudTextToSpeechAPI()
 *    - this.app.applyPronunciations()
 *    - this.app.showToast()
 *    - this.app.studySets
 *    - this.app.getAccuracyRatio()
 *    - this.app.mapWithConcurrency()
 *
 * 注意:
 * - exportedAudioBlob
 * - exportedAudioUrl
 */
class AudioManager {
    constructor(app) {
        this.app = app;

        this.exportedAudioBlob = null;
        this.exportedAudioUrl = null;
        this.audioElement = null;
    }

    base64ToAudioBuffer(base64, ctx) {
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);

        for (let i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i);
        }

        const samples = bytes.length / 2;
        const buffer = ctx.createBuffer(1, samples, 24000);

        const view = new DataView(bytes.buffer);
        const channel = buffer.getChannelData(0);

        for (let i = 0; i < samples; i++) {
            channel[i] = view.getInt16(i * 2, true) / 32768;
        }

        return buffer;
    }

    createSilentBuffer(ctx, seconds) {
        return ctx.createBuffer(
            1,
            ctx.sampleRate * seconds,
            ctx.sampleRate
        );
    }

    encodeMonoAudioBufferToMP3(buffer) {
        const samples = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;

        const mp3enc = new lamejs.Mp3Encoder(
            1,
            sampleRate,
            128
        );

        const mp3Data = [];
        const sampleBlockSize = 1152;

        for (let i = 0; i < samples.length; i += sampleBlockSize) {
            const chunk = samples.subarray(i, i + sampleBlockSize);

            const int16Chunk = new Int16Array(chunk.length);

            for (let j = 0; j < chunk.length; j++) {
                let val = chunk[j] * 32767.5;

                int16Chunk[j] =
                    val < -32768 ? -32768 :
                    val > 32767 ? 32767 :
                    val;
            }

            const mp3buf = mp3enc.encodeBuffer(int16Chunk);

            if (mp3buf.length > 0) {
                mp3Data.push(mp3buf);
            }
        }

        const end = mp3enc.flush();

        if (end.length > 0) {
            mp3Data.push(end);
        }

        return new Blob(mp3Data, {
            type: 'audio/mp3'
        });
    }

    escapeXML(text) {
        return String(text !== null && text !== undefined ? text : '').replace(
            /[&<>"']/g,
            c => ({
                '&':'&amp;',
                '<':'&lt;',
                '>':'&gt;',
                '"':'&quot;',
                "'":'&apos;'
            }[c])
        );
    }

    buildQuestionSSML(q, isLast, includeExp) {
        const prefix = isLast
            ? '最終問題です'
            : '問題';

        const question =
            this.escapeXML(
                this.app.applyPronunciations(q.q, q)
            );

        const answer =
            this.escapeXML(
                this.app.applyPronunciations(q.a, q)
            );

        const explanation =
            this.escapeXML(
                this.app.applyPronunciations(
                    q.explanation || '',
                    q
                )
            );

        return `<speak>${prefix}<break time="1s"/>${question}<break time="1s"/>${answer}${
            includeExp && explanation
                ? `<break time="1s"/>${explanation}`
                : ''
        }<break time="2s"/></speak>`;
    }

    async startAudioExport() {
        if (!this.app.ttsApiKey) return this.app.showToast('設定画面でGoogle Cloud Text-to-Speech APIキーを登録してください', 'error');
        const targetSetId = document.getElementById('audio-export-target-set').value;
        const targetSet = this.app.studySets.find(s => s.id === targetSetId);
        const questions = targetSet ? targetSet.questions : [];
        if (!questions.length) return this.app.showToast('対象のセットに問題が登録されていません', 'error');
        const count = parseInt(document.getElementById('audio-export-count').value, 10);
        const includeExp = document.getElementById('audio-export-explanation').checked;
        const prioritySelect = document.getElementById('audio-export-priority');
        const priorityMode = prioritySelect && prioritySelect.value ? prioritySelect.value : 'unanswered';
        const shuffled = [...questions];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const unanswered = shuffled.filter(q => (Number(q.total) || 0) === 0);
        const lowAccuracy = shuffled.filter(q => (Number(q.total) || 0) > 0 && ((Number(q.correct) || 0) / Number(q.total)) < 0.5);
        const remaining = shuffled.filter(q => !unanswered.includes(q) && !lowAccuracy.includes(q));
        if (priorityMode === 'low-accuracy') {
            remaining.sort((a, b) => this.app.getAccuracyRatio(a) - this.app.getAccuracyRatio(b));
        }
        const prioritized = priorityMode === 'low-accuracy'
            ? [...lowAccuracy.sort((a, b) => this.app.getAccuracyRatio(a) - this.app.getAccuracyRatio(b)), ...unanswered, ...remaining]
            : [...unanswered, ...lowAccuracy.sort((a, b) => this.app.getAccuracyRatio(a) - this.app.getAccuracyRatio(b)), ...remaining];
        const selected = prioritized.slice(0, Math.min(count, prioritized.length));
        const startBtn = document.getElementById('btn-start-export');
        const progContainer = document.getElementById('audio-export-progress-container');
        const progBar = document.getElementById('audio-export-progress-bar');
        const progStatus = document.getElementById('audio-export-status');
        startBtn.classList.add('hidden');
        document.getElementById('audio-export-result').classList.add('hidden');
        progContainer.classList.remove('hidden'); progContainer.classList.add('flex');
        const updateProg = (msg, pct) => { progStatus.textContent = msg; progBar.style.width = `${pct}%`; };
        updateProg('準備中...', 0);
        let decodeCtx = null;
        try {
            const targetSampleRate = 24000;
            decodeCtx = new (window.AudioContext || window.webkitAudioContext)({sampleRate: targetSampleRate});
            let completed = 0;
            const buffers = await this.app.mapWithConcurrency(selected, 3, async (q, i) => {
                const ssml = this.buildQuestionSSML(q, i === selected.length - 1, includeExp);
                const b64 = await this.app.fetchCloudTextToSpeechAPI(ssml);
                const buffer = this.base64ToAudioBuffer(b64, decodeCtx);
                completed++;
                updateProg(`音声生成中 (${completed}/${selected.length})...`, completed / selected.length * 90);
                return buffer;
            });
            await decodeCtx.close(); decodeCtx = null;
            updateProg('音声を結合・MP3変換中...', 95);
            const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
            const renderCtx = new OfflineAudioContext(1, totalLength, targetSampleRate);
            let offset = 0;
            for (const buf of buffers) {
                const source = renderCtx.createBufferSource(); source.buffer = buf;
                source.connect(renderCtx.destination); source.start(offset / targetSampleRate); offset += buf.length;
            }
            const finalBuffer = await renderCtx.startRendering();
            this.exportedAudioBlob = this.encodeMonoAudioBufferToMP3(finalBuffer);
            if (this.exportedAudioUrl) URL.revokeObjectURL(this.exportedAudioUrl);
            this.exportedAudioUrl = URL.createObjectURL(this.exportedAudioBlob);
            updateProg('完了！', 100);
            setTimeout(() => {
                progContainer.classList.add('hidden'); progContainer.classList.remove('flex');
                document.getElementById('audio-export-result').classList.remove('hidden');
                startBtn.classList.remove('hidden'); startBtn.textContent = 'もう一度作成する';
            }, 500);
        } catch (e) {
            if (decodeCtx) decodeCtx.close().catch(() => {});
            this.app.showToast(e.message, 'error');
            progContainer.classList.add('hidden'); progContainer.classList.remove('flex'); startBtn.classList.remove('hidden');
        }
    }

    playExportedAudio() {
        if (!this.exportedAudioUrl) return;
        
        if (!this.audioElement) {
            this.audioElement = new Audio(this.exportedAudioUrl);
            this.audioElement.onended = () => this.stopExportedAudio();
        } else {
            this.audioElement.src = this.exportedAudioUrl;
        }
        
        this.audioElement.play();
        document.getElementById('btn-play-audio').classList.add('hidden');
        document.getElementById('btn-stop-audio').classList.remove('hidden');
        document.getElementById('btn-stop-audio').classList.add('flex');
    }

    stopExportedAudio() {
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.currentTime = 0;
        }
        document.getElementById('btn-stop-audio').classList.add('hidden');
        document.getElementById('btn-stop-audio').classList.remove('flex');
        document.getElementById('btn-play-audio').classList.remove('hidden');
    }

    downloadExportedAudio() {
        if (!this.exportedAudioUrl) return;
        const a = document.createElement('a');
        a.href = this.exportedAudioUrl;
        a.download = `quiz_audio_${new Date().getTime()}.mp3`;
        a.click();
    }

}