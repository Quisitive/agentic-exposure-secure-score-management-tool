export type UserRole = "Reader" | "Operator" | "Approver" | "Admin";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed" | "expired";

export type ApprovalActionType =
  | "manual-refresh"
  | "sentinel-incident-refresh";

export interface ApprovalRequest {
  id: string;
  actionType: ApprovalActionType;
  requestedAt: string;
  requestedByRole: UserRole;
  requestedBy: string;
  reason: string;
  traceId: string;
  status: ApprovalStatus;
  expiresAt: string;
  approvedAt?: string;
  approvedByRole?: UserRole;
  approvedBy?: string;
  rejectionReason?: string;
  payload: Record<string, unknown>;
  executionResult?: {
    executedAt: string;
    outcome: "success" | "failed";
    details: string;
  };
}

export interface AuditEvent {
  id: string;
  traceId: string;
  timestamp: string;
  tenantId: string;
  category:
    | "refresh-start"
    | "refresh-success"
    | "refresh-failure"
    | "policy-violation"
    | "approval-requested"
    | "approval-created"
    | "approval-approved"
    | "approval-rejected"
    | "sentinel-incident-received"
    | "sentinel-inbound"
    | "sentinel-outbound";
  actorRole: UserRole | "System";
  actorId: string;
  payload: Record<string, unknown>;
}

export interface HarnessMetricsSnapshot {
  refreshSuccessCount: number;
  refreshFailureCount: number;
  policyViolationCount: number;
  averageRefreshMs: number;
  p95RefreshMs: number;
  lastRefreshAt: string | null;
  lastRefreshTraceId: string | null;
}

export interface RefreshExecutionResult {
  traceId: string;
  durationMs: number;
  trigger: string;
  collectedAt: string;
  recommendationCount: number;
}
