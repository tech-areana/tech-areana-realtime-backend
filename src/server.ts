import dotenv from 'dotenv';
import express, { Express } from 'express';
import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import redisClient from './redisClient';
import { ExtendedSocket, GameState, Member, QuizQuestion } from './types/type';


/* ------------------------------------------------------------------
 * 環境変数
 * ----------------------------------------------------------------*/
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: envFile });

/* ------------------------------------------------------------------
 * Express & Socket.IO 初期化
 * ----------------------------------------------------------------*/
const app: Express = express();
app.use(cors());

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: [process.env.CLIENT_ORIGIN as string, 'http://localhost:3000','http://localhost:3001'],
    methods: ['GET', 'POST'],
  },
});

/* ------------------------------------------------------------------
 * 定数・状態
 * ----------------------------------------------------------------*/
const MAX_MEMBERS = 6;

let quizQuestions: QuizQuestion[] = [];

// ルームごとのタイマー保持
const roomTimers: Record<string, NodeJS.Timeout> = {};

/* ------------------------------------------------------------------
 * 外部 API からクイズ取得
 * ----------------------------------------------------------------*/
const fetchQuizQuestions = async (): Promise<void> => {
  try {
    console.log('外部APIからクイズデータを取得中...');
    const response = await fetch(`${process.env.API_URL}/api/questions/random`);

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data: any[] = await response.json();
    quizQuestions = data.map((item): QuizQuestion => ({
      questionid: item.questionid,
      question: item.question,
      options: [item.option1, item.option2, item.option3, item.option4],
      correctAnswer: item.answer === 'A' ? 0 : item.answer === 'B' ? 1 : item.answer === 'C' ? 2 : 3,
      level: item.level,
      explanation: item.explanation,
    }));

    console.log(`${quizQuestions.length} 問のクイズデータを取得しました`);
  } catch (error) {
    console.error('クイズデータの取得に失敗しました:', error);
  }
};

// サーバー起動時にクイズデータを取得
fetchQuizQuestions();

/* ------------------------------------------------------------------
 * Socket.IO メインロジック
 * ----------------------------------------------------------------*/
