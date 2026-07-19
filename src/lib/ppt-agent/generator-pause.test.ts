import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	projectDir: "",
	acquire: vi.fn(),
	release: vi.fn(),
	runAgent: vi.fn(),
	resolveSource: vi.fn(),
	updateProject: vi.fn(),
	emitLog: vi.fn(),
	assertPython: vi.fn(),
}));

vi.mock("./semaphore", () => ({
	pptSemaphore: { acquire: mocks.acquire, release: mocks.release },
}));
vi.mock("./paths", () => ({
	getPptProjectDir: () => mocks.projectDir,
	publicProjectUrl: vi.fn(),
}));
vi.mock("./agent-runner", () => ({ runPptMasterAgent: mocks.runAgent }));
vi.mock("./project-utils", () => ({
	clampSlideCount: (value: number) => value,
	ensureProjectStructure: (projectDir: string) => {
		mkdirSync(join(projectDir, "sources"), { recursive: true });
	},
	resolveSourceMarkdown: mocks.resolveSource,
}));
vi.mock("./styles", () => ({
	buildPptStyleInstruction: () => "",
	getPptStyleLabel: () => "自动",
}));
vi.mock("./artifacts", () => ({ collectPptArtifactPaths: vi.fn() }));
vi.mock("./templates", () => ({ preparePptTemplateSelection: () => "" }));
vi.mock("./project-log", () => ({
	emitProjectLog: mocks.emitLog,
	isPptLeaseLostError: () => false,
	updateProject: mocks.updateProject,
}));
vi.mock("./python-tools", () => ({ assertPptPythonRuntime: mocks.assertPython }));
vi.mock("./workflow", () => ({
	resolvePptGenerationWorkflow: () => "svg",
	stageNativePptTemplate: vi.fn(),
}));

import { generatePPT } from "./generator";
import { PptPlanningConfirmationRequiredError } from "./planning-confirmation";

const roots: string[] = [];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.projectDir = mkdtempSync(join(tmpdir(), "ppt-generator-pause-"));
	roots.push(mocks.projectDir);
	mocks.acquire.mockResolvedValue(undefined);
	mocks.resolveSource.mockResolvedValue("# source");
	mocks.assertPython.mockResolvedValue(undefined);
	mocks.emitLog.mockResolvedValue(undefined);
	mocks.updateProject.mockResolvedValue(undefined);
	mocks.runAgent.mockRejectedValue(new PptPlanningConfirmationRequiredError());
});

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("generatePPT planning pause", () => {
	it("releases the worker slot and pauses without marking the project failed", async () => {
		await expect(
			generatePPT(
				{
					projectId: "project-1",
					userId: "user-1",
					workerLease: "lease-1",
					sourceType: "markdown",
					sourceMarkdown: "# source",
					slideCount: 10,
					confirmDesign: true,
				},
				() => undefined,
			),
		).rejects.toBeInstanceOf(PptPlanningConfirmationRequiredError);

		expect(mocks.updateProject).toHaveBeenCalledWith(
			"project-1",
			expect.objectContaining({
				status: "AWAITING_CONFIRMATION",
				workerLease: null,
				error: null,
			}),
			"lease-1",
		);
		expect(
			mocks.updateProject.mock.calls.some(
				([, data]) => (data as { status?: string }).status === "FAILED",
			),
		).toBe(false);
		expect(mocks.release).toHaveBeenCalledOnce();
	});
});
