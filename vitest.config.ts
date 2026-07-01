import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
	resolve: {
		alias: {
			// 与 tsconfig.json 的 paths 保持一致，测试代码可直接用 @/lib/... 导入。
			"@": path.resolve(__dirname, "src"),
		},
	},
	test: {
		// 仅在 src 下收集测试，避免扫描 scripts/ppt-master 等。
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
});
