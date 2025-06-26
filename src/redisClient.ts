import 'dotenv/config';

const useLocal = process.env.LOCAL_REDIS === 'true';

/* -------------------- ローカル Redis ----------------------------------- */
import { createClient as createNodeClient } from 'redis';

/* -------------------- Upstash ----------------------------------------- */
import { Redis as UpstashRedis } from '@upstash/redis';

type ZMember = { score: number; member: string };

// 共通インタフェース
interface RedisLike {
  /* Hash */
  hset(key: string, field: string | Record<string, unknown>, v?: string): any;
  hget(key: string, field: string): Promise<any>;
  hgetall(key: string): Promise<any>;
  hdel(key: string, field: string): any;
  /* Key */
  exists(key: string): any;
  del(key: string): any;
  /* ZSet */
  zadd(key: string, m: ZMember): any;
  zincrby(key: string, inc: number, member: string): any;
}

/* ========================= 実装を選択 ========================= */
let raw: RedisLike;

if (useLocal) {
  /* ---------- Node-Redis v4 client ---------- */
  const node = createNodeClient({
    socket: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT) || 6379,
    },
    password: process.env.REDIS_PASSWORD || undefined,
  });
  node.on('error', (e) => console.error('❌ Redis', e));
  node.connect(); // async

  raw = {
    /* Hash */
    async hset(k, f: any, v?: any) {
      if (typeof f === 'object') return node.hSet(k, f);
      return node.hSet(k, f as string, v ?? '');
    },
    hget: (k, f) => node.hGet(k, f),
    hgetall: (k) => node.hGetAll(k),
    hdel: (k, f) => node.hDel(k, f),
    /* Key */
    exists: (k) => node.exists(k),
    del: (k) => node.del(k),
    /* ZSet */
    zadd: (k, { score, member }) => node.zAdd(k, { score, value: member }),
    zincrby: (k, inc, m) => node.zIncrBy(k, inc, m),
  };
  console.log('🔗 redisClient: LOCAL');
} else {
  /* ---------- Upstash REST ---------- */
  const up = new UpstashRedis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });

  const toStr = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? ''));

  raw = {
    /* Hash */
    hset: (k, f: any, v?: any) =>
      typeof f === 'object' ? up.hset(k, f) : up.hset(k, { [f]: v }),
    hget: async (k, f) => toStr(await up.hget(k, f)),
    hgetall: async (k) => {
      const d = await up.hgetall(k);
      const o: any = {};
      for (const key in d) o[key] = toStr((d as any)[key]);
      return o;
    },
    hdel: (k, f) => up.hdel(k, f),
    /* Key */
    exists: async (k) => {
      try {
        return await up.exists(k);
      } catch (e: any) {
        if (e?.message?.includes('Function not implemented')) {
          const d = await up.hgetall(k);
          return d && Object.keys(d).length ? 1 : 0;
        }
        throw e;
      }
    },
    del: (k) => up.del(k),
    /* ZSet */
    zadd: (k, { score, member }) => up.zadd(k, { score, member }),
    zincrby: (k, inc, m) => up.zincrby(k, inc, m),
  };
  console.log('🔗 redisClient: UPSTASH');
}

/* --------------- エクスポート --------------- */
const redisClient = raw;
export { redisClient };
export default redisClient;
