import { describe, expect, it } from "vitest";
import { isOptimizableImageUrl } from "./utils";

describe("image optimization URL policy", () => {
  it("keeps authenticated files and external URLs out of the image proxy", () => {
    expect(isOptimizableImageUrl("/uploads/materials/public.png")).toBe(true);
    expect(isOptimizableImageUrl("/api/files/materials/user/private.png")).toBe(
      false,
    );
    expect(isOptimizableImageUrl("https://example.test/image.png")).toBe(false);
  });
});
