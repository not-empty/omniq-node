export type PayloadT = Record<string, any> | any[] | string;

export interface JobCtx {
  queue: string;
  job_id: string;

  payload_raw: string;
  payload: PayloadT;

  attempt: number;
  lock_until_ms: number;
  lease_token: string;

  gid?: string;
  exec?: any;
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
  gid: string;
  lease_token: string;
}

export type AckFailResult = ["RETRY" | "FAILED", number | null];

export type BatchRemoveResult = Array<[string, string, string | null]>;
export type BatchRetryFailedResult = Array<[string, string, string | null]>;

export type ReserveResult = null | ReservePaused | ReserveJob;
