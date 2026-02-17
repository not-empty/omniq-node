// src/transport.ts

import * as IORedisNS from "ioredis";
import type { Redis as RedisClient, Cluster as ClusterClient } from "ioredis";

export type RedisArg = string | number | Buffer;

/**
 * Constructable constructor reference across ESM/CJS builds.
 * - In some setups: import * as ns => ns.default is the ctor
 * - In others: ns itself is the ctor
 */
const RedisCtor: any = (IORedisNS as any).default ?? (IORedisNS as any);

export type RedisLike = RedisClient | ClusterClient;

export interface RedisConnOpts {
  redis_url?: string;
  host?: string;
  port?: number;
  db?: number;
  username?: string;
  password?: string;
  ssl?: boolean;

  // ioredis uses milliseconds for timeouts
  socket_timeout_ms?: number;
  socket_connect_timeout_ms?: number;

  cluster?: boolean;
  cluster_nodes?: Array<{ host: string; port: number }>;
}

function looksLikeClusterError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? "").toLowerCase();
  return (
    msg.includes("cluster support disabled") ||
    msg.includes("cluster mode is not enabled") ||
    (msg.includes("unknown command") && msg.includes("cluster")) ||
    msg.includes("this instance has cluster support disabled") ||
    msg.includes("only (p)subscribe") ||
    msg.includes("moved") ||
    msg.includes("ask")
  );
}

export async function buildRedisClient(opts: RedisConnOpts): Promise<RedisLike> {
  const {
    redis_url,
    host,
    port = 6379,
    db = 0,
    username,
    password,
    ssl = false,
    socket_timeout_ms,
    socket_connect_timeout_ms,
    cluster = false,
    cluster_nodes,
  } = opts;

  const tls = ssl ? {} : undefined;

  // URL => standalone
  if (redis_url && !cluster) {
    const r: RedisClient = new RedisCtor(redis_url, {
      connectTimeout: socket_connect_timeout_ms,
      commandTimeout: socket_timeout_ms,
    });
    return r;
  }

  if (!host && !cluster_nodes?.length) {
    throw new Error("RedisConnOpts requires host (or redis_url / cluster_nodes)");
  }

  // Cluster mode (best-effort)
  if (cluster) {
    const seeds =
      cluster_nodes && cluster_nodes.length > 0
        ? cluster_nodes
        : [{ host: host as string, port: Number(port) }];

    const c: ClusterClient = new RedisCtor.Cluster(seeds, {
      redisOptions: {
        username,
        password,
        tls,
        connectTimeout: socket_connect_timeout_ms,
        commandTimeout: socket_timeout_ms,
      },
    });

    try {
      await c.ping();
      return c;
    } catch (e) {
      if (!looksLikeClusterError(e)) throw e;
      try {
        await c.quit();
      } catch {}
      // fall through to standalone
    }
  }

  // Standalone host/port
  const r: RedisClient = new RedisCtor({
    host,
    port,
    db,
    username,
    password,
    tls,
    connectTimeout: socket_connect_timeout_ms,
    commandTimeout: socket_timeout_ms,
  });

  return r;
}

/**
 * Adapter used by scripts.ts (mirrors Python r.script_load()).
 */
export function makeScriptLoader(r: RedisLike): { scriptLoad(script: string): Promise<string> } {
  return {
    async scriptLoad(script: string): Promise<string> {
      return (await (r as any).script("load", script)) as string;
    },
  };
}
