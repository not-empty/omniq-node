// src/ops.ts
import type { RedisLike } from "./transport.js";
import type {
  AckFailResult,
  BatchRemoveResult,
  BatchRetryFailedResult,
  ReservePaused,
  ReserveJob,
  ReserveResult,
} from "./types.js";
import type { OmniqScripts } from "./scripts.js";

import { nowMs } from "./clock.js";
import { newUlid } from "./ids.js";
import { queueAnchor, queueBase, childsAnchor } from "./helper.js";

/**
 * Minimal async mutex for NOSCRIPT fallback.
 * We only need to serialize "EVAL" retries to avoid thundering-herd.
 */
class AsyncMutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  async lock(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.unlock();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.locked = true;
    return () => this.unlock();
  }

  private unlock() {
    const next = this.waiters.shift();
    if (next) next();
    else this.locked = false;
  }
}

function isNoScriptError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as any;
  // ioredis: ReplyError with message like "NOSCRIPT No matching script. Please use EVAL."
  const msg = String(anyErr?.message ?? "");
  return msg.toUpperCase().includes("NOSCRIPT");
}

export class OmniqOps {
  private static _scriptMutex = new AsyncMutex();

  constructor(
    public readonly r: RedisLike,
    public readonly scripts: OmniqScripts,
  ) {}

  private async evalshaWithNoScriptFallback(
    sha: string,
    src: string,
    numkeys: number,
    ...keysAndArgs: Array<string>
  ): Promise<any> {
    try {
      // ioredis: evalsha(sha, numkeys, ...args)
      return await (this.r as any).evalsha(sha, numkeys, ...keysAndArgs);
    } catch (err) {
      if (!isNoScriptError(err)) throw err;

      const release = await OmniqOps._scriptMutex.lock();
      try {
        // Fallback to EVAL to re-introduce script to cache
        return await (this.r as any).eval(src, numkeys, ...keysAndArgs);
      } finally {
        release();
      }
    }
  }

  async publish(args: {
    queue: string;
    payload: any;
    job_id?: string;
    max_attempts?: number;
    timeout_ms?: number;
    backoff_ms?: number;
    due_ms?: number;
    now_ms_override?: number;
    gid?: string | null;
    group_limit?: number;
  }): Promise<string> {
    const {
      queue,
      payload,
      job_id,
      max_attempts = 3,
      timeout_ms = 30_000,
      backoff_ms = 5_000,
      due_ms = 0,
      now_ms_override = 0,
      gid = null,
      group_limit = 0,
    } = args;

    const isObject =
      payload !== null && typeof payload === "object" && !Array.isArray(payload);
    const isArray = Array.isArray(payload);

    if (!isObject && !isArray) {
      throw new TypeError(
        "publish(payload=...) must be an object or array (structured JSON). " +
          "Wrap strings as {text: '...'} or {value: '...'}."
      );
    }

    const anchor = queueAnchor(queue);
    const nms = now_ms_override || nowMs();
    const jid = job_id || newUlid();

    const payload_s = JSON.stringify(payload);

    const gid_s = String(gid ?? "").trim();
    const glimit_s = group_limit && group_limit > 0 ? String(Math.trunc(group_limit)) : "0";

    const argv = [
      jid,
      payload_s,
      String(Math.trunc(max_attempts)),
      String(Math.trunc(timeout_ms)),
      String(Math.trunc(backoff_ms)),
      String(Math.trunc(nms)),
      String(Math.trunc(due_ms)),
      gid_s,
      glimit_s,
    ];

    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.enqueue.sha,
      this.scripts.enqueue.src,
      1,
      anchor,
      ...argv
    );

    if (!Array.isArray(res) || res.length < 2) {
      throw new Error(`Unexpected ENQUEUE response: ${String(res)}`);
    }

    const status = String(res[0]);
    const out_id = String(res[1]);

    if (status !== "OK") {
      throw new Error(`ENQUEUE failed: ${status}`);
    }