io.on('connection', (socket: ExtendedSocket) => {
  console.log(`接続したユーザーのSocketIdは...: ${socket.id}`);

  /* -----------------------------
   * ユーザー情報設定
   * ---------------------------*/
  socket.on('setUserInfo', ({ userId, userName }: { userId: string; userName: string }) => {
    socket.userId = userId;
    socket.userName = userName;
    console.log(`ユーザーID: ${userId}, ユーザーネーム: ${userName}`);
  });

  /* -----------------------------
   * ルーム作成
   * ---------------------------*/
  socket.on('createRoom', async ({ watchword, user }: { watchword: string; user: Member }) => {
    socket.userId = user.id;
    socket.userName = user.name;

    const roomKey = `room:${watchword}`;
    const roomExists = await redisClient.exists(roomKey);
    if (roomExists) {
      socket.emit('error', { message: 'この合言葉は既に使用されています。' });
      return;
    }

    const roomInfo = {
      host: user.id,
      members: JSON.stringify([{ id: user.id, name: user.name }]),
      status: 'waiting',
    } as const;

    await redisClient.hset(roomKey, roomInfo);
    socket.join(watchword);
    socket.emit('roomCreated', { watchword });
    updateRoomInfo(watchword);
    console.log(`ルームの作成に成功しました！: "${watchword}"`);
  });

  /* -----------------------------
   * ルーム参加
   * ---------------------------*/
  socket.on('joinRoom', async ({ watchword, user }: { watchword: string; user: Member }) => {
    socket.userId = user.id;
    socket.userName = user.name;

    const roomKey = `room:${watchword}`;
    const roomExists = await redisClient.exists(roomKey);
    if (!roomExists) {
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }

    const membersJson = (await redisClient.hget(roomKey, 'members')) || '[]';
    const members: Member[] = JSON.parse(membersJson);

    if (members.length >= MAX_MEMBERS) {
      socket.emit('error', { message: 'このルームは満員です。' });
      return;
    }

    if (members.some((m) => m.id === user.id)) {
      socket.join(watchword);
      socket.emit('roomJoined', { watchword });
      updateRoomInfo(watchword);
      return;
    }

    const newMembers = [...members, { id: user.id, name: user.name }];
    await redisClient.hset(roomKey, 'members', JSON.stringify(newMembers));

    socket.join(watchword);
    socket.emit('roomJoined', { watchword });
    updateRoomInfo(watchword);
  });

  /* -----------------------------
   * ゲーム開始
   * ---------------------------*/
  socket.on('startGame', async ({ watchword }: { watchword: string }) => {
    const roomKey = `room:${watchword}`;
    const hostId = await redisClient.hget(roomKey, 'host');
    const membersJson = await redisClient.hget(roomKey, 'members');
    const members: Member[] = JSON.parse(membersJson ?? '[]');

    if (socket.userId === hostId && members.length >= 2) {
      await redisClient.hset(roomKey, 'status', 'playing');

      const gameState: GameState = {
        currentQuestion: 0,
        usersReady: [],
        answers: {},
        scores: {},
        startTime: null,
        timeLeft: 30,
      };

      if (roomTimers[watchword]) {
        clearInterval(roomTimers[watchword]);
        delete roomTimers[watchword];
      }

      await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));
      io.to(watchword).emit('gameStarted');
      console.log(`合言葉 "${watchword}" のルームでクイズを開始します`);
    }
  });

  /* -----------------------------
   * ユーザー準備完了通知
   * ---------------------------*/
  socket.on('userReadyForGame', async ({ watchword, userId }: { watchword: string; userId: string }) => {
    const roomKey = `room:${watchword}`;
    const gameStateJson = await redisClient.hget(roomKey, 'gameState');
    const membersJson = await redisClient.hget(roomKey, 'members');
    if (!gameStateJson || !membersJson) return;

    const gameState: GameState = JSON.parse(gameStateJson);
    const members: Member[] = JSON.parse(membersJson);

    if (!gameState.usersReady.includes(userId)) {
      gameState.usersReady.push(userId);
      await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));
    }

    socket.join(watchword);

    if (gameState.usersReady.length === members.length) {
      setTimeout(() => startQuestion(watchword, 0), 1000);
    } else {
      const readyUserNames = members.filter((m) => gameState.usersReady.includes(m.id)).map((m) => m.name);
      socket.emit('gameStateUpdate', {
        gamePhase: 'waiting',
        waitingForUsers: readyUserNames,
        allUsersReady: false,
        message: `${gameState.usersReady.length}/${members.length} 人が準備完了`,
      });
    }
  });

  /* -----------------------------
   * 回答送信
   * ---------------------------*/
  socket.on('submitAnswer', async ({ watchword, userId, answerIndex, timeLeft }: { watchword: string; userId: string; answerIndex: number; timeLeft: number }) => {
    const roomKey = `room:${watchword}`;
    const gameStateJson = await redisClient.hget(roomKey, 'gameState');
    if (!gameStateJson) return;
    const gameState: GameState = JSON.parse(gameStateJson);
    const currentQ = gameState.currentQuestion;

    if (!gameState.answers[currentQ]) gameState.answers[currentQ] = {};
    gameState.answers[currentQ][userId] = { answer: answerIndex, timeLeft };
    await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));

    const membersJson = await redisClient.hget(roomKey, 'members');
    const members: Member[] = JSON.parse(membersJson ?? '[]');
    const answeredCount = Object.keys(gameState.answers[currentQ] || {}).length;

    if (answeredCount === members.length) processQuestionResults(watchword, currentQ);
  });

  /* -----------------------------
   * ルーム情報取得 (入室後)
   * ---------------------------*/
  socket.on('getRoomInfo', async ({ watchword, userId }: { watchword: string; userId: string }) => {
    const roomKey = `room:${watchword}`;
    if (!(await redisClient.exists(roomKey))) {
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }

    const membersJson = await redisClient.hget(roomKey, 'members');
    const members: Member[] = JSON.parse(membersJson ?? '[]');
    if (!members.some((m) => m.id === userId)) {
      socket.emit('error', { message: 'このルームのメンバーではありません。' });
      return;
    }

    socket.join(watchword);
    updateRoomInfo(watchword);
  });

  /* -----------------------------
   * ルーム退出
   * ---------------------------*/
  socket.on('leaveRoom', async ({ watchword, userId }: { watchword: string; userId: string }) => {
    const roomKey = `room:${watchword}`;
    if (!(await redisClient.exists(roomKey))) {
      socket.emit('error', { message: 'ルームが見つかりません。' });
      return;
    }

    if (roomTimers[watchword]) {
      clearInterval(roomTimers[watchword]);
      delete roomTimers[watchword];
    }

    const membersJson = await redisClient.hget(roomKey, 'members');
    const members: Member[] = JSON.parse(membersJson ?? '[]');
    const hostId = await redisClient.hget(roomKey, 'host');

    if (hostId === userId) {
      await redisClient.del(roomKey);
      io.to(watchword).emit('roomDeleted');
    } else {
      const updatedMembers = members.filter((m) => m.id !== userId);
      if (updatedMembers.length === 0) {
        await redisClient.del(roomKey);
        io.to(watchword).emit('roomDeleted');
      } else {
        await redisClient.hset(roomKey, 'members', JSON.stringify(updatedMembers));
        updateRoomInfo(watchword);
      }
    }

    socket.leave(watchword);
    socket.emit('roomLeft');
  });

  /* -----------------------------
   * 切断
   * ---------------------------*/
  socket.on('disconnect', () => {
    console.log(`接続が切断されたユーザーのSocketIdは... ${socket.id}`);
  });
});

