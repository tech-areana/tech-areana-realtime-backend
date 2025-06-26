import cors, { CorsOptions } from 'cors';
import { CLIENT_ORIGINS } from './env';

export const corsOptions: CorsOptions = {
  origin: CLIENT_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST'],
};

export const corsMiddleware = cors(corsOptions);