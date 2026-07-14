import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  runAuditedAdminTransaction,
  serializeAuditDetail,
  type AuditDatabase,
} from "./audit";

describe("serializeAuditDetail", () => {
  it("serializes structured data and bounds string details", () => {
    expect(serializeAuditDetail({ enabled: true })).toBe('{"enabled":true}');
    expect(serializeAuditDetail("x".repeat(2_100))).toHaveLength(2_000);
  });
});

describe("runAuditedAdminTransaction", () => {
  it("writes the mutation and audit entry through the same transaction", async () => {
    const tx = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: "admin-1" }) },
      adminAuditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
      setting: { update: vi.fn().mockResolvedValue({ key: "feature" }) },
    };
    const database = {
      $transaction: vi.fn(async (callback) => callback(tx as never)),
    } as AuditDatabase;

    await expect(
      runAuditedAdminTransaction(
        "admin-1",
        async (client) => client.setting.update({
          where: { key: "feature" },
          data: { value: "enabled" },
        }),
        { action: "setting.update", target: "feature" },
        database,
      ),
    ).resolves.toEqual({ key: "feature" });

    expect(database.$transaction).toHaveBeenCalledOnce();
    expect(tx.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        adminId: "admin-1",
        action: "setting.update",
        target: "feature",
        detail: undefined,
      },
    });
  });

  it("can skip audit creation when a conditional mutation changes nothing", async () => {
    const tx = {
      user: { findFirst: vi.fn().mockResolvedValue({ id: "admin-1" }) },
      adminAuditLog: { create: vi.fn() },
    };
    const database = {
      $transaction: vi.fn(async (callback) => callback(tx as never)),
    } as AuditDatabase;

    await runAuditedAdminTransaction(
      "admin-1",
      async () => false,
      (changed: boolean) =>
        changed ? { action: "resource.update" } : null,
      database,
    );

    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });

  it("rechecks administrator access inside the mutation transaction", async () => {
    const tx = {
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      adminAuditLog: { create: vi.fn() },
    };
    const database = {
      $transaction: vi.fn(async (callback) => callback(tx as never)),
    } as AuditDatabase;
    const mutation = vi.fn();

    await expect(
      runAuditedAdminTransaction(
        "admin-1",
        mutation,
        { action: "resource.update" },
        database,
      ),
    ).rejects.toThrow("管理员权限已失效");
    expect(mutation).not.toHaveBeenCalled();
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });
});
