import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import axios from "axios";
import type { AppConfig } from "../config/env";
import { logger } from "../config/logger";
import type {
  ApprovalActionType,
  ApprovalRequest,
  ApprovalStatus,
  UserRole
} from "../types/harness";

interface CreateApprovalInput {
  actionType: ApprovalActionType;
  requestedByRole: UserRole;
  requestedBy: string;
  reason: string;
  traceId: string;
  payload: Record<string, unknown>;
}

export class ApprovalService {
  private readonly filePath: string;
  private readonly approvals = new Map<string, ApprovalRequest>();

  public constructor(private readonly config: AppConfig) {
    this.filePath = path.join(this.config.dataDirectory, "memory", "approvals.json");
  }

  public async hydrate(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as ApprovalRequest[];
      parsed.forEach((request) => {
        this.approvals.set(request.id, request);
      });
      this.expireAgedRequests();
      await this.persist();
    } catch {
      await this.persist();
    }
  }

  public list(status?: ApprovalStatus): ApprovalRequest[] {
    const values = [...this.approvals.values()]
      .filter((item) => (status ? item.status === status : true))
      .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));

    return values;
  }

  public get(id: string): ApprovalRequest | null {
    return this.approvals.get(id) ?? null;
  }

  public async create(input: CreateApprovalInput): Promise<ApprovalRequest> {
    this.expireAgedRequests();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.approvalTtlMinutes * 60_000);

    const request: ApprovalRequest = {
      id: randomUUID(),
      actionType: input.actionType,
      requestedAt: now.toISOString(),
      requestedByRole: input.requestedByRole,
      requestedBy: input.requestedBy,
      reason: input.reason,
      traceId: input.traceId,
      status: "pending",
      expiresAt: expiresAt.toISOString(),
      payload: input.payload
    };

    this.approvals.set(request.id, request);
    await this.persist();
    await this.notifyTeams(request);

    return request;
  }

  public async approve(id: string, role: UserRole, actorId: string): Promise<ApprovalRequest> {
    this.expireAgedRequests();

    const request = this.approvals.get(id);
    if (!request) {
      throw new Error("Approval request not found");
    }

    if (request.status !== "pending") {
      throw new Error(`Approval request is not pending (status=${request.status})`);
    }

    request.status = "approved";
    request.approvedAt = new Date().toISOString();
    request.approvedByRole = role;
    request.approvedBy = actorId;

    this.approvals.set(id, request);
    await this.persist();

    return request;
  }

  public async reject(id: string, role: UserRole, actorId: string, reason: string): Promise<ApprovalRequest> {
    this.expireAgedRequests();

    const request = this.approvals.get(id);
    if (!request) {
      throw new Error("Approval request not found");
    }

    if (request.status !== "pending") {
      throw new Error(`Approval request is not pending (status=${request.status})`);
    }

    request.status = "rejected";
    request.approvedAt = new Date().toISOString();
    request.approvedByRole = role;
    request.approvedBy = actorId;
    request.rejectionReason = reason;

    this.approvals.set(id, request);
    await this.persist();

    return request;
  }

  public async markExecuted(id: string, outcome: "success" | "failed", details: string): Promise<void> {
    const request = this.approvals.get(id);
    if (!request) {
      return;
    }

    request.status = "executed";
    request.executionResult = {
      executedAt: new Date().toISOString(),
      outcome,
      details
    };

    this.approvals.set(id, request);
    await this.persist();
  }

  private expireAgedRequests(): void {
    const nowIso = new Date().toISOString();

    for (const [id, request] of this.approvals.entries()) {
      if (request.status === "pending" && request.expiresAt < nowIso) {
        request.status = "expired";
        request.rejectionReason = "Approval request expired";
        this.approvals.set(id, request);
      }
    }
  }

  private async persist(): Promise<void> {
    const targetDirectory = path.dirname(this.filePath);
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(this.filePath, JSON.stringify([...this.approvals.values()], null, 2), "utf-8");
  }

  private async notifyTeams(request: ApprovalRequest): Promise<void> {
    if (!this.config.teamsApprovalWebhookUrl) {
      return;
    }

    const message = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      summary: "Security action approval requested",
      themeColor: "0078D7",
      title: "Approval Required: Defender Health Hub",
      sections: [
        {
          facts: [
            {
              name: "Action",
              value: request.actionType
            },
            {
              name: "Requested By",
              value: `${request.requestedBy} (${request.requestedByRole})`
            },
            {
              name: "Reason",
              value: request.reason
            },
            {
              name: "Trace",
              value: request.traceId
            },
            {
              name: "Approval Id",
              value: request.id
            },
            {
              name: "Expires At",
              value: request.expiresAt
            }
          ]
        }
      ]
    };

    try {
      await axios.post(this.config.teamsApprovalWebhookUrl, message, {
        timeout: 15_000,
        headers: {
          "Content-Type": "application/json"
        }
      });
    } catch (error) {
      logger.warn(
        {
          errorMessage: error instanceof Error ? error.message : "Unknown error"
        },
        "Teams approval notification failed"
      );
    }
  }
}
