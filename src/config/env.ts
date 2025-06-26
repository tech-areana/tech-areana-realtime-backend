export const PORT = Number(process.env.LOCAL_PORT) || 4020;
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:3000';
export const API_URL        = process.env.API_URL        ?? 'http://localhost:8000';
export const LOCAL_REDIS    = process.env.LOCAL_REDIS === 'true';