    return out_id;
  }

  async pause(args: { queue: string }): Promise<string> {
    const anchor = queueAnchor(args.queue);
    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.pause.sha,
      this.scripts.pause.src,
      1,
      anchor
    );
    return String(res);
  }

  async resume(args: { queue: string }): Promise<number> {
    const anchor = queueAnchor(args.queue);
    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.resume.sha,
      this.scripts.resume.src,
      1,
      anchor
    );
    const n = Number(res);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }

  async is_paused(args: { queue: string }): Promise<boolean> {
    const base = queueBase(args.queue);
    const n = await (this.r as any).exists(`${base}:paused`);
    return Number(n) === 1;
  }

  async reserve(args: { queue: string; now_ms_override?: number }): Promise<ReserveResult> {
    const { queue, now_ms_override = 0 } = args;

    const anchor = queueAnchor(queue);
    const nms = now_ms_override || nowMs();

    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.reserve.sha,
      this.scripts.reserve.src,
      1,
      anchor,
      String(Math.trunc(nms))
    );

    if (!Array.isArray(res) || res.length < 1) {
      throw new Error(`Unexpected RESERVE response: ${String(res)}`);
    }

    if (res[0] === "EMPTY") {
      return null;
    }

    if (res[0] === "PAUSED") {
      const paused: ReservePaused = { status: "PAUSED" };
      return paused;
    }

    if (res[0] !== "JOB" || res.length < 7) {
      throw new Error(`Unexpected RESERVE response: ${JSON.stringify(res)}`);
    }

    const job: ReserveJob = {
      status: "JOB",
      job_id: String(res[1]),
      payload: String(res[2]),
      lock_until_ms: Number(res[3]) | 0,
      attempt: Number(res[4]) | 0,
      gid: String(res[5] ?? ""),
      lease_token: String(res[6] ?? ""),
    };

    return job;
  }

  async heartbeat(args: {
    queue: string;
    job_id: string;
    lease_token: string;
    now_ms_override?: number;
  }): Promise<number> {
    const { queue, job_id, lease_token, now_ms_override = 0 } = args;

    const anchor = queueAnchor(queue);
    const nms = now_ms_override || nowMs();

    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.heartbeat.sha,
      this.scripts.heartbeat.src,
      1,
      anchor,
      job_id,
      String(Math.trunc(nms)),
      lease_token
    );

    if (!Array.isArray(res) || res.length < 1) {
      throw new Error(`Unexpected HEARTBEAT response: ${String(res)}`);
    }

    if (res[0] === "OK") {
      return Number(res[1]) | 0;
    }

    if (res[0] === "ERR") {
      const reason = res.length > 1 ? String(res[1]) : "UNKNOWN";
      throw new Error(`HEARTBEAT failed: ${reason}`);
    }

    throw new Error(`Unexpected HEARTBEAT response: ${JSON.stringify(res)}`);
  }

  async ack_success(args: {
    queue: string;
    job_id: string;
    lease_token: string;
    now_ms_override?: number;
  }): Promise<void> {
    const { queue, job_id, lease_token, now_ms_override = 0 } = args;

    const anchor = queueAnchor(queue);
    const nms = now_ms_override || nowMs();

    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.ack_success.sha,
      this.scripts.ack_success.src,
      1,
      anchor,
      job_id,
      String(Math.trunc(nms)),
      lease_token
    );

    if (!Array.isArray(res) || res.length < 1) {
      throw new Error(`Unexpected ACK_SUCCESS response: ${String(res)}`);
    }

    if (res[0] === "OK") return;

    if (res[0] === "ERR") {
      const reason = res.length > 1 ? String(res[1]) : "UNKNOWN";
      throw new Error(`ACK_SUCCESS failed: ${reason}`);
    }

    throw new Error(`Unexpected ACK_SUCCESS response: ${JSON.stringify(res)}`);
  }

  async ack_fail(args: {
    queue: string;
    job_id: string;
    lease_token: string;
    error?: string | null;
    now_ms_override?: number;
  }): Promise<AckFailResult> {
    const { queue, job_id, lease_token, error = null, now_ms_override = 0 } = args;

    const anchor = queueAnchor(queue);
    const nms = now_ms_override || nowMs();

    let res: any;
    if (error == null || String(error).trim() === "") {
      res = await this.evalshaWithNoScriptFallback(
        this.scripts.ack_fail.sha,
        this.scripts.ack_fail.src,
        1,
        anchor,
        job_id,
        String(Math.trunc(nms)),
        lease_token
      );
    } else {
      res = await this.evalshaWithNoScriptFallback(
        this.scripts.ack_fail.sha,
        this.scripts.ack_fail.src,
        1,
        anchor,
        job_id,
        String(Math.trunc(nms)),
        lease_token,
        String(error)
      );
    }

    if (!Array.isArray(res) || res.length < 1) {
      throw new Error(`Unexpected ACK_FAIL response: ${String(res)}`);
    }

    if (res[0] === "RETRY") {
      // Python returns ("RETRY", int(res[1]))
      return ["RETRY", Number(res[1]) | 0];
    }

    if (res[0] === "FAILED") {
      // Python returns ("FAILED", None)
      return ["FAILED", null];
    }

    if (res[0] === "ERR") {
      const reason = res.length > 1 ? String(res[1]) : "UNKNOWN";
      throw new Error(`ACK_FAIL failed: ${reason}`);
    }

    throw new Error(`Unexpected ACK_FAIL response: ${JSON.stringify(res)}`);
  }

  async promote_delayed(args: {
    queue: string;
    max_promote?: number;
    now_ms_override?: number;
  }): Promise<number> {
    const { queue, max_promote = 1000, now_ms_override = 0 } = args;

    const anchor = queueAnchor(queue);
    const nms = now_ms_override || nowMs();

    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.promote_delayed.sha,
      this.scripts.promote_delayed.src,
      1,
      anchor,
      String(Math.trunc(nms)),
      String(Math.trunc(max_promote))
    );

    if (!Array.isArray(res) || res.length < 2 || res[0] !== "OK") {
      throw new Error(`Unexpected PROMOTE_DELAYED response: ${JSON.stringify(res)}`);
    }

    return Number(res[1]) | 0;
  }

  async reap_expired(args: {
    queue: string;
    max_reap?: number;
    now_ms_override?: number;
  }): Promise<number> {
    const { queue, max_reap = 1000, now_ms_override = 0 } = args;

    const anchor = queueAnchor(queue);
    const nms = now_ms_override || nowMs();

    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.reap_expired.sha,
      this.scripts.reap_expired.src,
      1,
      anchor,
      String(Math.trunc(nms)),
      String(Math.trunc(max_reap))
    );

    if (!Array.isArray(res) || res.length < 2 || res[0] !== "OK") {
      throw new Error(`Unexpected REAP_EXPIRED response: ${JSON.stringify(res)}`);
    }

    return Number(res[1]) | 0;
  }

  async job_timeout_ms(args: {
    queue: string;
    job_id: string;
    default_ms?: number;
  }): Promise<number> {
    const { queue, job_id, default_ms = 60_000 } = args;

    const base = queueBase(queue);
    const k_job = `${base}:job:${job_id}`;
    const v = await (this.r as any).hget(k_job, "timeout_ms");

    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : Math.trunc(default_ms);
  }

  async retry_failed(args: {
    queue: string;
    job_id: string;
    now_ms_override?: number;
  }): Promise<void> {
    const { queue, job_id, now_ms_override = 0 } = args;

    const anchor = queueAnchor(queue);
    const nms = now_ms_override || nowMs();

    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.retry_failed.sha,
      this.scripts.retry_failed.src,
      1,
      anchor,
      job_id,
      String(Math.trunc(nms))
    );

    if (!Array.isArray(res) || res.length < 1) {
      throw new Error(`Unexpected RETRY_FAILED response: ${String(res)}`);
    }

    if (res[0] === "OK") return;

    if (res[0] === "ERR") {
      const reason = res.length > 1 ? String(res[1]) : "UNKNOWN";
      throw new Error(`RETRY_FAILED failed: ${reason}`);
    }

    throw new Error(`Unexpected RETRY_FAILED response: ${JSON.stringify(res)}`);
  }

  async retry_failed_batch(args: {
    queue: string;
    job_ids: string[];
    now_ms_override?: number;
  }): Promise<BatchRetryFailedResult> {
    const { queue, job_ids, now_ms_override = 0 } = args;

    if (job_ids.length > 100) {
      throw new Error("retry_failed_batch max is 100 job_ids per call");
    }

    const anchor = queueAnchor(queue);
    const nms = now_ms_override || nowMs();

    const argv: string[] = [String(Math.trunc(nms)), String(job_ids.length), ...job_ids];

    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.retry_failed_batch.sha,
      this.scripts.retry_failed_batch.src,
      1,
      anchor,
      ...argv
    );

    if (!Array.isArray(res)) {
      throw new Error(`Unexpected RETRY_FAILED_BATCH response: ${String(res)}`);
    }

    if (res.length >= 2 && String(res[0]) === "ERR") {
      const reason = String(res[1]);
      const extra = res.length > 2 ? String(res[2]) : "";
      throw new Error(`RETRY_FAILED_BATCH failed: ${reason} ${extra}`.trim());
    }

    const out: BatchRetryFailedResult = [];
    let i = 0;
    while (i < res.length) {
      const job_id = String(res[i] ?? "");
      const status = String(res[i + 1] ?? "");
      let reason: string | null = null;

      if (status === "ERR") {
        reason = String(res[i + 2] ?? "UNKNOWN");
        i += 3;
      } else {
        i += 2;
      }
      out.push([job_id, status, reason]);
    }

    return out;
  }

  async remove_job(args: {
    queue: string;
    job_id: string;
    lane: string;
  }): Promise<string> {
    const { queue, job_id, lane } = args;

    const anchor = queueAnchor(queue);

    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.remove_job.sha,
      this.scripts.remove_job.src,
      1,
      anchor,
      job_id,
      lane
    );

    if (!Array.isArray(res) || res.length < 1) {
      throw new Error(`Unexpected REMOVE_JOB response: ${String(res)}`);
    }

    if (res[0] === "OK") return String(res[0] ?? "");

    if (res[0] === "ERR") {
      const reason = res.length > 1 ? String(res[1]) : "UNKNOWN";
      throw new Error(`REMOVE_JOB failed: ${reason}`);
    }

    throw new Error(`Unexpected REMOVE_JOB response: ${JSON.stringify(res)}`);
  }

  async remove_jobs_batch(args: {
    queue: string;
    lane: string;
    job_ids: string[];
  }): Promise<BatchRemoveResult> {
    const { queue, lane, job_ids } = args;

    if (job_ids.length > 100) {
      throw new Error("remove_jobs_batch max is 100 job_ids per call");
    }

    const anchor = queueAnchor(queue);

    const argv: string[] = [String(lane), String(job_ids.length), ...job_ids];

    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.remove_jobs_batch.sha,
      this.scripts.remove_jobs_batch.src,
      1,
      anchor,
      ...argv
    );

    if (!Array.isArray(res)) {
      throw new Error(`Unexpected REMOVE_JOBS_BATCH response: ${String(res)}`);
    }

    if (res.length >= 2 && String(res[0]) === "ERR") {
      const reason = String(res[1]);
      const extra = res.length > 2 ? String(res[2]) : "";
      throw new Error(`REMOVE_JOBS_BATCH failed: ${reason} ${extra}`.trim());
    }

    const out: BatchRemoveResult = [];
    let i = 0;
    while (i < res.length) {
      const job_id = String(res[i] ?? "");
      const status = String(res[i + 1] ?? "");
      let reason: string | null = null;

      if (status === "ERR") {
        reason = String(res[i + 2] ?? "UNKNOWN");
        i += 3;
      } else {
        i += 2;
      }
      out.push([job_id, status, reason]);
    }

    return out;
  }

  async childs_init(args: { key: string; expected: number }): Promise<void> {
    const { key, expected } = args;
    const anchor = childsAnchor(key);

    const res = await this.evalshaWithNoScriptFallback(
      this.scripts.childs_init.sha,
      this.scripts.childs_init.src,
      1,
      anchor,
      String(Math.trunc(expected))
    );

    if (!Array.isArray(res) || res.length < 1) {
      throw new Error(`Unexpected CHILDS_INIT response: ${String(res)}`);
    }

    if (res[0] === "OK") return;

    if (res[0] === "ERR") {
      const reason = res.length > 1 ? String(res[1]) : "UNKNOWN";
      throw new Error(`CHILDS_INIT failed: ${reason}`);
    }

    throw new Error(`Unexpected CHILDS_INIT response: ${JSON.stringify(res)}`);
  }

  async child_ack(args: { key: string; child_id: string }): Promise<number> {
    const { key, child_id } = args;
    const anchor = childsAnchor(key);

    const cid = String(child_id ?? "").trim();
    if (!cid) throw new Error("child_ack child_id is required");

    try {
      const res = await this.evalshaWithNoScriptFallback(
        this.scripts.child_ack.sha,
        this.scripts.child_ack.src,
        1,
        anchor,
        cid
      );

      if (!Array.isArray(res) || res.length < 1) return -1;

      if (res[0] === "OK") {
        if (res.length < 2) return -1;
        const n = Number(res[1]);
        return Number.isFinite(n) ? Math.trunc(n) : -1;
      }

      return -1;
    } catch {
      return -1;
    }
  }

  static paused_backoff_s(poll_interval_s: number): number {
    return Math.max(0.25, Number(poll_interval_s) * 10.0);
  }

  static derive_heartbeat_interval_s(timeout_ms: number): number {
    const half = Math.max(1.0, (Number(timeout_ms) / 1000.0) / 2.0);
    return Math.max(1.0, Math.min(10.0, half));
  }
}
