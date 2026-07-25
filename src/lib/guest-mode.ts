export const GUEST_PROVIDER_ID = "guest";
export const GUEST_USER_ID = "guest-showcase";
export const GUEST_USER_EMAIL = "visitor@guest.kitnav.invalid";
export const GUEST_MODE_MESSAGE =
  "游客模式仅供参观，请登录正式账号后使用。";

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isGuestModeEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env.GUEST_MODE_ENABLED === "true";
}

export function isGuestRole(role: unknown): role is "GUEST" {
  return role === "GUEST";
}

export function isGuestUserEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() === GUEST_USER_EMAIL;
}

export function isSafeHttpMethod(method: string) {
  return SAFE_HTTP_METHODS.has(method.toUpperCase());
}

export function isAuthApiPath(pathname: string) {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

export function shouldBlockGuestRequest(input: {
  role: unknown;
  method: string;
  pathname: string;
}) {
  if (!isGuestRole(input.role)) return false;
  if (isAuthApiPath(input.pathname)) return false;
  return !isSafeHttpMethod(input.method);
}

export function shouldEvictGuestSession(
  input: { role: unknown; pathname: string },
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (!isGuestRole(input.role)) return false;
  if (isGuestModeEnabled(env)) return false;
  return !isAuthApiPath(input.pathname);
}
