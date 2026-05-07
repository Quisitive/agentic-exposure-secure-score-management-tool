import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../types/harness";

const ROLE_ORDER: Record<UserRole, number> = {
  Reader: 1,
  Operator: 2,
  Approver: 3,
  Admin: 4
};

const normalizeRole = (value: string | undefined): UserRole => {
  if (!value) {
    return "Reader";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "operator") {
    return "Operator";
  }
  if (normalized === "approver") {
    return "Approver";
  }
  if (normalized === "admin") {
    return "Admin";
  }
  return "Reader";
};

export const resolveUserRole = (req: Request): UserRole => {
  const roleHeader = req.header("x-user-role") ?? undefined;
  return normalizeRole(roleHeader);
};

export const resolveUserId = (req: Request): string => {
  const actorHeader = req.header("x-user-id");
  if (!actorHeader || actorHeader.trim().length === 0) {
    return "unknown-actor";
  }
  return actorHeader.trim();
};

export const hasMinimumRole = (role: UserRole, minimumRole: UserRole): boolean => {
  return ROLE_ORDER[role] >= ROLE_ORDER[minimumRole];
};

export const requireMinimumRole = (minimumRole: UserRole) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = resolveUserRole(req);

    if (!hasMinimumRole(role, minimumRole)) {
      res.status(403).json({
        error: "forbidden",
        message: `Role ${minimumRole} or higher is required for this action.`,
        role
      });
      return;
    }

    next();
  };
};
