/** 学習問題データと出題サイクルの状態を管理する。 */
class LearningDataManager {
    constructor(app) {
        this.app = app;
    }

    /**
     * 学習データの形式を正規化する
     */
    normalizeLearningData() {
        this.app.studySets.forEach(set => {
            set.cycleSeenQuestionIds = Array.isArray(set.cycleSeenQuestionIds) ? set.cycleSeenQuestionIds : [];
            set.cycleStartedAt = set.cycleStartedAt || null;
            set.questions = set.questions.map(question => this.normalizeQuestionData(question));
        });
    }

    /**
     * 学習問題データの形式を正規化する
     * @param {*} question 
     * @returns 
     */
    normalizeQuestionData(question) {
        const id = question.id || question.questionId || (`q-${Date.now()}${Math.random().toString(36).substring(2)}`);
        question.id = id;
        question.questionId = question.questionId || id;
        question.genre = String(question.genre || '');
        question.subgenre = String(question.subgenre || '');
        question.difficulty = String(question.difficulty || '');
        question.correct = Number.isFinite(Number(question.correct)) ? Number(question.correct) : 0;
        question.total = Number.isFinite(Number(question.total)) ? Number(question.total) : 0;
        question.accuracy = question.total > 0 ? question.correct / question.total : 0;
        question.lastAnsweredAt = question.lastAnsweredAt ? Number(question.lastAnsweredAt) : null;
        question.lastResult = question.lastResult === true || question.lastResult === false ? question.lastResult : null;
        question.confirmPoint = Math.max(0, Math.min(String(question.q || '').length, Number(question.confirmPoint) || 0));
        question.buzzRecords = Array.isArray(question.buzzRecords) ? question.buzzRecords.slice(-100) : [];
        question.streak = Number.isFinite(Number(question.streak)) ? Number(question.streak) : 0;
        if (!Number.isFinite(Number(question.level))) {
            const accuracy = question.total > 0 ? question.correct / question.total : 0;
            if (question.total === 0) question.level = 0;
            else if (question.total >= 6 && accuracy >= 0.9) question.level = 4;
            else if (question.total >= 4 && accuracy >= 0.75) question.level = 3;
            else if (accuracy >= 0.5) question.level = 2;
            else question.level = 1;
        } else {
            question.level = Math.max(0, Math.min(5, Number(question.level)));
        }
        return question;
    }

    /**
     * 学習問題のIDを取得する
     * @param {*} question 
     * @returns 
     */
    getQuestionId(question) {
        return question.questionId || question.id;
    }

    /**
     * 学習サイクルで既に出題済みの問題IDの集合を取得する
     * @param {*} set 
     * @returns 
     */
    getCycleSeenSet(set) {
        if (!set) return new Set();
        if (!Array.isArray(set.cycleSeenQuestionIds)) set.cycleSeenQuestionIds = [];
        return new Set(set.cycleSeenQuestionIds);
    }

    /**
     * 学習サイクルの状態をリセットする
     * @param {*} set 
     * @returns 
     */
    resetQuestionCycle(set) {
        if (!set) return;
        set.cycleSeenQuestionIds = [];
        set.cycleStartedAt = Date.now();
    }

    /**
     * 学習サイクルが完了しているかを判定する
     * @param {*} set 
     * @param {*} questions 
     * @returns 
     */
    isCycleCompleted(set, questions) {
        const seen = this.getCycleSeenSet(set);
        return questions.length > 0 && questions.map(question => this.getQuestionId(question)).every(id => seen.has(id));
    }

    /**
     * 学習サイクルで問題を出題済みにマークする
     * @param {*} set 
     * @param {*} question 
     * @returns 
     */
    markQuestionSeenInCycle(set, question) {
        if (!set || !question) return;
        const seen = this.getCycleSeenSet(set);
        seen.add(this.getQuestionId(question));
        set.cycleSeenQuestionIds = Array.from(seen);
        if (!set.cycleStartedAt) set.cycleStartedAt = Date.now();
    }
}