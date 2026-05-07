import { randomUUID } from "crypto";
import { Router } from "express";
import type { AppConfig } from "../config/env";
import { ApprovalService } from "../services/approval.service";
import { AuditTrailService } from "../services/auditTrail.service";
import { HarnessOrchestratorService } from "../services/harnessOrchestrator.service";
import {
  requireMinimumRole,
  resolveUserId,
  resolveUserRole
} from "../services/rbac.service";
import { SentinelOrchestrationService } from "../services/sentinelOrchestration.service";

export const createApprovalsRouter = (
  config: AppConfig,
  approvalService: ApprovalService,
  orchestratorService: HarnessOrchestratorService,
  auditTrailService: AuditTrailService,
  sentinelService: SentinelOrchestrationService
): Router => {
  const router = Router();

  router.get("/pending", requireMinimumRole("Approver"), (_req, res) => {
    const pending = approvalService.list("pending");
    res.json(pending);
  });

  router.post("/:approvalId/approve", requireMinimumRole("Approver"), async (req, res) => {
    const role = resolveUserRole(req);
    const actorId = resolveUserId(req);
    const approvalId = req.params.approvalId;

    try {
      const request = await approvalService.approve(approvalId, role, actorId);

      await auditTrailService.record({
        id: randomUUID(),
        traceId: request.traceId,
        timestamp: new Date().toISOString(),
        tenantId: config.tenantId,
        category: "approval-approved",
        actorRole: role,
        actorId,
        payload: {
          approvalId: request.id,
          actionType: request.actionType
        }
      });

      await sentinelService.publishEvent("approval-approved", request.traceId, {
        approvalId: request.id,
        actionType: request.actionType
      });

      if (
        request.actionType === "manual-refresh" ||
        request.actionType === "sentinel-incident-refresh"
      ) {
        const triggerFromPayload = request.payload.trigger;
        const trigger = typeof triggerFromPayload === "string" ? triggerFromPayload : request.actionType;

        try {
          const executionResult = await orchestratorService.executeRefresh(
            trigger,
            role,
            actorId
          );

          await approvalService.markExecuted(
            request.id,
            "success",
            `Refresh completed for trace ${executionResult.traceId}`
          );

          res.json({
            approval: request,
            execution: executionResult
          });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown execution error";
          await approvalService.markExecuted(request.id, "failed", message);

          res.status(500).json({
            approval: request,
            error: message
          });
          return;
        }
      }

      res.json({
        approval: request
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Approval failed"
      });
    }
  });

  router.post("/:approvalId/reject", requireMinimumRole("Approver"), async (req, res) => {
    const role = resolveUserRole(req);
    const actorId = resolveUserId(req);
    const approvalId = req.params.approvalId;
    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim().length > 0
        ? req.body.reason.trim()
        : "Rejected by reviewer";

    try {
      const request = await approvalService.reject(approvalId, role, actorId, reason);

      await auditTrailService.record({
        id: randomUUID(),
        traceId: request.traceId,
        timestamp: new Date().toISOString(),
        tenantId: config.tenantId,
        category: "approval-rejected",
        actorRole: role,
        actorId,
        payload: {
          approvalId: request.id,
          actionType: request.actionType,
          reason
        }
      });

      await sentinelService.publishEvent("approval-rejected", request.traceId, {
        approvalId: request.id,
        actionType: request.actionType,
        reason
      });

      res.json({
        approval: request
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Reject failed"
      });
    }
  });

  return router;
};
