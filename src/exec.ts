// src/exec.ts

import type { OmniqOps } from "./ops.js";

export class Exec {
  public readonly ops: OmniqOps;
  public readonly default_child_id: string;

  constructor(args: { ops: OmniqOps; default_child_id: string }) {
    this.ops = args.ops;
    this.default_child_id = args.default_child_id ?? "";
  }

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
  }): Promise<string> {
    return await this.ops.publish({
      queue: args.queue,
      payload: args.payload,
      job_id: args.job_id,
      max_attempts: args.max_attempts ?? 3,
      timeout_ms: args.timeout_ms ?? 60_000,
      backoff_ms: args.backoff_ms ?? 5_000,
      due_ms: args.due_ms ?? 0,
      gid: args.gid ?? null,
      group_limit: args.group_limit ?? 0,
    });
  }

  async pause(args: { queue: string }): Promise<string> {
    return await this.ops.pause({ queue: args.queue });
  }

  async resume(args: { queue: string }): Promise<number> {
    return await this.ops.resume({ queue: args.queue });
  }

  async is_paused(args: { queue: string }): Promise<boolean> {
    return await this.ops.is_paused({ queue: args.queue });
  }

  async childs_init(key: string, expected: number): Promise<void> {
    await this.ops.childs_init({ key, expected: Math.trunc(expected) });
  }

  async child_ack(key: string, child_id?: string | null): Promise<number> {
    const cid = String(child_id ?? this.default_child_id ?? "").trim();
    if (!cid) {
      throw new Error("child_id is required (or provide default_child_id)");
    }
    const n = await this.ops.child_ack({ key, child_id: cid });
    return Math.trunc(n);
  }
}
