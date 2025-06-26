import { Socket } from 'socket.io';

export interface QuizQuestion {
  questionid: string;
  question: string;
  options: string[];
  correctAnswer: number;
  level: string;
  explanation: string;
}

export interface Member {
  id: string;
  name: string;
}

export interface AnswerInfo {
  answer: number;
  timeLeft: number;
}

export interface GameState {
  currentQuestion: number;
  usersReady: string[];
  answers: Record<number, Record<string, AnswerInfo>>;
  scores: Record<string, number>;
  startTime: number | null;
  timeLeft: number;
}

export interface ExtendedSocket extends Socket {
  userId?: string;
  userName?: string;
}
