import { randomUUID } from "crypto";
import { Router } from "express";
import type { AppConfig } from "../config/env";
import { ApprovalService } from "../services/approval.service";
import { AuditTrailService } from "../services/auditTrail.service";
import { HarnessMetricsService } from "../services/harnessMetrics.service";
import { HarnessOrchestratorService } from "../services/harnessOrchestrator.service";
import {
  requireMinimumRole,
  resolveUserId,
  resolveUserRole
} from "../services/rbac.service";
import { SentinelOrchestrationService } from "../services/sentinelOrchestration.service";

export const createHarnessRouter = (
  config: AppConfig,
  approvalService: ApprovalService,
  metricsService: HarnessMetricsService,
  orchestratorService: HarnessOrchestratorService,
  auditTrailService: AuditTrailService,
  sentinelService: SentinelOrchestrationService
): Router => {
  const router = Router();

  router.get("/status", requireMinimumRole("Reader"), (_req, res) => {
    const pendingApprovals = approvalService.list("pending").length;

    res.json({
      tenantId: config.tenantId,
      approvals: {
        pending: pendingApprovals
      },
      metrics: metricsService.getSnapshot(),
      controls: {
        enforceUsResidency: config.enforceUsResidency,
        requireSensitiveApproval: config.requireSensitiveApproval,
        retentionYears: config.retentionYears,
        maxLoopIterations: config.harnessMaxLoopIterations,
        maxExternalCalls: config.harnessMaxExternalCalls,
        executionTimeoutMs: config.harnessExecutionTimeoutMs,
        tokenBudget: config.harnessTokenBudget
      }
    });
  });

  router.post("/refresh", requireMinimumRole("Operator"), async (req, res) => {
    const role = resolveUserRole(req);
    const actorId = resolveUserId(req);
    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim().length > 0
        ? req.body.reason.trim()
        : "Manual refresh requested via harness endpoint";

    const severity =
      typeof req.body?.severity === "string" && req.body.severity.trim().length > 0
        ? req.body.severity.trim().toLowerCase()
        : "medium";

    const shouldRequireApproval =
      config.requireSensitiveApproval && ["high", "critical"].includes(severity);

    if (shouldRequireApproval) {
      const traceId = randomUUID();
      const request = await approvalService.create({
        actionType: "manual-refresh",
        requestedByRole: role,
        requestedBy: actorId,
        reason,
        traceId,
        payload: {
          severity,
          trigger: "manual-approved-refresh"
        }
      });

      await auditTrailService.record({
        id: randomUUID(),
        traceId,
        timestamp: new Date().toISOString(),
        tenantId: config.tenantId,
        category: "approval-requested",
        actorRole: role,
        actorId,
        payload: {
          approvalId: request.id,
          actionType: request.actionType,
          severity,
          reason
        }
      });

      await sentinelService.publishEvent("approval-requested", traceId, {
        approvalId: request.id,
        actionType: request.actionType,
        severity,
        reason
      });

      res.status(202).json({
        status: "approval-required",
        approvalId: request.id,
        expiresAt: request.expiresAt
      });
      return;
    }

    try {
      const result = await orchestratorService.executeRefresh("manual", role, actorId);

      res.json({
        status: "executed",
        result
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Refresh execution failed"
      });
    }
  });

  return router;
};
