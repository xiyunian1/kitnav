export type AdminSeedEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type AdminSeedCredentials = {
  email: string;
  password: string;
  name: string;
};

function isPlaceholderPassword(password: string) {
  const normalized = password.toLowerCase();
  return (
    normalized.includes("replace") ||
    normalized.includes("example") ||
    normalized.includes("please-generate") ||
    normalized === "admin123456"
  );
}

export function resolveAdminSeedCredentials(
  env: AdminSeedEnvironment,
): AdminSeedCredentials | null {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const password = env.ADMIN_PASSWORD ?? "";

  if (!email && !password) return null;
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be configured together.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /@example\.(?:com|org|net)$/i.test(email)) {
    throw new Error("ADMIN_EMAIL must be a non-placeholder email address.");
  }
  if (password.length < 12 || isPlaceholderPassword(password)) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters and must not be a placeholder.");
  }

  return {
    email,
    password,
    name: env.ADMIN_NAME?.trim() || "管理员",
  };
}
