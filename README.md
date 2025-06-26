
# README

## envファイルの作成
.envファイルの作成

## ビルド方法(初回のみ)
```bash
docker compose build
```

## 起動方法
```bash
docker compose up -d
```

## 停止方法
```bash
docker compose down
```

## ログ確認
```bash
##バックエンド
docker compose logs -f dev-backend 

##redis
docker compose logs -f dev-redis

# Redis コンテナに入る
docker exec -it dev-redis sh

# 例: キー一覧を確認
redis-cli keys '*'

#特定のキーの値を確認
redis-cli --raw HGETALL '<キー名>'

```

