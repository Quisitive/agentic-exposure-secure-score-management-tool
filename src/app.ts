import cors from "cors";
import express, { type Express } from "express";
import cron, { type ScheduledTask } from "node-cron";
import { DefenderClient } from "./clients/defenderClient";
import { GraphClient } from "./clients/graphClient";
import { OAuthClient } from "./clients/oauthClient";
import { config } from "./config/env";
import { logger } from "./config/logger";
import { McpBridgeClient } from "./remediation/mcpBridgeClient";
import { RemediationService } from "./remediation/remediation.service";
import { createApprovalsRouter } from "./routes/approvals.routes";
import { createHarnessRouter } from "./routes/harness.routes";
import { createHealthRouter } from "./routes/health.routes";
import { createPowerBiRouter } from "./routes/powerbi.routes";
import { createSentinelRouter } from "./routes/sentinel.routes";
import { ApprovalService } from "./services/approval.service";
import { AuditTrailService } from "./services/auditTrail.service";
import { HarnessMetricsService } from "./services/harnessMetrics.service";
import { HarnessOrchestratorService } from "./services/harnessOrchestrator.service";
import { NormalizeService } from "./services/normalize.service";
import { PipelineService } from "./services/pipeline.service";
import { PiiMaskingService } from "./services/piiMasking.service";
import { PowerBiExporterService } from "./services/powerbiExporter.service";
import { resolveUserId, resolveUserRole } from "./services/rbac.service";
import { SentinelOrchestrationService } from "./services/sentinelOrchestration.service";
import { SnapshotStoreService } from "./services/snapshotStore.service";

export interface ApplicationRuntime {
  app: Express;
  pipelineService: PipelineService;
  orchestratorService: HarnessOrchestratorService;
  startScheduler: () => void;
  stopScheduler: () => void;
}

export const createApplication = async (): Promise<ApplicationRuntime> => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  const oauthClient = new OAuthClient(config);
  const defenderClient = new DefenderClient(config, oauthClient);
  const graphClient = new GraphClient(config, oauthClient);
  const normalizeService = new NormalizeService();
  const mcpBridgeClient = new McpBridgeClient(config);
  const remediationService = new RemediationService(mcpBridgeClient);
  const snapshotStore = new SnapshotStoreService(config.dataDirectory);
  const powerBiExporter = new PowerBiExporterService(config);
  const piiMaskingService = new PiiMaskingService(config.piiMaskingSalt);
  const auditTrailService = new AuditTrailService(config, piiMaskingService);
  const metricsService = new HarnessMetricsService();
  const sentinelService = new SentinelOrchestrationService(config);
  const approvalService = new ApprovalService(config);

  const pipelineService = new PipelineService(
    config,
    defenderClient,
    graphClient,
    normalizeService,
    remediationService,
    snapshotStore,
    powerBiExporter
  );

  const orchestratorService = new HarnessOrchestratorService(
    config,
    pipelineService,
    metricsService,
    auditTrailService,
    sentinelService
  );

  await pipelineService.hydrateFromDisk();
  await approvalService.hydrate();

  app.use("/api/health", createHealthRouter(pipelineService, metricsService, approvalService));
  app.use("/api/powerbi", createPowerBiRouter(() => pipelineService.getLatestSnapshot()));
  app.use(
    "/api/harness",
    createHarnessRouter(
      config,
      approvalService,
      metricsService,
      orchestratorService,
      auditTrailService,
      sentinelService
    )
  );
  app.use(
    "/api/approvals",
    createApprovalsRouter(
      config,
      approvalService,
      orchestratorService,
      auditTrailService,
      sentinelService
    )
  );
  app.use(
    "/api/sentinel",
    createSentinelRouter(
      config,
      approvalService,
      orchestratorService,
      auditTrailService,
      sentinelService
    )
  );

  app.post("/api/admin/refresh", async (req, res) => {
    try {
      const role = resolveUserRole(req);
      const actorId = resolveUserId(req);
      const result = await orchestratorService.executeRefresh("manual-api-trigger", role, actorId);

      res.json({
        ok: true,
        traceId: result.traceId,
        collectedAt: result.collectedAt,
        recommendationCount: result.recommendationCount,
        durationMs: result.durationMs
      });
    } catch (error) {
      logger.error({ error }, "Manual refresh request failed");
      res.status(500).json({
        ok: false,
        message: "Refresh failed. Check logs for details."
      });
    }
  });

  let scheduledTask: ScheduledTask | null = null;

  const startScheduler = (): void => {
    if (scheduledTask) {
      return;
    }

    if (!cron.validate(config.refreshCron)) {
      throw new Error(`Invalid REFRESH_CRON value: ${config.refreshCron}`);
    }

    scheduledTask = cron.schedule(config.refreshCron, () => {
      void orchestratorService.executeRefresh("scheduled-cron", "System", "scheduler").catch((error: unknown) => {
        logger.error({ error }, "Scheduled refresh failed");
      });
    });

    logger.info({ cron: config.refreshCron }, "Refresh scheduler started");
  };

  const stopScheduler = (): void => {
    if (!scheduledTask) {
      return;
    }

    scheduledTask.stop();
    scheduledTask = null;
    logger.info("Refresh scheduler stopped");
  };

  return {
    app,
    pipelineService,
    orchestratorService,
    startScheduler,
    stopScheduler
  };
};
