import { describe, expect, it } from "vitest";
import {
  abortAllPptGenerationsForShutdown,
  isPptGenerationCancelled,
  isPptWorkerShutdown,
  registerPptGeneration,
  throwIfPptCancelled,
} from "./cancellation";

describe("PPT worker shutdown cancellation", () => {
  it("aborts active jobs with a restart-specific reason", () => {
    const controller = new AbortController();
    const unregister = registerPptGeneration("project-1", controller);

    expect(abortAllPptGenerationsForShutdown()).toContain("project-1");
    expect(controller.signal.aborted).toBe(true);
    expect(() => throwIfPptCancelled(controller.signal)).toThrow("worker 正在重启");
    try {
      throwIfPptCancelled(controller.signal);
    } catch (error) {
      expect(isPptWorkerShutdown(error)).toBe(true);
      expect(isPptGenerationCancelled(error)).toBe(false);
    }
    unregister();
  });
});
