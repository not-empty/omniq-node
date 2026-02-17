// src/consumer.ts

import { Exec } from "./exec.js";

import { OmniqOps } from "./ops.js";
import type { JobCtx, ReserveJob, ReserveResult } from "./types.js";

export interface StopController {
  stop: boolean;
  sigint_count: number;
}

export interface HeartbeatHandle {
  stop: () => void;
  flags: { lost: boolean };
  done: Promise<void>;
}

/**
 * Start a background heartbeater using setInterval (Node style).
 * Mirrors Python behavior:
 * - do one immediate heartbeat
 * - if NOT_ACTIVE or TOKEN_MISMATCH => mark lost and stop
 */
export function startHeartbeater(args: {
  ops: OmniqOps;
  queue: string;
  job_id: string;
  lease_token: string;
  interval_s: number;
}): HeartbeatHandle {
  const { ops, queue, job_id, lease_token, interval_s } = args;

  let stopped = false;
  const flags = { lost: false };

  let timer: NodeJS.Timeout | null = null;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    resolveDone();
  };

  const checkLost = (e: unknown) => {
    const msg = String((e as any)?.message ?? e ?? "");
    if (msg.includes("NOT_ACTIVE") || msg.includes("TOKEN_MISMATCH")) {
      flags.lost = true;
      stop();
      return true;
    }
    return false;
  };

  // immediate first heartbeat (async)
  (async () => {
    try {
      await ops.heartbeat({ queue, job_id, lease_token });
    } catch (e) {
      if (checkLost(e)) return;
      // ignore other errors (same as Python: it only stops on NOT_ACTIVE/TOKEN_MISMATCH)
    }

    // schedule periodic heartbeats
    if (stopped) return;
    const intervalMs = Math.max(1, Math.floor(interval_s * 1000));

    timer = setInterval(async () => {
      if (stopped) return;
      try {
        await ops.heartbeat({ queue, job_id, lease_token });
      } catch (e) {
        if (checkLost(e)) return;
        // ignore other errors
      }
    }, intervalMs);
  })().catch(() => {
    // ignore
  });

  return { stop, flags, done };
}

function safeLog(logger: (msg: string) => void, msg: string): void {
  try {
    logger(msg);
  } catch {
    // ignore
  }
}

