import { BlockList, isIP } from "node:net";

function parseEntries(value: string) {
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isIpAllowed(ip: string, configuredAllowlist: string) {
  const entries = parseEntries(configuredAllowlist);
  if (entries.length === 0) return true;

  const requestFamily = isIP(ip);
  if (requestFamily === 0) return false;

  const allowlist = new BlockList();
  for (const entry of entries) {
    const parts = entry.split("/");
    if (parts.length > 2) throw new Error("IP 白名单格式不正确");
    const address = parts[0] ?? "";
    const family = isIP(address);
    if (family === 0) throw new Error("IP 白名单包含无效地址");
    const type = family === 4 ? "ipv4" : "ipv6";

    if (parts.length === 1) {
      allowlist.addAddress(address, type);
      continue;
    }

    const prefix = Number(parts[1]);
    const maxPrefix = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      throw new Error("IP 白名单包含无效 CIDR 前缀");
    }
    allowlist.addSubnet(address, prefix, type);
  }

  return allowlist.check(ip, requestFamily === 4 ? "ipv4" : "ipv6");
}

export function isRequestIpAllowed(
  request: Request,
  configuredAllowlist: string,
) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
  return ip ? isIpAllowed(ip, configuredAllowlist) : !configuredAllowlist.trim();
}
