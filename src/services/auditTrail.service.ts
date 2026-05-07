import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import type { AppConfig } from "../config/env";
import { logger } from "../config/logger";
import type { AuditEvent } from "../types/harness";
import { PiiMaskingService } from "./piiMasking.service";

const isUsRegion = (region: string): boolean => {
  const normalized = region.trim().toLowerCase();
  return normalized.includes("us") || normalized.startsWith("east") || normalized.startsWith("west");
};

export class AuditTrailService {
  private containerClient: ContainerClient | null = null;

  public constructor(
    private readonly config: AppConfig,
    private readonly piiMaskingService: PiiMaskingService
  ) {
    if (
      this.config.enforceUsResidency &&
      this.config.azureBlobRegion.trim().length > 0 &&
      !isUsRegion(this.config.azureBlobRegion)
    ) {
      throw new Error("Azure Blob region must be US-based when ENFORCE_US_RESIDENCY is enabled.");
    }
  }

  public async record(event: AuditEvent): Promise<void> {
    const maskedEvent = {
      ...event,
      payload: this.piiMaskingService.mask(event.payload),
      retentionYears: this.config.retentionYears
    };

    await this.writeLocal(maskedEvent);
    await this.writeBlob(maskedEvent);
  }

  private async writeLocal(event: Record<string, unknown>): Promise<void> {
    const now = new Date();
    const auditDirectory = path.join(this.config.dataDirectory, "audit");
    const fileName = `audit-${now.toISOString().slice(0, 10)}.jsonl`;
    const filePath = path.join(auditDirectory, fileName);

    await mkdir(auditDirectory, { recursive: true });
    await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf-8");
  }

  private async writeBlob(event: Record<string, unknown>): Promise<void> {
    if (
      !this.config.azureBlobConnectionString ||
      !this.config.azureBlobContainer
    ) {
      return;
    }

    try {
      if (!this.containerClient) {
        const blobServiceClient = BlobServiceClient.fromConnectionString(
          this.config.azureBlobConnectionString
        );

        this.containerClient = blobServiceClient.getContainerClient(
          this.config.azureBlobContainer
        );

        await this.containerClient.createIfNotExists();
      }

      const timestamp = new Date();
      const year = String(timestamp.getUTCFullYear());
      const month = String(timestamp.getUTCMonth() + 1).padStart(2, "0");
      const day = String(timestamp.getUTCDate()).padStart(2, "0");
      const blobName = `${this.config.tenantId}/audit/${year}/${month}/${day}/${String(event.id)}.json`;

      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.uploadData(Buffer.from(JSON.stringify(event), "utf-8"), {
        metadata: {
          tenant: this.config.tenantId,
          retentionYears: String(this.config.retentionYears),
          region: this.config.azureBlobRegion || "unspecified"
        }
      });
    } catch (error) {
      logger.warn(
        {
          errorMessage: error instanceof Error ? error.message : "Unknown error"
        },
        "Azure Blob archival failed for audit event"
      );
    }
  }
}
