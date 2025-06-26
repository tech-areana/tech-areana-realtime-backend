import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { corsMiddleware, corsOptions } from './config/cors';
import { PORT } from './config/env';
import { registerSocketHandlers } from './socket';
import './redisClient'; // Ensure Redis client is initialized

const app = express();
app.use(corsMiddleware);

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: corsOptions,
});

registerSocketHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});