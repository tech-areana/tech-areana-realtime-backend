import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { corsMiddleware, corsOptions } from './config/cors';
import { PORT as LOCAL_PORT } from './config/env';
import { registerSocketHandlers } from './socket';
import './redisClient'; // Redis クライアント初期化だけで副作用 OK

const app = express();
app.use(corsMiddleware);

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, { cors: corsOptions });

registerSocketHandlers(io);

/** Render では PORT=10000 が渡ってくる。ローカルは .env の 4020 など */
const PORT = Number(process.env.PORT) || LOCAL_PORT || 4020;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
