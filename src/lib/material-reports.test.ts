import { describe, expect, it, vi } from "vitest";
import {
  createMaterialReport,
  type MaterialReportDatabase,
} from "./material-reports";

function createDatabase(options: {
  ownerId?: string | null;
  existingReport?: boolean;
}) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    material: {
      findFirst: vi.fn().mockResolvedValue(
        options.ownerId === undefined ? null : { ownerId: options.ownerId },
      ),
    },
    materialReport: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options.existingReport ? { id: "report-1" } : null),
      create: vi.fn().mockResolvedValue({ id: "report-2" }),
    },
  };
  const database = {
    $transaction: vi.fn(async (callback) => callback(tx as never)),
  } as MaterialReportDatabase;
  return { database, tx };
}

const input = {
  materialId: "material-1",
  reporterId: "user-1",
  reason: "侵权内容",
};

describe("createMaterialReport", () => {
  it("rejects missing and self-owned materials", async () => {
    const missing = createDatabase({});
    await expect(createMaterialReport(input, missing.database)).resolves.toBe(
      "not-found",
    );

    const own = createDatabase({ ownerId: "user-1" });
    await expect(createMaterialReport(input, own.database)).resolves.toBe(
      "own-material",
    );
    expect(own.tx.materialReport.create).not.toHaveBeenCalled();
  });

  it("does not create a second open report", async () => {
    const { database, tx } = createDatabase({
      ownerId: "user-2",
      existingReport: true,
    });

    await expect(createMaterialReport(input, database)).resolves.toBe(
      "already-reported",
    );
    expect(tx.materialReport.create).not.toHaveBeenCalled();
  });

  it("creates the report while holding the per-user material lock", async () => {
    const { database, tx } = createDatabase({ ownerId: "user-2" });

    await expect(createMaterialReport(input, database)).resolves.toBe("created");
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.materialReport.create).toHaveBeenCalledWith({
      data: input,
    });
  });
});
