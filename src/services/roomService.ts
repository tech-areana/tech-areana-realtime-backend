import redisClient from '../redisClient';
import type { Member, GameState, QuizQuestion } from '../models/types';
import type { BroadcastOperator, DefaultEventsMap, Namespace } from 'socket.io';

const MAX_MEMBERS = 6;

/* ------------------------------- Hash Helpers ------------------------------ */
const getKey = (w: string) => `room:${w}`;

export const getMembers = async (w: string): Promise<Member[]> => {
    return JSON.parse(await redisClient.hget(getKey(w), 'members'));
};

const setMembers = (w: string, members: Member[]) =>
    redisClient.hset(getKey(w), 'members', JSON.stringify(members));

const getGameState = async (w: string): Promise<GameState | null> => {
    const raw = await redisClient.hget(getKey(w), 'gameState');
    return raw ? (JSON.parse(raw) as GameState) : null;
};

const setGameState = (w: string, state: GameState) =>
    redisClient.hset(getKey(w), 'gameState', JSON.stringify(state));

/* ---------------------------------- API ----------------------------------- */
export const createRoom = async (w: string, host: Member) => {
    const key = getKey(w);
    if (await redisClient.exists(key)) throw new Error('Room already exists');
    await redisClient.hset(key, {
        host: host.id,
        members: JSON.stringify([host]),
        status: 'waiting',
    });
};


export const emitRoomInfo = async (io: Namespace, w: string) => {
    const key = `room:${w}`;
    const room = await redisClient.hgetall(key);
    if (!room.host) return;              // ホスト未設定なら送らない

    io.to(w).emit('updateRoom', {        // ← ここで .to(w)
        host: room.host,
        members: JSON.parse(room.members || '[]'),
        status: room.status ?? 'waiting',
    });
};

export const joinRoom = async (w: string, user: Member) => {
    const key = getKey(w);
    if (!(await redisClient.exists(key))) throw new Error('Room not found');
    const members = await getMembers(w);
    if (members.length >= MAX_MEMBERS) throw new Error('Room full');
    if (!members.some((m) => m.id === user.id)) {
        members.push(user);
        await setMembers(w, members);
    }
    return members;
};

export const leaveRoom = async (w: string, userId: string) => {
    const key = getKey(w);
    if (!(await redisClient.exists(key))) return { removed: false };
    const members = await getMembers(w);
    const hostId = await redisClient.hget(key, 'host');
    if (userId === hostId) {
        await redisClient.del(key);
        return { deleted: true };
    }
    const rest = members.filter((m) => m.id !== userId);
    if (!rest.length) {
        await redisClient.del(key);
        return { deleted: true };
    }
    await setMembers(w, rest);
    return { removed: true };
};

/* -------------------------- ゲーム進行 (logic) ----------------------------- */
export const startGame = async (w: string) => {
    const key = getKey(w);
    await redisClient.hset(key, 'status', 'playing');
    const gameState: GameState = {
        currentQuestion: 0,
        usersReady: [],
        answers: {},
        scores: {},
        startTime: null,
        timeLeft: 30,
    };
    await setGameState(w, gameState);
};

export const markUserReady = async (w: string, uid: string): Promise<GameState> => {
    const state = (await getGameState(w))!;
    if (!state.usersReady.includes(uid)) state.usersReady.push(uid);
    await setGameState(w, state);
    return state;
};

export const beginQuestion = async (
    w: string,
    qIndex: number,
    quiz: QuizQuestion[],
) => {
    const state = (await getGameState(w))!;
    state.currentQuestion = qIndex;
    state.startTime = Date.now();
    state.timeLeft = 15;
    await setGameState(w, state);
    return quiz[qIndex];
};

export const submitAnswer = async (
    w: string,
    uid: string,
    answer: number,
    timeLeft: number,
) => {
    const state = (await getGameState(w))!;
    const q = state.currentQuestion;
    if (!state.answers[q]) state.answers[q] = {};
    state.answers[q][uid] = { answer, timeLeft };
    await setGameState(w, state);
    return state;
};

export const finaliseQuestion = async (
    w: string,
    quiz: QuizQuestion[]
): Promise<{ state: GameState; correct: number }> => {

    /* ★ ここで必ず取得 */
    const state = await getGameState(w);

    // --- ① gameState が無ければ即リターン ---
    if (!state) {
        /* 呼び出し元が try/catch するので Error を投げる */
        throw new Error('Game state not found (room may have reset)');
    }

    const q = state.currentQuestion;
    const correct = quiz[q].correctAnswer;
    for (const [uid, info] of Object.entries(state.answers[q] ?? {})) {
        if (!state.scores[uid]) state.scores[uid] = 0;
        if (info.answer === correct) state.scores[uid] += 10;
    }
    await setGameState(w, state);
    return { state, correct };
};

export const endGame = async (w: string) => {
    const key = getKey(w);
    const state = await getGameState(w);
    await redisClient.hset(key, 'status', 'waiting');
    await redisClient.hdel(key, 'gameState');
    return state?.scores ?? {};
};