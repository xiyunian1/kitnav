import type { OAuthConfig, OAuthUserConfig } from "next-auth/providers";

const DEFAULT_LINUX_DO_ISSUER = "https://connect.linux.do/";

export interface LinuxDoProfile {
  sub?: string | null;
  id: number | string;
  login?: string | null;
  username?: string | null;
  preferred_username?: string | null;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  picture?: string | null;
  avatar_template?: string | null;
  active?: boolean;
  trust_level?: number;
  silenced?: boolean;
  external_ids?: unknown;
  api_key?: string;
}

export function normalizeLinuxDoIssuer(value?: string | null) {
  const issuer = value?.trim() || DEFAULT_LINUX_DO_ISSUER;
  return `${issuer.replace(/\/+$/, "")}/`;
}

function normalizeLinuxDoAvatar(avatarTemplate?: string | null) {
  if (!avatarTemplate) return null;
  const url = avatarTemplate.replace("{size}", "288");
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

export default function LinuxDo<P extends LinuxDoProfile>(
  options: OAuthUserConfig<P>
): OAuthConfig<P> {
  return {
    id: "linux-do",
    name: "Linux.do",
    type: "oidc",
    issuer: normalizeLinuxDoIssuer(process.env.LINUX_DO_ISSUER),
    authorization:
      process.env.LINUX_DO_AUTHORIZATION_ENDPOINT ??
      "https://connect.linux.do/oauth2/authorize",
    token:
      process.env.LINUX_DO_TOKEN_ENDPOINT ??
      "https://connect.linux.do/oauth2/token",
    userinfo:
      process.env.LINUX_DO_USER_ENDPOINT ??
      "https://connect.linux.do/api/user",
    checks: ["state"],
    client: { token_endpoint_auth_method: "client_secret_basic" },
    profile(profile) {
      const id = String(profile.sub ?? profile.id);
      const username =
        profile.username?.trim() ||
        profile.login?.trim() ||
        profile.preferred_username?.trim();
      const name = profile.name?.trim() || username || `Linux.do ${id}`;
      const image =
        profile.avatar_url ||
        profile.picture ||
        normalizeLinuxDoAvatar(profile.avatar_template);

      return {
        id,
        name,
        email: profile.email?.trim() || `linuxdo-${id}@linuxdo.local`,
        image,
      };
    },
    style: {
      brandColor: "#1d4ed8",
      logo: "https://linux.do/uploads/default/original/3X/9/d/9dd49731091ce8656e94433a26a3ef36062b3994.png",
    },
    options,
  };
}
