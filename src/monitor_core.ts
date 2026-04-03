import { queueBase } from "./helper.js";

import type {
  GroupReady,
  GroupStatus,
  JobInfo,
  LaneJob,
  LaneName,
  QueueOverview,
  QueueStats,
} from "./monitor_models.js";

const QUEUE_REGISTRY = "omniq:queues";
const MAX_LIST_LIMIT = 25;
const MAX_GROUP_LIMIT = 500;

type RedisMonitorLike = {
  smembers?(key: string): Promise<unknown> | unknown;
  sMembers?(key: string): Promise<unknown> | unknown;
  hgetall?(key: string): Promise<unknown> | unknown;
  hGetAll?(key: string): Promise<unknown> | unknown;
  exists?(key: string): Promise<number> | number;
  get?(key: string): Promise<unknown> | unknown;
  llen?(key: string): Promise<number> | number;
  lLen?(key: string): Promise<number> | number;
  zrange?(key: string, start: number, stop: number, opts?: unknown): Promise<unknown> | unknown;
  zRange?(key: string, start: number, stop: number, opts?: unknown): Promise<unknown> | unknown;
  zrevrange?(key: string, start: number, stop: number, opts?: unknown): Promise<unknown> | unknown;
  zRevRange?(key: string, start: number, stop: number, opts?: unknown): Promise<unknown> | unknown;
  zscore?(key: string, member: string): Promise<unknown> | unknown;
  zScore?(key: string, member: string): Promise<unknown> | unknown;
};

type MonitorHost = {
  r?: RedisMonitorLike;
  ops?: { r?: RedisMonitorLike };
  _ops?: { r?: RedisMonitorLike };
};

function asString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString("utf8");
  }

  return String(value);
}

function toInt(value: unknown, defaultValue = 0): number {
  const s = asString(value);
  if (s === "") {
    return defaultValue;
  }

  const n = Number.parseInt(String(Number(s)), 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function normalizeQueueName(baseOrQueue: string): string {
  const value = (baseOrQueue ?? "").trim();
  if (value.startsWith("{") && value.endsWith("}")) {
    return value.slice(1, -1);
  }
  return value;
}

function decodeHash(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") {
    return out;
  }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[asString(key)] = value;
  }

  return out;
}

function clampListLimit(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit), MAX_LIST_LIMIT));
}

function clampGroupLimit(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit), MAX_GROUP_LIMIT));
}

export class QueueMonitorCore {
  private _uq: MonitorHost;
  private _r: RedisMonitorLike;

  constructor(uq: MonitorHost) {
    this._uq = uq;
    this._r = uq?.r ?? uq?.ops?.r ?? uq?._ops?.r ?? null;

    if (this._r === null) {
      throw new Error(
        "QueueMonitor needs redis access (inject from server, do not expose to UI callers)."
      );
    }
  }

  private _base(queue: string): string {
    return queueBase(queue);
  }

  private _statsKey(base: string): string {
    return `${base}:stats`;
  }

  private _pausedKey(base: string): string {
    return `${base}:paused`;
  }

  private _readyKey(base: string): string {
    return `${base}:groups:ready`;
  }

  private _jobKey(base: string, jobId: string): string {
    return `${base}:job:${jobId}`;
  }

  private _idxKey(base: string, lane: LaneName): string {
    return `${base}:idx:${lane}`;
  }

  private _gwaitKey(base: string, gid: string): string {
    return `${base}:g:${gid}:wait`;
  }

  private _ginflightKey(base: string, gid: string): string {
    return `${base}:g:${gid}:inflight`;
  }

  private _glimitKey(base: string, gid: string): string {
    return `${base}:g:${gid}:limit`;
  }

  private async _smembers(key: string): Promise<unknown[]> {
    if (typeof this._r.sMembers === "function") {
      return ((await this._r.sMembers(key)) as unknown[]) ?? [];
    }
    if (typeof this._r.smembers === "function") {
      return ((await this._r.smembers(key)) as unknown[]) ?? [];
    }
    return [];
  }

