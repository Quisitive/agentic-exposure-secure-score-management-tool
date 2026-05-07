import { Router } from "express";
import type { ApprovalService } from "../services/approval.service";
import type { HarnessMetricsService } from "../services/harnessMetrics.service";
import type { PipelineService } from "../services/pipeline.service";

export const createHealthRouter = (
  pipelineService: PipelineService,
  metricsService?: HarnessMetricsService,
  approvalService?: ApprovalService
): Router => {
  const router = Router();

  router.get("/", (_req, res) => {
    const snapshot = pipelineService.getLatestSnapshot();
    const metrics = metricsService?.getSnapshot() ?? null;
    const pendingApprovals = approvalService?.list("pending").length ?? 0;

    res.json({
      status: "ok",
      service: "agentic-exposure-secure-score-management-tool",
      uptimeSeconds: Number(process.uptime().toFixed(2)),
      hasSnapshot: Boolean(snapshot),
      latestCollectionTime: snapshot?.collectedAt ?? null,
      tenantId: snapshot?.metadata.tenantId ?? null,
      pendingApprovals,
      harnessMetrics: metrics
    });
  });

  return router;
};
