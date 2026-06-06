import { RegisterForm } from "./register-form";
import { getSetting } from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const linuxDoEnabled = Boolean(
    process.env.LINUX_DO_CLIENT_ID && process.env.LINUX_DO_CLIENT_SECRET
  );
  const registrationMode = await getSetting(SETTING_KEYS.REGISTRATION_MODE);

  return <RegisterForm linuxDoEnabled={linuxDoEnabled} registrationMode={registrationMode} />;
}
