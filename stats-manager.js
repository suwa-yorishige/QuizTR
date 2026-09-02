/** 学習成績の計算とダッシュボード・管理画面の統計表示を管理する。 */
class StatsManager {
    constructor(app) {
        this.app = app;
    }

    /**
     * 問題の正答率を計算する
     * @param {*} question 
     * @returns 
     */ 
    getAccuracyRatio(question) {
        if (!question || !question.total) return 0;
        return Number.isFinite(Number(question.accuracy)) ? Number(question.accuracy) : (question.correct || 0) / question.total;
    }

    /**
     * 問題の実効確認ポイントを取得する
     * @param {*} question 
     * @returns 
     */
    getEffectiveConfirmPoint(question) {
        const safeQuestion = question || {};
        const length = Math.max(1, String(safeQuestion.q || '').length);
        return Math.max(1, Math.min(length, Number(safeQuestion.confirmPoint) || length));
    }

    /**
     * 問題の解答位置スコアを計算する
     * @param {*} question 
     * @param {*} record 
     * @returns 
     */
    getBuzzPositionScore(question, record) {
        const safeQuestion = question || {};
        const length = Math.max(1, String(safeQuestion.q || '').length);
        const confirmPoint = this.getEffectiveConfirmPoint(question);
        const position = Math.max(0, Math.min(length, Number((record || {}).charIndex) || length));
        if (position <= confirmPoint) return 1;
        return Math.max(0, 1 - ((position - confirmPoint) / Math.max(1, length - confirmPoint)));
    }

    /**
     * 問題の習熟度メトリクスを計算する
     * @param {*} question 
     * @returns 
     */
    getMasteryMetrics(question) {
        const normalized = this.app.learningDataManager.normalizeQuestionData(question);
        const total = normalized.total || 0;
        const correct = normalized.correct || 0;
        const accuracy = total ? correct / total : 0;
        const accuracyConfidence = (accuracy * 0.7) + (Math.min(1, correct / 5) * 0.3);
        const validRecords = normalized.buzzRecords.filter(record => record && record.correct === true && Number.isFinite(Number(record.charIndex)));
        const timing = validRecords.length ? validRecords.reduce((sum, record) => sum + this.getBuzzPositionScore(normalized, record), 0) / validRecords.length : 0;
        const rawScore = Math.round((accuracyConfidence * 75) + (timing * 25));
        const score = correct >= 2 ? rawScore : Math.min(rawScore, 80);
        const ratios = validRecords.map(record => Number(record.charIndex) / this.getEffectiveConfirmPoint(normalized));
        const avgRatio = ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : null;
        return { score, accuracy, timing, avgRatio, avgRatioText: avgRatio === null ? '--' : `${Math.round(avgRatio * 100)}%` };
    }

    /**
     * 高正答率問題かどうかを判定する
     * @param {*} question 
     * @returns {boolean}
     */
    isHighAccuracyQuestion(question) {
        return (question.total || 0) >= HIGH_ACCURACY_MIN_ATTEMPTS && this.getAccuracyRatio(question) >= HIGH_ACCURACY_THRESHOLD;
    }

    /**
     * 高正答率問題のクールダウン中かどうかを判定する
     * @param {*} question 
     * @param {*} now 
     * @returns {boolean}
     */
    isHighAccuracyCooldown(question, now = Date.now()) {
        return !!(question.lastAnsweredAt && (now - Number(question.lastAnsweredAt)) < HIGH_ACCURACY_COOLDOWN_MS);
    }

    /**
     * 低正答率問題かどうかを判定する
     * @param {*} question 
     * @returns {boolean}
     */
    isLowAccuracyQuestion(question) {
        return (question.total || 0) > 0 && this.getAccuracyRatio(question) < LOW_ACCURACY_THRESHOLD;
    }

    /**
     * 古い問題かどうかを判定する
     * @param {*} question 
     * @param {*} now 
     * @returns {boolean}
     */
    isStaleQuestion(question, now = Date.now()) {
        return !!(question.lastAnsweredAt && (now - Number(question.lastAnsweredAt)) >= STALE_REVIEW_MS);
    }

