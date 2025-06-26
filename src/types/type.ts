import { Server as SocketIOServer, Socket } from 'socket.io';
/* ------------------------------------------------------------------
 * 型定義
 * ----------------------------------------------------------------*/
export interface QuizQuestion {
  questionid: string;
  question: string;
  options: string[];
  correctAnswer: number; // 0–3
  level: string;
  explanation: string;
}

export interface Member {
  id: string;
  name: string;
}

export interface AnswerInfo {
  answer: number;
  timeLeft: number; // 秒
}

export interface GameState {
  currentQuestion: number;
  usersReady: string[]; // userId のリスト
  answers: Record<number, Record<string, AnswerInfo>>; // 問番→userId→AnswerInfo
  scores: Record<string, number>; // userId→score
  startTime: number | null; // epoch ms
  timeLeft: number; // 現在残り時間（秒）
}

// Socket.IO の Socket にカスタムプロパティを追加
export interface ExtendedSocket extends Socket {
  userId?: string;
  userName?: string;
}
