import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { prisma } from "./db";
import { addCredits, getSettingNumber } from "./credits";
import { SETTING_KEYS } from "./settings-config";
import LinuxDo, { type LinuxDoProfile } from "./auth-providers/linux-do";
import {
  assertRegistrationAllowed,
  OperationBlockedError,
  recordRegistration,
} from "./operations";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const providers: Provider[] = [
  Credentials({
    credentials: {
      email: { label: "邮箱", type: "email" },
      password: { label: "密码", type: "password" },
    },
    async authorize(credentials) {
      const parsed = credentialsSchema.safeParse(credentials);
      if (!parsed.success) return null;

      const { email, password } = parsed.data;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.passwordHash) return null;
      if (user.status === "BANNED") return null;

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        credits: user.credits,
      };
    },
  }),
];

if (process.env.LINUX_DO_CLIENT_ID && process.env.LINUX_DO_CLIENT_SECRET) {
  providers.push(
    LinuxDo({
      clientId: process.env.LINUX_DO_CLIENT_ID,
      clientSecret: process.env.LINUX_DO_CLIENT_SECRET,
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider === "linux-do") {
        const linuxDoProfile = profile as LinuxDoProfile | undefined;
        if (linuxDoProfile?.active === false || linuxDoProfile?.silenced) {
          return false;
        }
        const existingAccount = await prisma.account.findUnique({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
          select: { userId: true },
        });
        if (!existingAccount) {
          try {
            await assertRegistrationAllowed({
              provider: "linux-do",
              email: user.email,
            });
          } catch (error) {
            if (error instanceof OperationBlockedError) return false;
            throw error;
          }
        }
      }

      if (user.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { status: true },
        });
        if (dbUser?.status === "BANNED") return false;
      }

      return true;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      try {
        await recordRegistration({
          userId: user.id,
          email: user.email,
          provider: "linux-do",
        });
        const bonus = await getSettingNumber(SETTING_KEYS.SIGNUP_BONUS);
        if (bonus > 0) {
          await addCredits(user.id, bonus, "SIGNUP_BONUS", "Linux.do 注册赠送");
        }
      } catch (error) {
        console.error("Failed to grant Linux.do signup bonus", error);
      }
    },
  },
});
