import { describe, expect, it } from "vitest";
import { hasPptxArtifact, toPublicPptProject } from "./project-public";

describe("public PPT project data", () => {
  it("exposes availability without leaking the server path", () => {
    const project = toPublicPptProject({
      id: "project_1",
      title: "测试项目",
      pptxPath: "/app/data/ppt-projects/project_1/deck.pptx",
      artifactsDeletedAt: null,
    });

    expect(project).toEqual({
      id: "project_1",
      title: "测试项目",
      artifactsDeletedAt: null,
      confirmationWaitDurationMs: 0,
      confirmationWaitStartedAt: null,
      hasPptx: true,
    });
    expect(project).not.toHaveProperty("pptxPath");
  });

  it("marks expired or missing artifacts unavailable", () => {
    expect(
      hasPptxArtifact({
        pptxPath: "/private/deck.pptx",
        artifactsDeletedAt: new Date(),
      }),
    ).toBe(false);
    expect(hasPptxArtifact({ pptxPath: null })).toBe(false);
  });

  it("exposes normalized confirmation timing without leaking logs", () => {
    const project = toPublicPptProject({
      id: "project_2",
      pptxPath: null,
      logs: [
        "[2026-07-21T01:00:00.000Z] 设计方案候选已生成，等待用户确认后继续",
        "[2026-07-21T01:04:34.000Z] 用户已确认设计方案，原任务重新入队",
      ].join("\n"),
      confirmationWaitSeconds: 274,
      confirmationWaitStartedAt: null,
    });

    expect(project.confirmationWaitDurationMs).toBe(274_000);
    expect(project).not.toHaveProperty("logs");
    expect(project).not.toHaveProperty("confirmationWaitSeconds");
  });
});
