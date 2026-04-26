import type { Exec } from "./exec.js";

export type PayloadT = Record<string, any> | any[] | string;

export interface JobCtx {
  queue: string;
  job_id: string;

  payload_raw: string;
  payload: PayloadT;

  attempt: number;
  max_attempts: number;
  lock_until_ms: number;
  lease_token: string;

  gid?: string;
  exec: Exec;
}

export interface ReservePaused {
  status: "PAUSED";
}

export interface ReserveJob {
  status: "JOB";
  job_id: string;
  payload: string;
  lock_until_ms: number;
  attempt: number;
  max_attempts: number;
  gid: string;
  lease_token: string;
}

export type AckFailResult = ["RETRY" | "FAILED", number | null];

export interface BatchResultItem {
  job_id: string;
  status: string;
  reason: string | null;
}

export type BatchRemoveResult = BatchResultItem[];
export type BatchRetryFailedResult = BatchResultItem[];

export type ReserveResult = null | ReservePaused | ReserveJob;
