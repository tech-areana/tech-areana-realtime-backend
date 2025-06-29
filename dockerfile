# ---------- 1) build stage ----------
FROM node:20-alpine AS build
WORKDIR /app

# package.json / lock を先にコピーして layer を分ける
COPY package*.json ./
RUN npm ci                      # devDeps も必要なので本番でもインストール

# 残りのソース
COPY . .
RUN npm run build               # tsc → dist

# ---------- 2) runtime stage ----------
FROM node:20-alpine
WORKDIR /app

# 本番では devDependencies を落として軽量化
COPY package*.json ./
RUN npm ci --omit=dev

# ビルド成果物だけコピー
COPY --from=build /app/build ./build

# Render が割り当てるポート番号を受け取る
ENV PORT=$PORT
EXPOSE $PORT

CMD ["node", "build/server.js"]