    /**
     * 学習成績の統計情報をダッシュボードに表示する
     * @returns 
     */
    renderLearningSummary() {
        const period = this.app.summaryPeriod;
        const values = [];
        for (let index = period - 1; index >= 0; index--) {
            const date = new Date();
            date.setDate(date.getDate() - index);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            values.push(Number(this.app.dailyStats[key]) || 0);
        }
        const total = values.reduce((sum, value) => sum + value, 0);
        const max = Math.max(...values, 1);
        const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
        setText('stat-30day-total', total); setText('stat-30day-max', max); setText('stat-average', Math.round(total / period));
        setText('summary-period-label', period); setText('summary-start-label', `${period - 1}日前`);
        [7, 14, 30].forEach(days => { const button = document.getElementById(`summary-tab-${days}`); if (button) button.className = days === period ? 'px-3 py-1 text-xs rounded-md bg-soft-green-600 text-white font-bold' : 'px-3 py-1 text-xs rounded-md text-soft-green-700'; });
        const svg = document.getElementById('learning-30day-chart');
        if (!svg) return;
        const offsetX = 25, width = 275, height = 120, barWidth = width / values.length;
        let html = `<text x="0" y="10" font-size="10" fill="var(--color-chart-text)">${max}</text><text x="0" y="60" font-size="10" fill="var(--color-chart-text)">${Math.round(max / 2)}</text><text x="0" y="118" font-size="10" fill="var(--color-chart-text)">0</text><line x1="20" y1="0" x2="300" y2="0" stroke="var(--color-chart-grid)" stroke-width="1"/><line x1="20" y1="50" x2="300" y2="50" stroke="var(--color-chart-grid)" stroke-width="1"/><line x1="20" y1="100" x2="300" y2="100" stroke="var(--color-chart-grid)" stroke-width="1"/>`;
        values.forEach((value, index) => {
            const barHeight = (value / max) * 100;
            const date = new Date(); date.setDate(date.getDate() - (period - 1 - index));
            html += `<rect x="${offsetX + index * barWidth + 1}" y="${height - barHeight}" width="${barWidth - 2}" height="${barHeight}" rx="2" fill="${value > 0 ? 'var(--color-chart-bar)' : 'var(--color-chart-empty-bar)'}"><title>${date.getMonth() + 1}/${date.getDate()} : ${value}問</title></rect>`;
        });
        svg.innerHTML = `${html}<line x1="20" y1="120" x2="300" y2="120" stroke="var(--color-chart-grid)" stroke-width="1"/>`;
    }

    /**
     * 学習成績の統計情報を管理画面に表示する
     * @returns 
     */
    updateStats() {
        const set = this.app.studySets.find(item => item.id === this.app.activeSetId);
        if (!set) return;
        document.getElementById('stat-total-questions').textContent = set.questions.length;
        const today = document.getElementById('stat-today-answered'); if (today) today.textContent = this.app.getTodayAnsweredCount();
        const totals = set.questions.reduce((result, question) => ({ attempted: result.attempted + question.total, correct: result.correct + question.correct }), { attempted: 0, correct: 0 });
        document.getElementById('stat-accuracy').textContent = totals.attempted ? `${Math.round(totals.correct / totals.attempted * 100)}%` : '--%';
        this.renderLearningSummary();
    }

    /**
     * 学習成績の統計情報を管理画面に表示する
     * @returns 
     */
    renderManagerStats() {
        const set = this.app.studySets.find(item => item.id === this.app.managerSetId);
        if (!set) return;
        const total = set.questions.length;
        document.getElementById('manager-total-count').textContent = total;
        document.getElementById('manager-capacity-bar').style.width = `${Math.min(100, total / MAX_QUESTIONS_PER_SET * 100)}%`;
        const unanswered = set.questions.filter(question => (question.total || 0) === 0).length;
        const noExplanation = set.questions.filter(question => !(question.explanation || '').trim()).length;
        const noGenre = set.questions.filter(question => !(question.genre || '').trim()).length;
        [['manager-summary-unanswered', unanswered], ['manager-summary-no-explanation', noExplanation], ['manager-summary-no-genre', noGenre]].forEach(([id, value]) => { const element = document.getElementById(id); if (element) element.textContent = value; });
        this.renderDistribution(total, unanswered, set.questions);
        this.renderGenreSummary(set.questions);
        this.app.questionManager.updateQuestionFilterOptions();
        this.app.questionManager.renderQuestionList();
    }

