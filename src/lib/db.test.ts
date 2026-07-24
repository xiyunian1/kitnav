import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PrismaClientMock, resolvePrismaDatabaseUrlMock } = vi.hoisted(() => ({
  PrismaClientMock: vi.fn(function MockPrismaClient() {
    return { connected: true };
  }),
  resolvePrismaDatabaseUrlMock: vi.fn(
    () => "postgresql://user:password@postgres:5432/app",
  ),
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: PrismaClientMock,
}));

vi.mock("@/lib/database-url", () => ({
  resolvePrismaDatabaseUrl: resolvePrismaDatabaseUrlMock,
}));

const globalForTest = globalThis as typeof globalThis & {
  prisma?: unknown;
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  delete globalForTest.prisma;
  PrismaClientMock.mockClear();
  resolvePrismaDatabaseUrlMock.mockClear();
});

afterEach(() => {
  delete globalForTest.prisma;
  vi.unstubAllEnvs();
});

describe("Prisma client lifecycle", () => {
  it("reuses one client when production modules are evaluated repeatedly", async () => {
    const firstModule = await import("./db");
    vi.resetModules();
    const secondModule = await import("./db");

    expect(secondModule.prisma).toBe(firstModule.prisma);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    expect(resolvePrismaDatabaseUrlMock).toHaveBeenCalledTimes(1);
  });
});
