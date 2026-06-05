"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BullMQProAdapter = void 0;
const statuses_1 = require("../constants/statuses");
const bullMQ_1 = require("./bullMQ");
const GROUP_COUNTS_TTL_MS = 5000;
const BUCKET_TO_GROUP_STATUSES = {
    [statuses_1.STATUSES.waiting]: ['waiting'],
    [statuses_1.STATUSES.delayed]: ['limited', 'maxed'],
    [statuses_1.STATUSES.paused]: ['paused'],
};
class BullMQProAdapter extends bullMQ_1.BullMQAdapter {
    constructor(queue, options = {}) {
        super(queue, options);
        this.isPro = true;
        this.groupCountsCache = null;
        this.proQueue = queue;
        this.setFormatter('name', (jobProps) => {
            var _a, _b, _c;
            const gid = (_b = (_a = jobProps === null || jobProps === void 0 ? void 0 : jobProps.opts) === null || _a === void 0 ? void 0 : _a.group) === null || _b === void 0 ? void 0 : _b.id;
            const baseName = (_c = jobProps === null || jobProps === void 0 ? void 0 : jobProps.name) !== null && _c !== void 0 ? _c : '';
            return gid != null ? `${baseName} (group: ${gid})` : baseName;
        });
    }
    async getJobCounts() {
        var _a, _b, _c;
        const [base, groups] = await Promise.all([super.getJobCounts(), this.getGroupCounts()]);
        return {
            ...base,
            [statuses_1.STATUSES.waiting]: ((_a = base[statuses_1.STATUSES.waiting]) !== null && _a !== void 0 ? _a : 0) + groups.waiting,
            [statuses_1.STATUSES.delayed]: ((_b = base[statuses_1.STATUSES.delayed]) !== null && _b !== void 0 ? _b : 0) + groups.limited + groups.maxed,
            [statuses_1.STATUSES.paused]: ((_c = base[statuses_1.STATUSES.paused]) !== null && _c !== void 0 ? _c : 0) + groups.paused,
        };
    }
    async getJobs(jobStatuses, start = 0, end = -1) {
        const requestedEnd = end;
        const normalizedEnd = end === -1 ? Number.MAX_SAFE_INTEGER : end;
        const pageSize = normalizedEnd - start + 1;
        const groupStatuses = this.getRelevantGroupStatuses(jobStatuses);
        if (groupStatuses.length === 0) {
            return super.getJobs(jobStatuses, start, requestedEnd);
        }
        const counts = await super.getJobCounts();
        const regularCount = jobStatuses.reduce((sum, status) => { var _a; return sum + ((_a = counts[status]) !== null && _a !== void 0 ? _a : 0); }, 0);
        const regularJobs = start < regularCount
            ? await super.getJobs(jobStatuses, start, Math.min(normalizedEnd, regularCount - 1))
            : [];
        const groupSkip = Math.max(0, start - regularCount);
        const groupTake = pageSize - regularJobs.length;
        if (groupTake <= 0) {
            return regularJobs;
        }
        const groupJobs = await this.fetchJobsFromGroups(groupStatuses, groupSkip, groupTake);
        return [...regularJobs, ...groupJobs];
    }
    addJob(name, data, options) {
        this.invalidateGroupCounts();
        return super.addJob(name, data, options);
    }
    async clean(jobStatus, graceTimeMs) {
        this.invalidateGroupCounts();
        return super.clean(jobStatus, graceTimeMs);
    }
    async empty() {
        this.invalidateGroupCounts();
        return super.empty();
    }
    async obliterate() {
        this.invalidateGroupCounts();
        return super.obliterate();
    }
    async pause() {
        this.invalidateGroupCounts();
        return super.pause();
    }
    async resume() {
        this.invalidateGroupCounts();
        return super.resume();
    }
    async promoteAll() {
        this.invalidateGroupCounts();
        return super.promoteAll();
    }
    invalidateGroupCounts() {
        this.groupCountsCache = null;
    }
    async getGroupCounts() {
        const now = Date.now();
        if (this.groupCountsCache && now - this.groupCountsCache.fetchedAt < GROUP_COUNTS_TTL_MS) {
            return this.groupCountsCache.value;
        }
        const value = await this.proQueue.getGroupsCountByStatus();
        this.groupCountsCache = { fetchedAt: now, value };
        return value;
    }
    getRelevantGroupStatuses(jobStatuses) {
        const result = new Set();
        for (const status of jobStatuses) {
            const mapped = BUCKET_TO_GROUP_STATUSES[status];
            if (mapped) {
                for (const groupStatus of mapped) {
                    result.add(groupStatus);
                }
            }
        }
        return [...result];
    }
    async fetchJobsFromGroups(groupStatuses, skip, take) {
        const collected = [];
        let remainingSkip = skip;
        let remainingTake = take;
        for (const groupStatus of groupStatuses) {
            if (remainingTake <= 0)
                break;
            const groups = await this.proQueue.getGroupsByStatus(groupStatus);
            for (const group of groups) {
                if (remainingTake <= 0)
                    break;
                if (remainingSkip >= group.count) {
                    remainingSkip -= group.count;
                    continue;
                }
                const groupStart = remainingSkip;
                const groupEnd = Math.min(group.count - 1, groupStart + remainingTake - 1);
                const jobs = await this.proQueue.getGroupJobs(group.id, groupStart, groupEnd);
                collected.push(...jobs);
                remainingSkip = 0;
                remainingTake -= jobs.length;
            }
        }
        return collected;
    }
}
exports.BullMQProAdapter = BullMQProAdapter;
//# sourceMappingURL=bullMQPro.js.map