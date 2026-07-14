import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function resolveComposeEnvFile(value?: string) {
  const configured = value?.trim() || process.env.PRODUCTION_ENV_FILE?.trim();
  if (configured) {
    const path = resolve(configured);
    if (!existsSync(path)) {
      throw new Error(`Compose environment file not found: ${path}`);
    }
    return path;
  }

  const defaultPath = resolve(".env.production");
  return existsSync(defaultPath) ? defaultPath : undefined;
}

export function composeCommandArgs(options: {
  project: string;
  composeFile: string;
  envFile?: string;
  service?: string;
  command: string[];
}) {
  return [
    "compose",
    ...(options.envFile ? ["--env-file", options.envFile] : []),
    "-p",
    options.project,
    "-f",
    options.composeFile,
    ...(options.service ? ["exec", "-T", options.service] : []),
    ...options.command,
  ];
}
