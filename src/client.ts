// src/client.ts

import type { RedisLike, RedisConnOpts } from "./transport.js";
import { buildRedisClient, makeScriptLoader } from "./transport.js";

import { defaultScriptsDir, loadScripts } from "./scripts.js";
import { queueBase } from "./helper.js";

import type {
  JobCtx,
  ReserveResult,
  AckFailResult,
  BatchRemoveResult,
  BatchRetryFailedResult,
} from "./types.js";

import { OmniqOps } from "./ops.js";
import { consume as consumeLoop } from "./consumer.js";

export interface OmniqClientOpts extends RedisConnOpts {
  /** Provide an already-created ioredis client (Redis or Cluster). */
  redis?: RedisLike;

  /** Override scripts dir; default is ./src/core/scripts */
  scriptsDir?: string;
}

export class OmniqClient {
  private _ops: OmniqOps;

  private constructor(ops: OmniqOps) {
    this._ops = ops;
  }

  /** Async factory (Node loads scripts async). Mirrors Python constructor behavior. */
  static async create(opts: OmniqClientOpts = {}): Promise<OmniqClient> {
    const r = opts.redis ?? (await buildRedisClient(opts));

    const scriptsDir = opts.scriptsDir ?? defaultScriptsDir();
    const scripts = await loadScripts(makeScriptLoader(r), scriptsDir);

    return new OmniqClient(new OmniqOps(r, scripts));
  }

  static queueBase(queueName: string): string {
    return queueBase(queueName);
  }

  // --- API mirrors Python (async in Node) ---

  async publish(args: {
    queue: string;
    payload: any;
    job_id?: string;
    max_attempts?: number;
    timeout_ms?: number;
    backoff_ms?: number;
    due_ms?: number;
    gid?: string | null;
    group_limit?: number;
    now_ms_override?: number;
  }): Promise<string> {
    return await this._ops.publish(args);
  }

  async reserve(args: { queue: string; now_ms_override?: number }): Promise<ReserveResult> {
    return await this._ops.reserve(args);
  }

  async heartbeat(args: {
    queue: string;
    job_id: string;
    lease_token: string;
    now_ms_override?: number;
  }): Promise<number> {
    return await this._ops.heartbeat(args);
  }

  async ack_success(args: {
    queue: string;
    job_id: string;
    lease_token: string;
    now_ms_override?: number;
  }): Promise<void> {
    await this._ops.ack_success(args);
  }

  async ack_fail(args: {
    queue: string;
    job_id: string;
    lease_token: string;
    error?: string | null;
    now_ms_override?: number;
  }): Promise<AckFailResult> {
    return await this._ops.ack_fail(args);
  }

  async promote_delayed(args: {
    queue: string;
    max_promote?: number;
    now_ms_override?: number;
  }): Promise<number> {
    return await this._ops.promote_delayed(args);
  }

  async reap_expired(args: {
    queue: string;
    max_reap?: number;
    now_ms_override?: number;
  }): Promise<number> {
    return await this._ops.reap_expired(args);
  }

  async pause(args: { queue: string }): Promise<string> {
    return await this._ops.pause(args);
  }

  async resume(args: { queue: string }): Promise<number> {
    return await this._ops.resume(args);
  }

  async is_paused(args: { queue: string }): Promise<boolean> {
    return await this._ops.is_paused(args);
  }

  async retry_failed(args: { queue: string; job_id: string; now_ms_override?: number }): Promise<void> {
    await this._ops.retry_failed(args);
  }

  async retry_failed_batch(args: {
    queue: string;
    job_ids: string[];
    now_ms_override?: number;
  }): Promise<BatchRetryFailedResult> {
    return await this._ops.retry_failed_batch(args);
  }

  async remove_job(args: { queue: string; job_id: string; lane: string }): Promise<string> {
    return await this._ops.remove_job(args);
  }

  async remove_jobs_batch(args: {
    queue: string;
    lane: string;
    job_ids: string[];
  }): Promise<BatchRemoveResult> {
    return await this._ops.remove_jobs_batch(args);
  }

  async childs_init(args: { key: string; expected: number }): Promise<void> {
    await this._ops.childs_init(args);
  }

  async child_ack(args: { key: string; child_id: string }): Promise<number> {
    return await this._ops.child_ack(args);
  }

  /**
   * Consume loop (mirrors Python client.consume).
   * Handler can be sync or async.
   */
  async consume(args: {
    queue: string;
    handler: (ctx: JobCtx) => void | Promise<void>;

    poll_interval_s?: number;

    promote_interval_s?: number;
    promote_batch?: number;

    reap_interval_s?: number;
    reap_batch?: number;

    heartbeat_interval_s?: number | null;

    verbose?: boolean;
    logger?: (msg: string) => void;

    drain?: boolean;
    stop_on_ctrl_c?: boolean;
  }): Promise<void> {
    const {
      queue,
      handler,
      poll_interval_s = 0.05,
      promote_interval_s = 1.0,
      promote_batch = 1000,
      reap_interval_s = 1.0,
      reap_batch = 1000,
      heartbeat_interval_s = null,
      verbose = false,
      logger = console.log,
      drain = true,
      stop_on_ctrl_c = true,
    } = args;

    return await consumeLoop({
      ops: this._ops,
      queue,
      handler,
      poll_interval_s,
      promote_interval_s,
      promote_batch,
      reap_interval_s,
      reap_batch,
      heartbeat_interval_s,
      verbose,
      logger,
      drain,
      stop_on_ctrl_c,
    });
  }

  /** Expose ops like Python */
  get ops(): OmniqOps {
    return this._ops;
  }

  async close(): Promise<void> {
    await this._ops.r.quit();
  }
}
