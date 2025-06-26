import dotenv from 'dotenv';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: envFile });

export const PORT  = Number(process.env.PORT) || 4020;
export const API_URL = process.env.API_URL || 'http://localhost:8000';
export const CLIENT_ORIGINS = [
  process.env.CLIENT_ORIGIN,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
].filter(Boolean) as string[];