function payloadPreview(payload: any, maxLen = 300): string {
  let s: string;
  try {
    s = typeof payload === "string" ? payload : JSON.stringify(payload);
  } catch {
    s = String(payload);
  }
  if (s.length > maxLen) return s.slice(0, maxLen) + "…";
  return s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isReservePaused(res: ReserveResult): boolean {
  return !!res && (res as any).status === "PAUSED";
}

function isReserveJob(res: ReserveResult): res is ReserveJob {
  return !!res && (res as any).status === "JOB";
}

/**
 * Node port of Python consume().
 * Differences:
 * - everything is async
 * - signal handling uses process.on()
 * - handler may be sync or async
 */
export async function consume(args: {
  ops: OmniqOps;
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

  stop_on_ctrl_c?: boolean;
  drain?: boolean;
}): Promise<void> {
  const {
    ops,
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

    stop_on_ctrl_c = true,
    drain = true,
  } = args;

  let lastPromote = 0;
  let lastReap = 0;

  const ctrl: StopController = { stop: false, sigint_count: 0 };

  // signal handling (best-effort)
  const onSigterm = () => {
    ctrl.stop = true;
    if (verbose) safeLog(logger, `[consume] SIGTERM received; stopping... queue=${queue}`);
  };

  const onSigint = () => {
    ctrl.sigint_count += 1;

    if (drain) {
      if (ctrl.sigint_count >= 2) {
        if (verbose) safeLog(logger, `[consume] SIGINT x2; hard exit now. queue=${queue}`);
        // mimic Python KeyboardInterrupt immediate
        process.exit(130);
        return;
      }
      ctrl.stop = true;
      if (verbose) safeLog(logger, `[consume] Ctrl+C received; draining current job then exiting. queue=${queue}`);
    } else {
      // If not draining, we just request stop and will exit ASAP.
      ctrl.stop = true;
      if (verbose) safeLog(logger, `[consume] Ctrl+C received; stopping... queue=${queue}`);
    }
  };

  if (stop_on_ctrl_c) {
    process.on("SIGTERM", onSigterm);
    process.on("SIGINT", onSigint);
  }

  try {
    while (true) {
      if (ctrl.stop) {
        if (verbose) safeLog(logger, `[consume] stop requested; exiting (idle). queue=${queue}`);
        return;
      }

      const nowMs = Date.now();

      if (nowMs - lastPromote >= promote_interval_s * 1000) {
        try {
          await ops.promote_delayed({ queue, max_promote: promote_batch });
        } catch {
          // ignore
        }
        lastPromote = nowMs;
      }

      if (nowMs - lastReap >= reap_interval_s * 1000) {
        try {
          await ops.reap_expired({ queue, max_reap: reap_batch });
        } catch {
          // ignore
        }
        lastReap = nowMs;
      }

      let res: ReserveResult;
      try {
        res = await ops.reserve({ queue });
      } catch (e) {
        if (verbose) safeLog(logger, `[consume] reserve error: ${String((e as any)?.message ?? e)}`);
        await sleep(200);
        continue;
      }

      if (res === null) {
        await sleep(Math.max(1, Math.floor(poll_interval_s * 1000)));
        continue;
      }

      if (isReservePaused(res)) {
        const backoff = OmniqOps.paused_backoff_s(poll_interval_s);
        await sleep(Math.max(1, Math.floor(backoff * 1000)));
        continue;
      }

      if (!isReserveJob(res)) {
        // defensive; should not happen
        await sleep(200);
        continue;
      }

      if (!res.lease_token) {
        if (verbose) safeLog(logger, `[consume] invalid reserve (missing lease_token) job_id=${res.job_id}`);
        await sleep(200);
        continue;
      }

      if (ctrl.stop && !drain) {
        if (verbose) safeLog(logger, `[consume] stop requested; fast-exit after reserve job_id=${res.job_id}`);
        return;
      }

      // parse payload
      let payloadObj: any;
      try {
        payloadObj = JSON.parse(res.payload);
      } catch {
        payloadObj = res.payload;
      }

      const exec = new Exec({ ops, default_child_id: res.job_id });

      const ctx: JobCtx = {
        queue,
        job_id: res.job_id,
        payload_raw: res.payload,
        payload: payloadObj,
        attempt: res.attempt,
        lock_until_ms: res.lock_until_ms,
        lease_token: res.lease_token,
        gid: res.gid,
        exec,
      };

      if (verbose) {
        const pv = payloadPreview(ctx.payload);
        const gid_s = ctx.gid && ctx.gid.length ? ctx.gid : "-";
        safeLog(logger, `[consume] received job_id=${ctx.job_id} attempt=${ctx.attempt} gid=${gid_s} payload=${pv}`);
      }

      // heartbeat interval
      let hb_s: number;
      if (heartbeat_interval_s !== null && heartbeat_interval_s !== undefined) {
        hb_s = Number(heartbeat_interval_s);
      } else {
        const timeoutMs = await ops.job_timeout_ms({ queue, job_id: res.job_id });
        hb_s = OmniqOps.derive_heartbeat_interval_s(timeoutMs);
      }

      const hb = startHeartbeater({
        ops,
        queue,
        job_id: res.job_id,
        lease_token: res.lease_token,
        interval_s: hb_s,
      });

      try {
        await handler(ctx);

        hb.stop();

        if (!hb.flags.lost) {
          try {
            await ops.ack_success({ queue, job_id: res.job_id, lease_token: res.lease_token });
            if (verbose) safeLog(logger, `[consume] ack success job_id=${ctx.job_id}`);
          } catch (e) {
            if (verbose) safeLog(logger, `[consume] ack success error job_id=${ctx.job_id}: ${String((e as any)?.message ?? e)}`);
          }
        }
      } catch (e) {
        hb.stop();

        if (!hb.flags.lost) {
          try {
            const errMsg = `${(e as any)?.name ?? "Error"}: ${String((e as any)?.message ?? e)}`;
            const result = await ops.ack_fail({
              queue,
              job_id: res.job_id,
              lease_token: res.lease_token,
              error: errMsg,
            });

            if (verbose) {
              if (result[0] === "RETRY") {
                safeLog(logger, `[consume] ack fail job_id=${ctx.job_id} => RETRY due_ms=${result[1]}`);
              } else {
                safeLog(logger, `[consume] ack fail job_id=${ctx.job_id} => FAILED`);
              }
              safeLog(logger, `[consume] error job_id=${ctx.job_id} => ${errMsg}`);
            }
          } catch (e2) {
            if (verbose) {
              safeLog(
                logger,
                `[consume] ack fail error job_id=${ctx.job_id}: ${String((e2 as any)?.message ?? e2)}`
              );
            }
          }
        }
      } finally {
        // best-effort: wait a bit for any in-flight heartbeat tick to finish
        await Promise.race([hb.done, sleep(100)]);
      }

      if (ctrl.stop && drain) {
        if (verbose) safeLog(logger, `[consume] stop requested; exiting after draining job_id=${ctx.job_id}`);
        return;
      }
    }
  } finally {
    if (stop_on_ctrl_c) {
      process.off("SIGTERM", onSigterm);
      process.off("SIGINT", onSigint);
    }
  }
}