  private async _hgetall(key: string): Promise<Record<string, unknown>> {
    if (typeof this._r.hGetAll === "function") {
      return decodeHash(await this._r.hGetAll(key));
    }
    if (typeof this._r.hgetall === "function") {
      return decodeHash(await this._r.hgetall(key));
    }
    return {};
  }

  private async _exists(key: string): Promise<number> {
    if (typeof this._r.exists === "function") {
      return Number(await this._r.exists(key)) || 0;
    }
    return 0;
  }

  private async _get(key: string): Promise<unknown> {
    if (typeof this._r.get === "function") {
      return await this._r.get(key);
    }
    return null;
  }

  private async _llen(key: string): Promise<number> {
    if (typeof this._r.lLen === "function") {
      return Number(await this._r.lLen(key)) || 0;
    }
    if (typeof this._r.llen === "function") {
      return Number(await this._r.llen(key)) || 0;
    }
    return 0;
  }

  private async _zrangeWithScores(
    key: string,
    start: number,
    stop: number,
    reverse = false
  ): Promise<Array<[string, unknown]>> {
    const opts = { WITHSCORES: true };

    const parseRows = (rows: unknown): Array<[string, unknown]> => {
      if (!Array.isArray(rows)) {
        return [];
      }

      const normalized: Array<[string, unknown]> = [];
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];

        if (Array.isArray(row) && row.length >= 2) {
          normalized.push([asString(row[0]), row[1]]);
          continue;
        }

        if (row && typeof row === "object" && "value" in (row as any) && "score" in (row as any)) {
          normalized.push([asString((row as any).value), (row as any).score]);
          continue;
        }

        if (i + 1 < rows.length) {
          normalized.push([asString(row), rows[i + 1]]);
          i += 1;
        }
      }

