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
});
