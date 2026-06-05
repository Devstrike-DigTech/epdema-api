import type { Job } from 'bullmq';
import { JobCleanStatus, JobCounts, JobStatus, QueueAdapterOptions, QueueJobOptions } from '../../typings/app';
import { BullMQAdapter } from './bullMQ';
import type { QueueProLike } from './bullMQProTypes';
export declare class BullMQProAdapter extends BullMQAdapter {
    readonly isPro = true;
    private readonly proQueue;
    private groupCountsCache;
    constructor(queue: QueueProLike, options?: Partial<QueueAdapterOptions>);
    getJobCounts(): Promise<JobCounts>;
    getJobs(jobStatuses: JobStatus[], start?: number, end?: number): Promise<Job[]>;
    addJob(name: string, data: any, options: QueueJobOptions): Promise<Job<any, any, string>>;
    clean(jobStatus: JobCleanStatus, graceTimeMs: number): Promise<void>;
    empty(): Promise<void>;
    obliterate(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    promoteAll(): Promise<void>;
    private invalidateGroupCounts;
    private getGroupCounts;
    private getRelevantGroupStatuses;
    private fetchJobsFromGroups;
}
export type { JobProLike, QueueProLike } from './bullMQProTypes';