/* ==================================================================
 *  ゲーム進行用関数群
 * =================================================================*/
const startQuestion = async (watchword: string, questionIndex: number): Promise<void> => {
  if (questionIndex >= quizQuestions.length) {
    endGame(watchword);
    return;
  }

  const question = quizQuestions[questionIndex];
  const roomKey = `room:${watchword}`;

  if (roomTimers[watchword]) clearInterval(roomTimers[watchword]);

  const gameStateJson = await redisClient.hget(roomKey, 'gameState');
  if (!gameStateJson) return;
  const gameState: GameState = JSON.parse(gameStateJson);

  gameState.currentQuestion = questionIndex;
  gameState.startTime = Date.now();
  gameState.timeLeft = 15;
  await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));

  io.to(watchword).emit('gameStateUpdate', {
    question: question.question,
    options: question.options,
    timeLeft: 30,
    gamePhase: 'showQuestion',
    questionNumber: questionIndex + 1,
    totalQuestions: quizQuestions.length,
    allUsersReady: true,
    level: question.level,
  });

  roomTimers[watchword] = setInterval(async () => {
    const currentGameStateJson = await redisClient.hget(roomKey, 'gameState');
    if (!currentGameStateJson) {
      clearInterval(roomTimers[watchword]);
      delete roomTimers[watchword];
      return;
    }

    const currentGameState: GameState = JSON.parse(currentGameStateJson);
    const elapsed = Math.floor((Date.now() - (currentGameState.startTime || 0)) / 1000);
    const timeLeftTotal = Math.max(0, 20 - elapsed);
    currentGameState.timeLeft = Math.max(0, 15 - Math.max(0, elapsed - 5));
    await redisClient.hset(roomKey, 'gameState', JSON.stringify(currentGameState));

    io.to(watchword).emit('timeUpdate', {
      timeLeft: currentGameState.timeLeft,
      totalTimeLeft: timeLeftTotal,
    });

    if (timeLeftTotal <= 0) {
      clearInterval(roomTimers[watchword]);
      delete roomTimers[watchword];
      processQuestionResults(watchword, questionIndex);
    }
  }, 1000);
};

