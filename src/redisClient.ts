import { Redis } from "@upstash/redis";
import "dotenv/config";

/* ----------------------------- Upstash 接続 ----------------------------- */
const rest = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL as string,
  token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
});

/* 文字列化ヘルパ */
const toStr = (v: unknown): string =>
  typeof v === "string" ? v : JSON.stringify(v ?? "");

/* Sorted-Set 用型 */
interface ZMember {
  score: number;
  member: string;
}

/* ----------------------------- ラッパ API ----------------------------- */
const redisClient = {
  /* ---------- HASH ---------- */
  hset: async (
    key: string,
    field: string | Record<string, unknown>,
    value?: string,
  ) => {
    if (typeof field === "object") return rest.hset(key, field);
    return rest.hset(key, { [field]: value });
  },
  hget: async (key: string, field: string): Promise<string> =>
    toStr(await rest.hget(key, field)),
  hgetall: async (key: string): Promise<Record<string, string>> => {
    const data = await rest.hgetall(key);
    const obj: Record<string, string> = {};
    for (const k in data) obj[k] = toStr((data as any)[k]);
    return obj;
  },
  hdel: (key: string, field: string) => rest.hdel(key, field),

  /* ---------- KEY ---------- */
  exists: (key: string) => rest.exists(key),
  del: (key: string) => rest.del(key),

  /* ---------- SORTED SET ---------- */
  zadd: (key: string, { score, member }: ZMember) =>
    rest.zadd(key, { score, member }),
  zincrby: (key: string, increment: number, member: string) =>
    rest.zincrby(key, increment, member),
};

export default redisClient;
export { redisClient };
  