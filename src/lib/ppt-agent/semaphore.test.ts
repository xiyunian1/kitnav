import { describe, expect, it } from "vitest";
import { getPptConcurrencyLimit, Semaphore } from "./semaphore";

describe("PPT semaphore", () => {
  it("normalizes the configured concurrency limit", () => {
    expect(getPptConcurrencyLimit({})).toBe(3);
    expect(getPptConcurrencyLimit({ PPT_AGENT_MAX_CONCURRENT: "invalid" })).toBe(3);
    expect(getPptConcurrencyLimit({ PPT_AGENT_MAX_CONCURRENT: "0" })).toBe(3);
    expect(getPptConcurrencyLimit({ PPT_AGENT_MAX_CONCURRENT: "4.9" })).toBe(4);
    expect(getPptConcurrencyLimit({ PPT_AGENT_MAX_CONCURRENT: "100" })).toBe(10);
  });

  it("releases queued callers in order", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();
    let acquired = false;
    const waiting = semaphore.acquire().then(() => {
      acquired = true;
    });

    await Promise.resolve();
    expect(acquired).toBe(false);
    semaphore.release();
    await waiting;
    expect(acquired).toBe(true);
    expect(semaphore.getCurrent()).toBe(1);
    semaphore.release();
    expect(semaphore.getCurrent()).toBe(0);
  });
});
