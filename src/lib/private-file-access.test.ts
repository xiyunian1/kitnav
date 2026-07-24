import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  materialFindFirst: vi.fn(),
  imageTurnFindMany: vi.fn(),
  feedbackFindFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    material: { findFirst: mocks.materialFindFirst },
    imageTurn: { findMany: mocks.imageTurnFindMany },
    feedback: { findFirst: mocks.feedbackFindFirst },
  },
}));

import { serveFeedbackFile } from "./feedback-file-access";
import { serveMaterialFile } from "./material-file-access";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);

let materialRoot = "";
let feedbackRoot = "";

beforeEach(async () => {
  materialRoot = await mkdtemp(join(tmpdir(), "private-material-files-"));
  feedbackRoot = await mkdtemp(join(tmpdir(), "private-feedback-files-"));
  process.env.MATERIAL_UPLOAD_ROOT = materialRoot;
  process.env.FEEDBACK_UPLOAD_ROOT = feedbackRoot;
  await mkdir(join(materialRoot, "user_1"), { recursive: true });
  await mkdir(join(feedbackRoot, "user_1"), { recursive: true });
  await writeFile(join(materialRoot, "user_1", "private.png"), PNG);
  await writeFile(join(feedbackRoot, "user_1", "feedback.png"), PNG);
  mocks.auth.mockResolvedValue(null);
  mocks.materialFindFirst.mockResolvedValue(null);
  mocks.imageTurnFindMany.mockResolvedValue([]);
  mocks.feedbackFindFirst.mockResolvedValue(null);
});

afterEach(async () => {
  vi.clearAllMocks();
  delete process.env.MATERIAL_UPLOAD_ROOT;
  delete process.env.FEEDBACK_UPLOAD_ROOT;
  await Promise.all([
    rm(materialRoot, { recursive: true, force: true }),
    rm(feedbackRoot, { recursive: true, force: true }),
  ]);
});

describe("private file access", () => {
  it("hides private material files from anonymous and unrelated users", async () => {
    await expect(
      serveMaterialFile("user_1/private.png"),
    ).resolves.toHaveProperty("status", 404);

    mocks.auth.mockResolvedValue({ user: { id: "user_2", role: "USER" } });
    await expect(
      serveMaterialFile("user_1/private.png"),
    ).resolves.toHaveProperty("status", 404);
  });

  it("serves material files to their owner and administrators", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1", role: "USER" } });
    mocks.materialFindFirst.mockResolvedValue({ id: "material_1" });
    const ownerResponse = await serveMaterialFile("user_1/private.png");
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await ownerResponse.arrayBuffer())).toEqual(PNG);

    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    const adminResponse = await serveMaterialFile("user_1/private.png", {
      head: true,
    });
    expect(adminResponse.status).toBe(200);
    expect(await adminResponse.text()).toBe("");
  });

  it("serves only unexpired generated files that remain in image history", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1", role: "USER" } });
    mocks.imageTurnFindMany.mockResolvedValue([
      {
        images: JSON.stringify([
          {
            url: "/api/files/materials/user_1/private.png",
          },
        ]),
      },
    ]);

    await expect(
      serveMaterialFile("user_1/private.png", { head: true }),
    ).resolves.toHaveProperty("status", 200);

    mocks.imageTurnFindMany.mockResolvedValue([]);
    await expect(
      serveMaterialFile("user_1/private.png", { head: true }),
    ).resolves.toHaveProperty("status", 404);
  });

  it("allows approved public material files without a session", async () => {
    mocks.materialFindFirst.mockResolvedValue({ id: "material_1" });
    const response = await serveMaterialFile("user_1/private.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, must-revalidate",
    );
  });

  it("serves a legacy shared cover referenced by the user's material", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_2", role: "USER" } });
    mocks.materialFindFirst.mockResolvedValueOnce({ id: "copied_prompt" });

    const response = await serveMaterialFile("user_1/private.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("restricts feedback screenshots to the submitter and administrators", async () => {
    await expect(
      serveFeedbackFile("user_1/feedback.png"),
    ).resolves.toHaveProperty("status", 404);

    mocks.auth.mockResolvedValue({ user: { id: "user_1", role: "USER" } });
    await expect(
      serveFeedbackFile("user_1/feedback.png"),
    ).resolves.toHaveProperty("status", 200);

    mocks.auth.mockResolvedValue({ user: { id: "user_2", role: "USER" } });
    await expect(
      serveFeedbackFile("user_1/feedback.png"),
    ).resolves.toHaveProperty("status", 404);

    mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    await expect(
      serveFeedbackFile("user_1/feedback.png"),
    ).resolves.toHaveProperty("status", 200);
  });

  it("rejects traversal and unsupported file types as not found", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1", role: "USER" } });
    await expect(
      serveMaterialFile("user_1/../private.png"),
    ).resolves.toHaveProperty("status", 404);
    await writeFile(join(materialRoot, "user_1", "payload.html"), "html");
    await expect(
      serveMaterialFile("user_1/payload.html"),
    ).resolves.toHaveProperty("status", 404);
  });
});
