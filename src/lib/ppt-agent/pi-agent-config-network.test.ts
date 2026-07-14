import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSafePublicApiUrl: vi.fn(),
  findProject: vi.fn(),
  findUserConfig: vi.fn(),
  findPlatformConfig: vi.fn(),
}));

vi.mock("@/lib/safe-fetch", () => ({
  assertSafePublicApiUrl: mocks.assertSafePublicApiUrl,
}));
vi.mock("@/lib/crypto", () => ({ decrypt: () => "decrypted-key" }));
vi.mock("@/lib/db", () => ({
  prisma: {
    pptProject: { findUnique: mocks.findProject },
    userApiConfig: { findUnique: mocks.findUserConfig },
    providerConfig: { findUnique: mocks.findPlatformConfig },
  },
}));

import {
  cleanupPptPiAgentConfig,
  preparePptPiAgentConfig,
  type PreparedPiAgentConfig,
} from "./pi-agent-config";

describe("PPT user provider network policy", () => {
  let prepared: PreparedPiAgentConfig | null = null;

  beforeEach(() => {
    prepared = null;
    mocks.assertSafePublicApiUrl.mockReset();
    mocks.assertSafePublicApiUrl.mockResolvedValue(
      new URL("https://api.example.com/v1"),
    );
    mocks.findProject.mockReset();
    mocks.findProject.mockResolvedValue({ usedOwnKey: true });
    mocks.findUserConfig.mockReset();
    mocks.findUserConfig.mockResolvedValue({
      baseUrl: "https://api.example.com/v1",
      apiKey: "encrypted-key",
      model: "ppt-model",
      models: JSON.stringify(["ppt-model"]),
      modelOptions: null,
      enabled: true,
    });
    mocks.findPlatformConfig.mockReset();
    mocks.findPlatformConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    if (prepared?.configDir && existsSync(prepared.configDir)) {
      cleanupPptPiAgentConfig(prepared);
    }
  });

  it("validates a user endpoint before writing Pi configuration", async () => {
    prepared = await preparePptPiAgentConfig({
      projectId: "project-1",
      userId: "user-1",
      modelSource: "user",
    });

    expect(mocks.assertSafePublicApiUrl).toHaveBeenCalledWith(
      "https://api.example.com/v1",
    );
    expect(prepared.source).toBe("user");
  });

  it("does not leave a config directory when validation fails", async () => {
    mocks.assertSafePublicApiUrl.mockRejectedValue(
      new Error("不支持访问内网或保留地址。"),
    );

    await expect(
      preparePptPiAgentConfig({
        projectId: "project-1",
        userId: "user-1",
        modelSource: "user",
      }),
    ).rejects.toThrow("内网");
    expect(prepared).toBeNull();
  });

  it("honors an explicit platform source for a zero-credit platform project", async () => {
    mocks.findPlatformConfig.mockResolvedValue({
      baseUrl: "https://platform.example.com/v1",
      apiKey: "encrypted-platform-key",
      model: "platform-model",
      models: JSON.stringify(["platform-model"]),
      modelMeta: null,
      modelOptions: null,
      enabled: true,
    });

    prepared = await preparePptPiAgentConfig({
      projectId: "project-1",
      userId: "user-1",
      model: "platform-model",
      modelSource: "platform",
    });

    expect(prepared.source).toBe("platform");
    expect(prepared.model).toBe("platform-model");
    expect(mocks.assertSafePublicApiUrl).not.toHaveBeenCalled();
  });
});
