import { readFile, stat } from "node:fs/promises";

const sharedForbiddenInputs = [
  "node_modules/next-auth/",
  "node_modules/lucide-react/",
  "src/lib/auth.ts",
  "src/lib/auth.config.ts",
  "src/lib/auth-providers/",
];
const sharedForbiddenEnvironment = [
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "LINUX_DO_CLIENT_SECRET",
  "LINUX_DO_CREDIT_KEY",
  "METRICS_TOKEN",
  "POSTGRES_PASSWORD",
];
const bundles = [
  {
    name: "image Worker",
    bundle: ".next/image-worker.cjs",
    metafile: ".next/image-worker-meta.json",
    maxBytes: 2 * 1024 * 1024,
    forbiddenInputs: [
      ...sharedForbiddenInputs,
      "src/lib/module-controls.ts",
      "src/lib/modules.ts",
    ],
  },
  {
    name: "PPT Worker",
    bundle: ".next/ppt-worker.cjs",
    metafile: ".next/ppt-worker-meta.json",
    maxBytes: 2 * 1024 * 1024,
    forbiddenInputs: sharedForbiddenInputs,
  },
];

const failures = [];

for (const definition of bundles) {
  const [metadata, bundle, bundleStat] = await Promise.all([
    readFile(definition.metafile, "utf8").then(JSON.parse),
    readFile(definition.bundle, "utf8"),
    stat(definition.bundle),
  ]);
  const inputs = Object.keys(metadata.inputs ?? {});

  if (bundleStat.size > definition.maxBytes) {
    failures.push(
      `${definition.name} is ${bundleStat.size} bytes; limit is ${definition.maxBytes}`,
    );
  }
  for (const forbidden of definition.forbiddenInputs) {
    if (inputs.some((input) => input.includes(forbidden))) {
      failures.push(`${definition.name} contains forbidden input: ${forbidden}`);
    }
  }
  for (const variable of sharedForbiddenEnvironment) {
    if (bundle.includes(`process.env.${variable}`)) {
      failures.push(`${definition.name} reads forbidden environment variable: ${variable}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Worker bundle size, dependency, and secret boundaries are valid.");
}
