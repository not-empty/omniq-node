export type LaneName = "wait" | "active" | "delayed" | "failed" | "completed";

export interface QueueStats {
  queue: string;
  paused: boolean;
  waiting: number;
  group_waiting: number;
  waiting_total: number;
  active: number;
  delayed: number;
  failed: number;
  completed_kept: number;
  groups_ready: number;
  last_activity_ms: number;
  last_enqueue_ms: number;
  last_reserve_ms: number;
  last_finish_ms: number;
}

export interface GroupReady {
  gid: string;
  score_ms: number;
}

export interface GroupStatus {
  gid: string;
  inflight: number;
  limit: number;
  ready: boolean;
  waiting_count: number;
}

export interface LaneJob {
  lane: LaneName;
  job_id: string;
  idx_score_ms: number;
  state: string;
  gid: string;
  attempt: number;
  max_attempts: number;
  due_ms: number;
  lock_until_ms: number;
  queued_ms: number;
  first_started_ms: number;
  last_started_ms: number;
  completed_ms: number;
  failed_ms: number;
  updated_ms: number;
  last_error: string;
}

export interface JobInfo {
  job_id: string;
  state: string;
  gid: string;
  attempt: number;
  max_attempts: number;
  timeout_ms: number;
  backoff_ms: number;
  lease_token: string;
  lock_until_ms: number;
  due_ms: number;
  payload: string;
  last_error: string;
  last_error_ms: number;
  created_ms: number;
  updated_ms: number;
  queued_ms: number;
  first_started_ms: number;
  last_started_ms: number;
  completed_ms: number;
  failed_ms: number;
}

export interface QueueOverview {
  stats: QueueStats;
  ready_groups: GroupReady[];
  active: LaneJob[];
  delayed: LaneJob[];
  failed: LaneJob[];
  completed: LaneJob[];
}