    /**
     * 学習成績の分布を管理画面に表示する
     * @param {*} total 
     * @param {*} unanswered 
     * @param {*} questions 
     * @returns 
     */
    renderDistribution(total, unanswered, questions) {
        const chart = document.getElementById('manager-stats-chart');
        const accuracyTab = document.getElementById('distribution-tab-accuracy');
        const masteryTab = document.getElementById('distribution-tab-mastery');
        if (accuracyTab && masteryTab) {
            accuracyTab.className = `px-3 py-1.5 rounded-lg text-xs font-bold ${this.app.managerDistributionMetric === 'accuracy' ? 'bg-soft-green-600 text-white' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
            masteryTab.className = `px-3 py-1.5 rounded-lg text-xs font-bold ${this.app.managerDistributionMetric === 'mastery' ? 'bg-soft-green-600 text-white' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
        }
        if (!chart) return;
        if (!total) { chart.innerHTML = '<p class="text-sm text-soft-green-500 py-2">データがありません</p>'; return; }
        const bins = [{ label: '0〜19%', min: 0, max: 20, count: 0 }, { label: '20〜39%', min: 20, max: 40, count: 0 }, { label: '40〜59%', min: 40, max: 60, count: 0 }, { label: '60〜79%', min: 60, max: 80, count: 0 }, { label: '80〜100%', min: 80, max: 101, count: 0 }];
        questions.forEach(question => { if (!(question.total || 0)) return; const value = this.app.managerDistributionMetric === 'mastery' ? this.getMasteryMetrics(question).score : this.getAccuracyRatio(question) * 100; (bins.find(bin => value >= bin.min && value < bin.max) || bins[bins.length - 1]).count++; });
        const maxCount = Math.max(1, unanswered, ...bins.map(bin => bin.count));
        const label = count => `${count}問（${Math.round(count / total * 100)}%）`;
        const rows = bins.map(bin => `<div class="flex items-center gap-2"><div class="w-20 text-xs font-bold text-soft-green-700">${bin.label}</div><div class="flex-1 bg-soft-green-100 rounded-full h-5 overflow-hidden"><div class="${this.app.managerDistributionMetric === 'mastery' ? 'bg-indigo-500' : 'bg-soft-green-500'} h-5 rounded-full transition-all" style="width:${Math.max(2, Math.round(bin.count / maxCount * 100))}%"></div></div><div class="w-24 text-right text-xs font-bold text-soft-green-800">${label(bin.count)}</div></div>`).join('');
        chart.innerHTML = `${rows}<div class="flex items-center gap-2"><div class="w-20 text-xs font-bold text-soft-green-500">未回答</div><div class="flex-1 bg-soft-green-100 rounded-full h-5 overflow-hidden"><div class="bg-gray-400 h-5 rounded-full transition-all" style="width:${Math.max(2, Math.round(unanswered / maxCount * 100))}%"></div></div><div class="w-24 text-right text-xs font-bold text-soft-green-800">${label(unanswered)}</div></div>`;
    }

    /**
     * 学習成績のジャンル別統計情報を管理画面に表示する
     * @param {*} questions 
     * @returns 
     */
    renderGenreSummary(questions) {
        const standardAql = document.getElementById('genre-analysis-tab-aql');
        const standardQma = document.getElementById('genre-analysis-tab-qma');
        if (standardAql && standardQma) {
            standardAql.className = `px-3 py-1.5 rounded-lg text-xs font-bold ${this.app.managerGenreStandard === 'aql' ? 'bg-soft-green-600 text-white' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
            standardQma.className = `px-3 py-1.5 rounded-lg text-xs font-bold ${this.app.managerGenreStandard === 'qma' ? 'bg-soft-green-600 text-white' : 'text-soft-green-800 hover:bg-soft-green-100'}`;
        }
        const box = document.getElementById('manager-genre-summary'); if (!box) return;
        const counts = new Map();
        questions.forEach(question => {
            const rawGenre = String(question.genre || '').trim();
            let genre = AI_SUBGENRES[rawGenre] ? rawGenre : '';
            if (!genre && rawGenre) genre = Object.entries(AI_SUBGENRES).find(([, values]) => values.includes(rawGenre))?.[0] || '';
            if (!genre && question.subgenre) genre = Object.entries(AI_SUBGENRES).find(([, values]) => values.includes(String(question.subgenre).trim()))?.[0] || '';
            genre = genre || '未設定';
            const name = this.app.managerGenreStandard === 'qma' ? this.app.toQMAGenre(genre) : genre;
            if (!counts.has(name)) counts.set(name, { total: 0, attempted: 0, correct: 0, unanswered: 0 });
            const result = counts.get(name); result.total++; result.attempted += question.total || 0; result.correct += question.correct || 0; if (!(question.total || 0)) result.unanswered++;
        });
        const label = this.app.managerGenreStandard === 'qma' ? 'QMA基準' : 'AQL基準';
        const rows = [...counts.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, result]) => `<tr class="border-t border-soft-green-100"><td class="px-3 py-2 font-semibold">${Utils.escapeHTML(name)}</td><td class="px-3 py-2 text-right">${result.total}</td><td class="px-3 py-2 text-right">${result.attempted ? `${Math.round(result.correct / result.attempted * 100)}%` : '--%'}</td><td class="px-3 py-2 text-right">${result.unanswered}</td></tr>`).join('');
        box.innerHTML = `<table class="w-full text-sm"><thead class="bg-soft-green-100 text-soft-green-800"><tr><th class="px-3 py-2 text-left">ジャンル（${label}）</th><th class="px-3 py-2 text-right">登録問題数</th><th class="px-3 py-2 text-right">平均正解率</th><th class="px-3 py-2 text-right">未回答数</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
}