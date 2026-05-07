import { createApplication } from "./app";
import { config } from "./config/env";
import { logger } from "./config/logger";

const start = async (): Promise<void> => {
  const runtime = await createApplication();
  const runOnce = process.argv.includes("--once");

  if (runOnce) {
    await runtime.orchestratorService.executeRefresh("one-shot-cli", "System", "cli");
    logger.info("One-time refresh completed successfully");
    return;
  }

  if (!runtime.pipelineService.getLatestSnapshot()) {
    try {
      await runtime.orchestratorService.executeRefresh("startup", "System", "startup");
    } catch (error) {
      logger.warn({ error }, "Startup refresh failed; API will run with no snapshot until next refresh");
    }
  }

  runtime.startScheduler();

  const server = runtime.app.listen(config.appPort, () => {
    logger.info({ port: config.appPort }, "Agentic Exposure and Secure Score Management Tool API is listening");
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "Shutdown signal received");
    runtime.stopScheduler();
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Force exiting after shutdown timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

void start().catch((error) => {
  logger.error({ error }, "Fatal startup error");
  process.exit(1);
});
