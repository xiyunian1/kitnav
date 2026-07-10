import { describe, expect, it } from "vitest";
import {
  buildModuleModelOptions,
  findModuleModelOption,
  moduleModelValue,
} from "@/lib/module-model-options";

describe("buildModuleModelOptions", () => {
  it("keeps same-named user and platform models as distinct options", () => {
    const options = buildModuleModelOptions([
      {
        source: "user",
        enabled: true,
        model: "shared-model",
        models: JSON.stringify(["shared-model", "user-only"]),
      },
      {
        source: "platform",
        enabled: true,
        model: "shared-model",
        models: JSON.stringify(["shared-model", "platform-only"]),
      },
    ]);

    expect(options.map((option) => option.value)).toEqual([
      "user:shared-model",
      "user:user-only",
      "platform:shared-model",
      "platform:platform-only",
    ]);
    expect(findModuleModelOption(options, "shared-model", "user")?.sourceLabel).toBe(
      "我的 API",
    );
    expect(findModuleModelOption(options, "shared-model", "platform")?.sourceLabel).toBe(
      "平台",
    );
  });

  it("filters disabled platform models and preserves their billing metadata", () => {
    const options = buildModuleModelOptions([
      {
        source: "platform",
        enabled: true,
        model: "enabled-model",
        models: JSON.stringify(["enabled-model", "disabled-model"]),
        modelMeta: {
          "enabled-model": { creditCost: 12, note: "高清模型" },
          "disabled-model": { enabled: false, creditCost: 1 },
        },
        visionModels: ["enabled-model"],
      },
    ]);

    expect(options).toEqual([
      {
        value: "platform:enabled-model",
        model: "enabled-model",
        source: "platform",
        sourceLabel: "平台",
        creditCost: 12,
        supportsVision: true,
        note: "高清模型",
      },
    ]);
  });

  it("omits disabled configs and falls back to the legacy model field", () => {
    const options = buildModuleModelOptions([
      {
        source: "user",
        enabled: false,
        model: "hidden-user-model",
      },
      {
        source: "platform",
        enabled: true,
        model: "legacy-platform-model",
      },
    ]);

    expect(options).toHaveLength(1);
    expect(options[0]?.value).toBe(moduleModelValue("platform", "legacy-platform-model"));
    expect(options[0]?.supportsVision).toBe(false);
  });
});
