import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "scripts/ppt-master/**",
      "prisma/seed.ts",
      "tsconfig.tsbuildinfo",
    ],
  },
];

export default eslintConfig;
