import { Server as SocketIOServer } from 'socket.io';
import type { ExtendedSocket, Member } from '../models/types';
import { loadQuizQuestions } from '../services/quizService';
import * as room from '../services/roomService';  // emitRoomInfo を含む

export const registerSocketHandlers = (io: SocketIOServer) => {
  /* ルームごとタイマー */
  const timers: Record<string, NodeJS.Timeout> = {};
  let quizCache: Awaited<ReturnType<typeof loadQuizQuestions>> = [];

  io.on('connection', async (socket: ExtendedSocket) => {
    console.log('Socket connected:', socket.id);
    if (!quizCache.length) quizCache = await loadQuizQuestions();

    /* ---------- ユーザー基本情報 ---------- */
    socket.on('setUserInfo', ({ userId, userName }) => {
      socket.userId = userId;
      socket.userName = userName;
    });

    /* ---------- ルーム生成 ---------- */
    socket.on('createRoom', async ({ watchword, user }: { watchword: string; user: Member }) => {
      try {
        await room.createRoom(watchword, user);
        socket.join(watchword);
        await room.emitRoomInfo(io.of('/'), watchword);   // ← io を渡す
        socket.emit('roomCreated', { watchword });
      } catch (e) {
        sendError(socket, e);
      }
    });

    /* ---------- ルーム参加 ---------- */
    socket.on('joinRoom', async ({ watchword, user }) => {
      try {
        await room.joinRoom(watchword, user);
        socket.join(watchword);
        await room.emitRoomInfo(io.of('/'), watchword);   // ← io を渡す
        socket.emit('roomJoined', { watchword });
      } catch (e) {
        sendError(socket, e);
      }
    });

    /* ---------- ゲーム開始 ---------- */
    socket.on('startGame', async ({ watchword }) => {
      try {
        await room.startGame(watchword);
        io.to(watchword).emit('gameStarted');
      } catch (e) {
        sendError(socket, e);
      }
    });

    /* ---------- ユーザー準備完了 ---------- */
    socket.on('userReadyForGame', async ({ watchword, userId }) => {
      const state = await room.markUserReady(watchword, userId);
      const members = await room.getMembers(watchword);
      if (state.usersReady.length === members.length) {
        startQuestionLoop(watchword, 0);
      }
    });

    /* ---------- 回答送信 ---------- */
    socket.on('submitAnswer', async ({ watchword, userId, answerIndex, timeLeft }) => {
      const s = await room.submitAnswer(watchword, userId, answerIndex, timeLeft);
      const members = await room.getMembers(watchword);
      const answered = Object.keys(s.answers[s.currentQuestion]).length;
      if (answered === members.length) finishQuestion(watchword);
    });

    /* ---------- ルーム退出 ---------- */
    socket.on('leaveRoom', async ({ watchword, userId }) => {
      const res = await room.leaveRoom(watchword, userId);
      socket.leave(watchword);
      if (res.deleted) io.to(watchword).emit('roomDeleted');
      else await room.emitRoomInfo(io.of('/'), watchword);   // ← io を渡す
      socket.emit('roomLeft');
    });

    /* ---------- 内部ヘルパ ---------- */
    /* ---------- 内部ヘルパ ---------- */
    const startQuestionLoop = async (w: string, idx: number) => {
      // キャッシュが空なら異常
      if (idx >= quizCache.length) return finishGame(w);

      // ***** 問題開始 *****
      const q = await room.beginQuestion(w, idx, quizCache); // ← gameState を更新

      io.to(w).emit('gameStateUpdate', {
        question: q.question,
        options: q.options,
        questionNumber: idx + 1,
        totalQuestions: quizCache.length,
        gamePhase: 'showQuestion',
        timeLeft: 30,
        level: q.level,
      });

      /* -------- 20 秒カウントダウン -------- */
      let totalLeft = 20;
      timers[w] && clearInterval(timers[w]);
      timers[w] = setInterval(() => {
        totalLeft--;
        /* 5 秒経過後から回答時間 15 秒 */
        io.to(w).emit('timeUpdate', {
          timeLeft: Math.max(totalLeft - 5, 0),
          totalTimeLeft: totalLeft,
        });
        if (totalLeft <= 0) finishQuestion(w);
      }, 1000);
    };

    const finishQuestion = async (w: string) => {
      /* ---- タイマーを止める ---- */
      timers[w] && clearInterval(timers[w]);

      /* 正誤判定・スコア計算 */
      const { state, correct } = await room.finaliseQuestion(w, quizCache);
      const qIdx = state.currentQuestion;

      io.to(w).emit('gameStateUpdate', {
        question: quizCache[qIdx].question,
        options: quizCache[qIdx].options,
        correctAnswer: correct,
        correctAnswerText: quizCache[qIdx].options[correct],
        gamePhase: 'results',
        questionNumber: qIdx + 1,
        totalQuestions: quizCache.length,
      });

      /* 3 秒見せて次の問題へ */
      setTimeout(() => startQuestionLoop(w, qIdx + 1), 3000);
    };

    const finishGame = async (w: string) => {
      const scores = await room.endGame(w);   // ← status を waiting に戻し、gameState クリア
      io.to(w).emit('gameEnded', scores);     // クライアント → リザルト画面へ
    };

  });
};

/* 共通エラーハンドラ */
function sendError(socket: ExtendedSocket, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  socket.emit('error', { message: msg });
}
