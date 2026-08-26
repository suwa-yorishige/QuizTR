// constants.js
const MAX_SETS = 10;
        const MAX_QUESTIONS_PER_SET = 1500;
        const MAX_TOTAL_QUESTIONS = 10000;
        const MAX_SET_NAME_LENGTH = 30;
        const MAX_MEMO_QUESTIONS = 10;
        const BULK_GENRE_CLASSIFY_LIMIT = 30; // 1回のプロンプトで安定してJSON判定しやすい上限の目安
        const CSV_EXPLANATION_BATCH_SIZE = 5;
        const CSV_EXPLANATION_PROMPT_LIMIT = 3;
        const CSV_EXPLANATION_LIMIT = CSV_EXPLANATION_BATCH_SIZE * CSV_EXPLANATION_PROMPT_LIMIT;
        const HIGH_ACCURACY_THRESHOLD = 0.8;
        const HIGH_ACCURACY_MIN_ATTEMPTS = 3;
        const HIGH_ACCURACY_COOLDOWN_DAYS = 7;
        const HIGH_ACCURACY_COOLDOWN_MS = HIGH_ACCURACY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
        const LOW_ACCURACY_THRESHOLD = 0.5;
        const STALE_REVIEW_DAYS = 7;
        const STALE_REVIEW_MS = STALE_REVIEW_DAYS * 24 * 60 * 60 * 1000;
        const QMA_GENRE_MAP = {
            '理系': '理系学問',
            '文学': '文系学問',
            '言葉': '文系学問',
            '日本史': '社会',
            '世界史': '社会',
            '地理': '社会',
            '公民': '社会',
            '芸術': '文系学問',
            '漫画・アニメ・ゲーム': 'アニメ&ゲーム',
            '生活': 'ライフスタイル',
            'スポーツ': 'スポーツ',
            '芸能': '芸能',
            'ノンセク': 'ノンジャンル'
        };