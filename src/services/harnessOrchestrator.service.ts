import { randomUUID } from "crypto";
import type { AppConfig } from "../config/env";
import { logger } from "../config/logger";
import type { RefreshExecutionResult, UserRole } from "../types/harness";
import { AuditTrailService } from "./auditTrail.service";
import { HarnessMetricsService } from "./harnessMetrics.service";
import { PipelineService } from "./pipeline.service";
import { SentinelOrchestrationService } from "./sentinelOrchestration.service";

const REFRESH_EXTERNAL_CALL_ESTIMATE = 11;

export class HarnessOrchestratorService {
  public constructor(
    private readonly config: AppConfig,
    private readonly pipelineService: PipelineService,
    private readonly metricsService: HarnessMetricsService,
    private readonly auditTrailService: AuditTrailService,
    private readonly sentinelService: SentinelOrchestrationService
  ) {}

  public async executeRefresh(
    trigger: string,
    actorRole: UserRole | "System",
    actorId: string
  ): Promise<RefreshExecutionResult> {
    const traceId = randomUUID();
    const startedAt = Date.now();

    if (this.config.harnessMaxLoopIterations < 1) {
      await this.recordPolicyViolation(traceId, actorRole, actorId, {
        reason: "Invalid loop iteration config",
        configuredMaxLoopIterations: this.config.harnessMaxLoopIterations
      });
      throw new Error("HARNESS_MAX_LOOP_ITERATIONS must be at least 1");
    }

    if (REFRESH_EXTERNAL_CALL_ESTIMATE > this.config.harnessMaxExternalCalls) {
      await this.recordPolicyViolation(traceId, actorRole, actorId, {
        reason: "External call budget exceeded",
        estimatedCalls: REFRESH_EXTERNAL_CALL_ESTIMATE,
        allowedCalls: this.config.harnessMaxExternalCalls
      });
      throw new Error("Refresh external call estimate exceeds HARNESS_MAX_EXTERNAL_CALLS");
    }

    await this.auditTrailService.record({
      id: randomUUID(),
      traceId,
      timestamp: new Date().toISOString(),
      tenantId: this.config.tenantId,
      category: "refresh-start",
      actorRole,
      actorId,
      payload: {
        trigger
      }
    });

    try {
      const refreshPromise = this.pipelineService.refresh(trigger);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Refresh exceeded timeout of ${this.config.harnessExecutionTimeoutMs}ms`));
        }, this.config.harnessExecutionTimeoutMs);
      });

      const snapshot = await Promise.race([refreshPromise, timeoutPromise]);

      const durationMs = Date.now() - startedAt;
      this.metricsService.recordRefreshSuccess(durationMs, traceId);

      const estimatedTokens = Math.ceil(
        Buffer.byteLength(JSON.stringify(snapshot), "utf-8") / 4
      );

      if (estimatedTokens > this.config.harnessTokenBudget) {
        await this.recordPolicyViolation(traceId, actorRole, actorId, {
          reason: "Token budget exceeded",
          estimatedTokens,
          allowedTokens: this.config.harnessTokenBudget
        });
      }

      const result: RefreshExecutionResult = {
        traceId,
        durationMs,
        trigger,
        collectedAt: snapshot.collectedAt,
        recommendationCount: snapshot.remediationRecommendations.length
      };

      await this.auditTrailService.record({
        id: randomUUID(),
        traceId,
        timestamp: new Date().toISOString(),
        tenantId: this.config.tenantId,
        category: "refresh-success",
        actorRole,
        actorId,
        payload: {
          ...result
        }
      });

      await this.sentinelService.publishEvent("refresh-success", traceId, {
        ...result
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.metricsService.recordRefreshFailure(durationMs, traceId);

      const message = error instanceof Error ? error.message : "Unknown refresh failure";

      await this.auditTrailService.record({
        id: randomUUID(),
        traceId,
        timestamp: new Date().toISOString(),
        tenantId: this.config.tenantId,
        category: "refresh-failure",
        actorRole,
        actorId,
        payload: {
          trigger,
          durationMs,
          message
        }
      });

      await this.sentinelService.publishEvent("refresh-failure", traceId, {
        trigger,
        durationMs,
        message
      });

      logger.error(
        {
          traceId,
          durationMs,
          message
        },
        "Guarded refresh execution failed"
      );

      throw error;
    }
  }

  private async recordPolicyViolation(
    traceId: string,
    actorRole: UserRole | "System",
    actorId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    this.metricsService.recordPolicyViolation();

    await this.auditTrailService.record({
      id: randomUUID(),
      traceId,
      timestamp: new Date().toISOString(),
      tenantId: this.config.tenantId,
      category: "policy-violation",
      actorRole,
      actorId,
      payload
    });

    await this.sentinelService.publishEvent("policy-violation", traceId, payload);
  }
}
