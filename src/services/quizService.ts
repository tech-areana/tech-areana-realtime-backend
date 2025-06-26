import { API_URL } from '../config/env';
import type { QuizQuestion } from '../models/types';

let cache: QuizQuestion[] = [];

/** 外部 API からクイズ配列を取得し 1 度だけキャッシュ */
export const loadQuizQuestions = async (): Promise<QuizQuestion[]> => {
  if (cache.length) return cache;
  const res = await fetch(`${API_URL}/api/questions/random`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const raw = await res.json();
  cache = raw.map((it: any): QuizQuestion => ({
    questionid: it.questionid,
    question: it.question,
    options: [it.option1, it.option2, it.option3, it.option4],
    correctAnswer: it.answer === 'A' ? 0 : it.answer === 'B' ? 1 : it.answer === 'C' ? 2 : 3,
    level: it.level,
    explanation: it.explanation,
  }));
  console.log("Quiz questions loaded and cached:", raw);
  return cache;
};