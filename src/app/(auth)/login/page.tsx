import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const linuxDoEnabled = Boolean(
    process.env.LINUX_DO_CLIENT_ID && process.env.LINUX_DO_CLIENT_SECRET
  );

  return (
    <Suspense fallback={null}>
      <LoginForm linuxDoEnabled={linuxDoEnabled} />
    </Suspense>
  );
}
