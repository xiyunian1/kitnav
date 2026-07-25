import { handlers } from "@/lib/auth";
import type { NextRequest } from "next/server";
import {
  enforceIpRequestLimit,
  enforceOpaqueValueLimit,
  REQUEST_LIMITS,
} from "@/lib/request-limits";
import { AUTH_INPUT_LIMITS } from "@/lib/auth-inputs";
import { GUEST_PROVIDER_ID } from "@/lib/guest-mode";

export const GET = handlers.GET;

export async function POST(request: NextRequest) {
  const pathname = new URL(request.url).pathname;
  if (
    pathname.endsWith("/callback/credentials") ||
    pathname.endsWith(`/callback/${GUEST_PROVIDER_ID}`)
  ) {
    const limited = await enforceIpRequestLimit(request, REQUEST_LIMITS.login);
    if (limited) return limited;

    let normalizedEmail: string | null = null;
    if (pathname.endsWith("/callback/credentials")) {
      try {
        const form = await request.clone().formData();
        const email = form.get("email");
        if (
          typeof email === "string" &&
          email.length <= AUTH_INPUT_LIMITS.emailCharacters
        ) {
          normalizedEmail = email.trim().toLowerCase() || null;
        }
      } catch {
        // Auth.js will return its normal invalid-request response for malformed bodies.
      }
    }
    if (normalizedEmail) {
      const accountLimited = await enforceOpaqueValueLimit(
        normalizedEmail,
        REQUEST_LIMITS.loginAccount,
      );
      if (accountLimited) return accountLimited;
    }
  }
  return handlers.POST(request);
}
