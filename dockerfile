# socket.io-back/Dockerfile
FROM node:20-alpine

# 1) workdir をプロジェクト直下に
WORKDIR /app

# 2) 依存だけ先にコピー＆install
COPY package*.json ./
RUN npm ci


# 3) dev サーバーを起動
CMD ["npm", "run", "dev"]
