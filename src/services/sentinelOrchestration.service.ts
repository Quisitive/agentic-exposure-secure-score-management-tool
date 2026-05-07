import axios from "axios";
import type { AppConfig } from "../config/env";
import { logger } from "../config/logger";

export class SentinelOrchestrationService {
  public constructor(private readonly config: AppConfig) {}

  public isInboundAuthorized(secretHeader: string | undefined): boolean {
    if (!this.config.sentinelBidirectionalEnabled) {
      return false;
    }

    if (!this.config.sentinelInboundSecret) {
      return false;
    }

    return secretHeader === this.config.sentinelInboundSecret;
  }

  public async publishEvent(
    eventType: string,
    traceId: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!this.config.sentinelOutboundWebhookUrl) {
      return;
    }

    try {
      await axios.post(
        this.config.sentinelOutboundWebhookUrl,
        {
          eventType,
          traceId,
          tenantId: this.config.tenantId,
          timestamp: new Date().toISOString(),
          payload
        },
        {
          timeout: 20_000,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    } catch (error) {
      logger.warn(
        {
          errorMessage: error instanceof Error ? error.message : "Unknown error"
        },
        "Failed to publish event to Sentinel outbound webhook"
      );
    }
  }
}