      return normalized;
    };

    if (reverse) {
      if (typeof this._r.zRevRange === "function") {
        return parseRows(await this._r.zRevRange(key, start, stop, opts));
      }
      if (typeof this._r.zrevrange === "function") {
        return parseRows(await this._r.zrevrange(key, start, stop, opts));
      }
    } else {
      if (typeof this._r.zRange === "function") {
        return parseRows(await this._r.zRange(key, start, stop, opts));
      }
      if (typeof this._r.zrange === "function") {
        return parseRows(await this._r.zrange(key, start, stop, opts));
      }
    }

    return [];
  }

  private async _zscore(key: string, member: string): Promise<unknown> {
    if (typeof this._r.zScore === "function") {
      return await this._r.zScore(key, member);
    }
    if (typeof this._r.zscore === "function") {
      return await this._r.zscore(key, member);
    }
    return null;
  }

  private async _readJobMap(base: string, jobId: string): Promise<Record<string, unknown> | null> {
    const key = this._jobKey(base, jobId);

    try {
      if ((await this._exists(key)) !== 1) {
        return null;
      }

      return await this._hgetall(key);
    } catch {
      return null;
    }
  }

  private _jobInfoFromMap(jobId: string, m: Record<string, unknown>): JobInfo {
    return {
      job_id: jobId,
      state: asString(m.state),
      gid: asString(m.gid),
      attempt: toInt(m.attempt),
      max_attempts: toInt(m.max_attempts),
      timeout_ms: toInt(m.timeout_ms),
      backoff_ms: toInt(m.backoff_ms),
      lease_token: asString(m.lease_token),
      lock_until_ms: toInt(m.lock_until_ms),
      due_ms: toInt(m.due_ms),
      payload: asString(m.payload),
      last_error: asString(m.last_error),
      last_error_ms: toInt(m.last_error_ms),
      created_ms: toInt(m.created_ms),
      updated_ms: toInt(m.updated_ms),
      queued_ms: toInt(m.queued_ms),
      first_started_ms: toInt(m.first_started_ms),
      last_started_ms: toInt(m.last_started_ms),
      completed_ms: toInt(m.completed_ms),
      failed_ms: toInt(m.failed_ms),
    };
  }

  private _laneJobFromMap(
    lane: LaneName,
    jobId: string,
    idxScoreMs: number,
    m: Record<string, unknown>
  ): LaneJob {
    return {
      lane,
      job_id: jobId,
      idx_score_ms: idxScoreMs,
      state: asString(m.state),
      gid: asString(m.gid),
      attempt: toInt(m.attempt),
      max_attempts: toInt(m.max_attempts),
      due_ms: toInt(m.due_ms),
      lock_until_ms: toInt(m.lock_until_ms),
      queued_ms: toInt(m.queued_ms),
      first_started_ms: toInt(m.first_started_ms),
      last_started_ms: toInt(m.last_started_ms),
      completed_ms: toInt(m.completed_ms),
      failed_ms: toInt(m.failed_ms),
      updated_ms: toInt(m.updated_ms),
      last_error: asString(m.last_error),
    };
  }

  async list_queues(): Promise<string[]> {
    try {
      const bases = await this._smembers(QUEUE_REGISTRY);
      const names = bases.map((x) => normalizeQueueName(asString(x))).filter((x) => x !== "");
      names.sort();
      return names;
    } catch {
      return [];
    }
  }

  async stats(queue: string): Promise<QueueStats> {
    const base = this._base(queue);

    let statsMap: Record<string, unknown> = {};
    try {
      statsMap = await this._hgetall(this._statsKey(base));
    } catch {
      statsMap = {};
    }

    let paused = false;
    try {
      paused = (await this._exists(this._pausedKey(base))) === 1;
    } catch {
      paused = false;
    }

    const waiting = toInt(statsMap.waiting);
    const group_waiting = toInt(statsMap.group_waiting);
    let waiting_total = toInt(statsMap.waiting_total);

    if (waiting_total <= 0 && (waiting > 0 || group_waiting > 0)) {
      waiting_total = waiting + group_waiting;
    }

    return {
      queue: normalizeQueueName(queue),
      paused,
      waiting,
      group_waiting,
      waiting_total,
      active: toInt(statsMap.active),
      delayed: toInt(statsMap.delayed),
      failed: toInt(statsMap.failed),
      completed_kept: toInt(statsMap.completed_kept),
      groups_ready: toInt(statsMap.groups_ready),
      last_activity_ms: toInt(statsMap.last_activity_ms),
      last_enqueue_ms: toInt(statsMap.last_enqueue_ms),
      last_reserve_ms: toInt(statsMap.last_reserve_ms),
      last_finish_ms: toInt(statsMap.last_finish_ms),
    };
  }

  async stats_many(queues?: Iterable<string> | null): Promise<QueueStats[]> {
    const target = queues ? Array.from(queues) : await this.list_queues();
    return await Promise.all(target.map(async (queue) => await this.stats(queue)));
  }

  async groups_ready(args: { queue: string; offset?: number; limit?: number }): Promise<string[]> {
    const rows = await this.groups_ready_with_scores(args);
    return rows.map((x) => x.gid);
  }

  async groups_ready_with_scores(args: {
    queue: string;
    offset?: number;
    limit?: number;
  }): Promise<GroupReady[]> {
    const { queue, offset = 0, limit = 200 } = args;

    const base = this._base(queue);
    const safeOffset = Math.max(0, Math.trunc(offset));
    const safeLimit = clampGroupLimit(limit);

    try {
      const rows = await this._zrangeWithScores(
        this._readyKey(base),
        safeOffset,
        safeOffset + safeLimit - 1
      );

      return rows
        .filter(([gid]) => gid !== "")
        .map(([gid, score]) => ({
          gid,
          score_ms: toInt(score),
        }));
    } catch {
      return [];
    }
  }

  async group_status(args: {
    queue: string;
    gids: string[];
    default_limit?: number;
  }): Promise<GroupStatus[]> {
    const { queue, gids, default_limit = 1 } = args;

    const base = this._base(queue);
    const fallbackLimit = Math.max(1, Math.trunc(default_limit));
    const normalizedGids = gids.map((gid) => asString(gid)).filter((gid) => gid !== "").slice(0, MAX_GROUP_LIMIT);
    const readySet = new Set(await this.groups_ready({ queue, limit: Math.max(normalizedGids.length, 1) }));

    const out: GroupStatus[] = [];

    for (const gid of normalizedGids) {
      let inflight = 0;
      let rawLimit = 0;
      let waitingCount = 0;

      try {
        inflight = toInt(await this._get(this._ginflightKey(base, gid)));
      } catch {
        inflight = 0;
      }

      try {
        rawLimit = toInt(await this._get(this._glimitKey(base, gid)));
      } catch {
        rawLimit = 0;
      }

      try {
        waitingCount = toInt(await this._llen(this._gwaitKey(base, gid)));
      } catch {
        waitingCount = 0;
      }

      out.push({
        gid,
        inflight,
        limit: rawLimit > 0 ? rawLimit : fallbackLimit,
        ready: readySet.has(gid),
        waiting_count: waitingCount,
      });
    }

    return out;
  }

  async lane_page(args: {
    queue: string;
    lane: LaneName;
    offset?: number;
    limit?: number;
    reverse?: boolean;
  }): Promise<LaneJob[]> {
    const { queue, lane, offset = 0, limit = 25, reverse = false } = args;

    const base = this._base(queue);
    const safeOffset = Math.max(0, Math.trunc(offset));
    const safeLimit = clampListLimit(limit);
    const key = this._idxKey(base, lane);

    try {
      const rows = await this._zrangeWithScores(key, safeOffset, safeOffset + safeLimit - 1, reverse);
      const out: LaneJob[] = [];

      for (const [rawJobId, rawScore] of rows) {
        const jobId = asString(rawJobId);
        if (jobId === "") {
          continue;
        }

        const m = await this._readJobMap(base, jobId);
        if (!m) {
          continue;
        }

        out.push(this._laneJobFromMap(lane, jobId, toInt(rawScore), m));
      }

      return out;
    } catch {
      return [];
    }
  }

  async get_job(queue: string, jobId: string): Promise<JobInfo | null> {
    const base = this._base(queue);
    const normalizedJobId = asString(jobId);

    if (normalizedJobId === "") {
      return null;
    }

    const m = await this._readJobMap(base, normalizedJobId);
    if (!m) {
      return null;
    }

    return this._jobInfoFromMap(normalizedJobId, m);
  }

  async find_jobs(args: {
    queue: string;
    lane: LaneName;
    job_ids: Iterable<string>;
  }): Promise<LaneJob[]> {
    const { queue, lane, job_ids } = args;

    const base = this._base(queue);
    const idxKey = this._idxKey(base, lane);
    const out: LaneJob[] = [];

    for (const rawJobId of job_ids) {
      const jobId = asString(rawJobId);
      if (jobId === "") {
        continue;
      }

      let score: unknown;
      try {
        score = await this._zscore(idxKey, jobId);
      } catch {
        score = null;
      }

      if (score === null || score === undefined) {
        continue;
      }

      const m = await this._readJobMap(base, jobId);
      if (!m) {
        continue;
      }

      out.push(this._laneJobFromMap(lane, jobId, toInt(score), m));
    }

    return out;
  }

  async overview(queue: string, samples_per_lane = 10): Promise<QueueOverview> {
    const sampleLimit = clampListLimit(samples_per_lane);

    return {
      stats: await this.stats(queue),
      ready_groups: await this.groups_ready_with_scores({ queue, limit: sampleLimit }),
      active: await this.lane_page({ queue, lane: "active", limit: sampleLimit }),
      delayed: await this.lane_page({ queue, lane: "delayed", limit: sampleLimit }),
      failed: await this.lane_page({ queue, lane: "failed", limit: sampleLimit }),
      completed: await this.lane_page({ queue, lane: "completed", limit: sampleLimit }),
    };
  }
}
