import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { isGuestModeEnabled } from "@/lib/guest-mode";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const linuxDoEnabled = Boolean(
    process.env.LINUX_DO_CLIENT_ID && process.env.LINUX_DO_CLIENT_SECRET
  );
  const guestModeEnabled = isGuestModeEnabled();

  return (
    <Suspense fallback={null}>
      <LoginForm
        linuxDoEnabled={linuxDoEnabled}
        guestModeEnabled={guestModeEnabled}
      />
    </Suspense>
  );
}
