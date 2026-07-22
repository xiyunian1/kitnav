import { describe, expect, it } from "vitest";
import { supportsNativeMultiImageEdit } from "./image-edit-capabilities";

describe("supportsNativeMultiImageEdit", () => {
  it.each([
    "gpt-image-2",
    "gpt-image-2-2026-04-21",
    "gpt-image-1.5",
    "gpt-image-1.5-2025-12-16",
    "gpt-image-1",
    "gpt-image-1-2025-04-01",
    "gpt-image-1-mini",
    "gpt-image-1-mini-2025-10-06",
    "chatgpt-image-latest",
    " GPT-IMAGE-2 ",
  ])("accepts a known native multi-image model: %s", (model) => {
    expect(supportsNativeMultiImageEdit(model)).toBe(true);
  });

  it.each([
    "gpt-image-3",
    "gpt-image-2-preview",
    "gpt-image-2-2026-4-21",
    "gpt-image-1.5-custom",
    "chatgpt-image-latest-2026-01-01",
    "dall-e-2",
    "flux-pro",
    "",
  ])("rejects an unknown or ambiguous model: %s", (model) => {
    expect(supportsNativeMultiImageEdit(model)).toBe(false);
  });
});
