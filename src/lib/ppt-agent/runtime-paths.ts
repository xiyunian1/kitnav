import { resolve } from "path";

export function getPptMasterSkillDir() {
  const configured = process.env.PPT_MASTER_SKILL_DIR;
  if (configured) return resolve(configured);

  const parts = [
    process.cwd(),
    "scripts",
    "ppt-master",
  ];
  return resolve(...parts);
}
