import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export interface ActivatedFileRoot {
  destination: string;
  previous: string | null;
}

async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function activateRestoredFileRoots(options: {
  includedPaths: string[];
  stagingDir: string;
  dataDir: string;
  stamp: string;
}) {
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
  const activated: ActivatedFileRoot[] = [];

  try {
    for (const path of options.includedPaths) {
      const source = join(options.stagingDir, path);
      const destination = join(options.dataDir, path);
      const previous = (await exists(destination))
        ? `${destination}.pre-restore-${options.stamp}`
        : null;
      if (previous && (await exists(previous))) {
        throw new Error(`Restore rollback path already exists: ${previous}`);
      }
      if (previous) await rename(destination, previous);

      const entry = { destination, previous };
      activated.push(entry);
      await rename(source, destination);
    }
    return activated;
  } catch (error) {
    try {
      await rollbackRestoredFileRoots(activated);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Restored file activation failed and rollback was incomplete",
      );
    }
    throw error;
  }
}

export async function rollbackRestoredFileRoots(
  activated: ActivatedFileRoot[],
) {
  const errors: unknown[] = [];
  for (const entry of [...activated].reverse()) {
    try {
      await rm(entry.destination, { recursive: true, force: true });
      if (entry.previous && (await exists(entry.previous))) {
        await rename(entry.previous, entry.destination);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Could not roll back restored file roots");
  }
}

export async function activateStagingDatabase(options: {
  targetExists: boolean;
  renameTargetToPrevious: () => Promise<void>;
  activateStaging: () => Promise<void>;
  restorePrevious: () => Promise<void>;
}) {
  let previousRenamed = false;
  try {
    if (options.targetExists) {
      await options.renameTargetToPrevious();
      previousRenamed = true;
    }
    await options.activateStaging();
  } catch (error) {
    if (!previousRenamed) throw error;
    try {
      await options.restorePrevious();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Database activation failed and the previous database could not be restored",
      );
    }
    throw error;
  }
}
