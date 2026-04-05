import { QueueMonitorCore } from "./monitor_core.js";

import type {
  GroupReady,
  GroupStatus,
  JobInfo,
  LaneJob,
  LaneName,
  QueueOverview,
  QueueStats,
} from "./monitor_models.js";

export class QueueMonitor {
  private _core: QueueMonitorCore;

  constructor(uq: any) {
    this._core = new QueueMonitorCore(uq);
  }

  async list_queues(): Promise<string[]> {
    return await this._core.list_queues();
  }

  async stats(queue: string): Promise<QueueStats> {
    return await this._core.stats(queue);
  }

  async stats_many(queues?: Iterable<string> | null): Promise<QueueStats[]> {
    return await this._core.stats_many(queues);
  }

  async groups_ready(args: { queue: string; offset?: number; limit?: number }): Promise<string[]> {
    return await this._core.groups_ready(args);
  }

  async groups_ready_with_scores(args: {
    queue: string;
    offset?: number;
    limit?: number;
  }): Promise<GroupReady[]> {
    return await this._core.groups_ready_with_scores(args);
  }

  async group_status(args: {
    queue: string;
    gids: string[];
    default_limit?: number;
  }): Promise<GroupStatus[]> {
    return await this._core.group_status(args);
  }

  async lane_page(args: {
    queue: string;
    lane: LaneName;
    offset?: number;
    limit?: number;
    reverse?: boolean;
  }): Promise<LaneJob[]> {
    return await this._core.lane_page(args);
  }

  async get_job(queue: string, job_id: string): Promise<JobInfo | null> {
    return await this._core.get_job(queue, job_id);
  }

  async find_jobs(args: {
    queue: string;
    lane: LaneName;
    job_ids: Iterable<string>;
  }): Promise<LaneJob[]> {
    return await this._core.find_jobs(args);
  }

  async overview(queue: string, samples_per_lane = 10): Promise<QueueOverview> {
    return await this._core.overview(queue, samples_per_lane);
  }
}
