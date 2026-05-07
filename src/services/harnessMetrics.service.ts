import type { HarnessMetricsSnapshot } from "../types/harness";

export class HarnessMetricsService {
  private refreshDurations: number[] = [];
  private refreshSuccessCount = 0;
  private refreshFailureCount = 0;
  private policyViolationCount = 0;
  private lastRefreshAt: string | null = null;
  private lastRefreshTraceId: string | null = null;

  public recordRefreshSuccess(durationMs: number, traceId: string): void {
    this.refreshSuccessCount += 1;
    this.pushDuration(durationMs);
    this.lastRefreshAt = new Date().toISOString();
    this.lastRefreshTraceId = traceId;
  }

  public recordRefreshFailure(durationMs: number, traceId: string): void {
    this.refreshFailureCount += 1;
    this.pushDuration(durationMs);
    this.lastRefreshAt = new Date().toISOString();
    this.lastRefreshTraceId = traceId;
  }

  public recordPolicyViolation(): void {
    this.policyViolationCount += 1;
  }

  public getSnapshot(): HarnessMetricsSnapshot {
    const sorted = [...this.refreshDurations].sort((a, b) => a - b);
    const avg =
      sorted.length === 0
        ? 0
        : Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(2));

    const p95Index = sorted.length === 0 ? 0 : Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    const p95 = sorted.length === 0 ? 0 : sorted[p95Index];

    return {
      refreshSuccessCount: this.refreshSuccessCount,
      refreshFailureCount: this.refreshFailureCount,
      policyViolationCount: this.policyViolationCount,
      averageRefreshMs: avg,
      p95RefreshMs: p95,
      lastRefreshAt: this.lastRefreshAt,
      lastRefreshTraceId: this.lastRefreshTraceId
    };
  }

  private pushDuration(durationMs: number): void {
    this.refreshDurations.push(durationMs);
    if (this.refreshDurations.length > 500) {
      this.refreshDurations = this.refreshDurations.slice(this.refreshDurations.length - 500);
    }
  }
}
