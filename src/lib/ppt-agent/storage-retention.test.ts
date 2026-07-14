import {
	access,
	mkdtemp,
	mkdir,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sweepPptStorageFiles } from "./storage-retention";

describe("PPT storage retention", () => {
	it("keeps active uploads and known projects while deleting stale orphans", async () => {
		const root = await mkdtemp(join(tmpdir(), "ppt-retention-"));
		const uploadRoot = join(root, "uploads");
		const projectRoot = join(root, "projects");
		const userDir = join(uploadRoot, "user-1");
		const activeUpload = join(userDir, "active.pptx");
		const staleUpload = join(userDir, "stale.pptx");
		const recentUpload = join(userDir, "recent.pptx");
		const knownProject = join(projectRoot, "known-project");
		const orphanProject = join(projectRoot, "orphan-project");
		const now = Date.now();
		const oldDate = new Date(now - 48 * 60 * 60 * 1000);

		try {
			await mkdir(userDir, { recursive: true });
			await mkdir(knownProject, { recursive: true });
			await mkdir(orphanProject, { recursive: true });
			await writeFile(activeUpload, "active");
			await writeFile(staleUpload, "stale");
			await writeFile(recentUpload, "recent");
			for (const path of [activeUpload, staleUpload, knownProject, orphanProject]) {
				await utimes(path, oldDate, oldDate);
			}

			const result = await sweepPptStorageFiles({
				uploadRoot,
				projectRoot,
				activeUploadPaths: new Set([activeUpload]),
				knownProjectIds: new Set(["known-project"]),
				now,
				uploadRetentionMs: 24 * 60 * 60 * 1000,
				orphanProjectRetentionMs: 24 * 60 * 60 * 1000,
			});

				expect(result).toEqual({
					uploadsRemoved: 1,
					uploadBytesRemoved: 5,
					projectDirsRemoved: 1,
					projectArtifactsRemoved: 0,
					projectArtifactBytesRemoved: 0,
				});
			expect(await pathExists(activeUpload)).toBe(true);
			expect(await pathExists(staleUpload)).toBe(false);
			expect(await pathExists(recentUpload)).toBe(true);
			expect(await pathExists(knownProject)).toBe(true);
			expect(await pathExists(orphanProject)).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

async function pathExists(path: string) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
