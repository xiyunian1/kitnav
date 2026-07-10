import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface PptMasterUpstreamVersion {
  repository: string;
  ref: string;
  commit: string;
  skillPath: string;
  treeSha: string;
  syncedAt: string;
}

const defaultSkillDir = resolve(process.cwd(), "scripts", "ppt-master");

export function getPptMasterSkillDir() {
  const configured = process.env.PPT_MASTER_SKILL_DIR;
  if (configured) return resolve(configured);

  return defaultSkillDir;
}

export function getPptMasterUpstreamVersion() {
  if (process.env.PPT_MASTER_SKILL_DIR) return null;
  const path = join(process.cwd(), "scripts", "ppt-master.upstream.json");
  if (!existsSync(path)) return null;

  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof value?.ref !== "string" ||
      typeof value?.commit !== "string" ||
      typeof value?.treeSha !== "string"
    ) {
      return null;
    }
    return value as PptMasterUpstreamVersion;
  } catch {
    return null;
  }
}
