import { randomUUID } from "crypto";
import { Router } from "express";
import type { AppConfig } from "../config/env";
import { ApprovalService } from "../services/approval.service";
import { AuditTrailService } from "../services/auditTrail.service";
import { HarnessOrchestratorService } from "../services/harnessOrchestrator.service";
import {
  resolveUserId,
  resolveUserRole
} from "../services/rbac.service";
import { SentinelOrchestrationService } from "../services/sentinelOrchestration.service";

export const createSentinelRouter = (
  config: AppConfig,
  approvalService: ApprovalService,
  orchestratorService: HarnessOrchestratorService,
  auditTrailService: AuditTrailService,
  sentinelService: SentinelOrchestrationService
): Router => {
  const router = Router();

  router.post("/incident", async (req, res) => {
    const inboundSecret = req.header("x-sentinel-secret") ?? undefined;

    if (!sentinelService.isInboundAuthorized(inboundSecret)) {
      res.status(401).json({
        error: "unauthorized"
      });
      return;
    }

    const incidentId =
      typeof req.body?.incidentId === "string" && req.body.incidentId.trim().length > 0
        ? req.body.incidentId.trim()
        : "unknown-incident";

    const severity =
      typeof req.body?.severity === "string" && req.body.severity.trim().length > 0
        ? req.body.severity.trim().toLowerCase()
        : "medium";

    const userRole = resolveUserRole(req);
    const userId = resolveUserId(req);
    const traceId = randomUUID();

    await auditTrailService.record({
      id: randomUUID(),
      traceId,
      timestamp: new Date().toISOString(),
      tenantId: config.tenantId,
      category: "sentinel-incident-received",
      actorRole: userRole,
      actorId: userId,
      payload: {
        incidentId,
        severity
      }
    });

    if (config.requireSensitiveApproval && ["high", "critical"].includes(severity)) {
      const request = await approvalService.create({
        actionType: "sentinel-incident-refresh",
        requestedByRole: userRole,
        requestedBy: userId,
        reason: `Sentinel incident ${incidentId} with severity ${severity}`,
        traceId,
        payload: {
          incidentId,
          severity,
          trigger: `sentinel:${incidentId}:${severity}`
        }
      });

      await sentinelService.publishEvent("approval-requested", traceId, {
        approvalId: request.id,
        actionType: request.actionType,
        incidentId,
        severity
      });

      res.status(202).json({
        status: "approval-required",
        approvalId: request.id,
        incidentId,
        severity
      });
      return;
    }

    try {
      const result = await orchestratorService.executeRefresh(
        `sentinel:${incidentId}:${severity}`,
        userRole,
        userId
      );

      await sentinelService.publishEvent("incident-refresh-executed", result.traceId, {
        incidentId,
        severity,
        recommendationCount: result.recommendationCount
      });

      res.json({
        status: "executed",
        result
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Incident execution failed"
      });
    }
  });

  return router;
};