const processQuestionResults = async (watchword: string, questionIndex: number): Promise<void> => {
  const roomKey = `room:${watchword}`;
  const gameStateJson = await redisClient.hget(roomKey, 'gameState');
  if (!gameStateJson) return;
  const gameState: GameState = JSON.parse(gameStateJson);

  if (!gameState.answers) gameState.answers = {} as GameState['answers'];
  if (roomTimers[watchword]) {
    clearInterval(roomTimers[watchword]);
    delete roomTimers[watchword];
  }

  const correctAnswer = quizQuestions[questionIndex].correctAnswer;
  const answers = gameState.answers[questionIndex] || {};
  if (!gameState.scores) gameState.scores = {};

  Object.keys(answers).forEach((uid) => {
    if (!gameState.scores[uid]) gameState.scores[uid] = 0;
    if (answers[uid].answer === correctAnswer) gameState.scores[uid] += 10;
  });

  await redisClient.hset(roomKey, 'gameState', JSON.stringify(gameState));

  io.to(watchword).emit('gameStateUpdate', {
    question: quizQuestions[questionIndex].question,
    options: quizQuestions[questionIndex].options,
    gamePhase: 'results',
    questionNumber: questionIndex + 1,
    totalQuestions: quizQuestions.length,
    correctAnswer,
    correctAnswerText: quizQuestions[questionIndex].options[correctAnswer],
    explanation: quizQuestions[questionIndex].explanation,
  });

  setTimeout(() => startQuestion(watchword, questionIndex + 1), 3000);

  const zKey = `scores:${watchword}:${questionIndex + 1}`;
  await redisClient.del(zKey);

  const membersJson = await redisClient.hget(roomKey, 'members');
  const members: Member[] = JSON.parse(membersJson ?? '[]');

  for (const m of members) {
    const uid = m.id;
    const base = {
      id: uid,
      name: m.name,
      avatar: `https://api.dicebear.com/7.x/thumbs/svg?seed=${m.name}`,
      responseTime: answers[uid]?.timeLeft ?? 0,
      totalQuestions: quizQuestions.length,
      isCurrentUser: false,
    };
    const score = gameState.scores[uid] ?? 0;
    await redisClient.zadd(zKey, { score, member: JSON.stringify(base) });
  }
  io.to(watchword).emit('scoresUpdated');
};

const endGame = async (watchword: string): Promise<void> => {
  const roomKey = `room:${watchword}`;
  const gameStateJson = await redisClient.hget(roomKey, 'gameState');
  if (roomTimers[watchword]) {
    clearInterval(roomTimers[watchword]);
    delete roomTimers[watchword];
  }
  if (!gameStateJson) return;
  const gameState: GameState = JSON.parse(gameStateJson);

  await redisClient.hset(roomKey, 'status', 'waiting');
  await redisClient.hdel(roomKey, 'gameState');
  io.to(watchword).emit('gameEnded', gameState.scores || {});
};

/* ------------------------------------------------------------------
 * ルーム情報のブロードキャスト
 * ----------------------------------------------------------------*/
const updateRoomInfo = async (watchword: string): Promise<void> => {
  const roomKey = `room:${watchword}`;
  const roomInfo = await redisClient.hgetall(roomKey);
  let members: Member[] = [];
  try {
    members = JSON.parse(roomInfo.members || '[]');
  } catch {
    console.error('members の JSON パースに失敗:', roomInfo.members);
  }

  io.to(watchword).emit('updateRoom', {
    host: roomInfo.host,
    members,
    status: roomInfo.status,
  });
};

/* ------------------------------------------------------------------
 * サーバー起動
 * ----------------------------------------------------------------*/
const PORT = 4020;
server.listen(PORT, () => {
  console.log(`🚀 サーバーは ${PORT} 番ポートで準備しています`);
});
