import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSafeArchiveEntryTypes,
  assertSafeArchiveEntries,
  verifyBackupSnapshot,
} from "../../scripts/backup-snapshot-utils";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "backup-snapshot-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("backup snapshot verification", () => {
  it("accepts a checksummed PostgreSQL custom archive", async () => {
    const database = Buffer.from("PGDMPintegration-test");
    await writeFile(join(root, "database.dump"), database);
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({
        version: 2,
        createdAt: new Date().toISOString(),
        postgres: {
          database: "test",
          service: "postgres",
          format: "custom",
          bytes: database.length,
          sha256: createHash("sha256").update(database).digest("hex"),
        },
        files: { included: [], bytes: 0, sha256: null },
      }),
    );

    await expect(verifyBackupSnapshot(root)).resolves.toMatchObject({ root });
  });

  it("rejects a tampered archive", async () => {
    const database = Buffer.from("PGDMPintegration-test");
    await writeFile(join(root, "database.dump"), database);
    await writeFile(
      join(root, "manifest.json"),
      JSON.stringify({
        version: 2,
        createdAt: new Date().toISOString(),
        postgres: {
          database: "test",
          service: "postgres",
          format: "custom",
          bytes: database.length,
          sha256: "0".repeat(64),
        },
        files: { included: [], bytes: 0, sha256: null },
      }),
    );

    await expect(verifyBackupSnapshot(root)).rejects.toThrow("checksum mismatch");
  });

  it("rejects an oversized manifest before parsing it", async () => {
    await writeFile(join(root, "manifest.json"), " ".repeat(64 * 1024 + 1));

    await expect(verifyBackupSnapshot(root)).rejects.toThrow("too large");
  });

  it("rejects traversal and unexpected archive entries", () => {
    expect(() =>
      assertSafeArchiveEntries("uploads/a.png\nppt-projects/a/deck.pptx\n", [
        "uploads",
        "ppt-projects",
      ]),
    ).not.toThrow();
    expect(() =>
      assertSafeArchiveEntries("uploads/../../etc/passwd\n", ["uploads"]),
    ).toThrow("Unsafe");
    expect(() =>
      assertSafeArchiveEntries("unknown/file\n", ["uploads"]),
    ).toThrow("Unexpected");
    expect(() =>
      assertSafeArchiveEntryTypes(
        "drwx------ user/group 0 date uploads/\n-rw------- user/group 1 date uploads/a\n",
      ),
    ).not.toThrow();
    expect(() =>
      assertSafeArchiveEntryTypes(
        "lrwxr-xr-x user/group 0 date uploads/link -> /etc/passwd\n",
      ),
    ).toThrow("link or special");
  });
});
