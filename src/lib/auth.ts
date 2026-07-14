import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterUser } from "@auth/core/adapters";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import bcrypt from "bcryptjs";
import { cache } from "react";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { prisma } from "./db";
import LinuxDo, { type LinuxDoProfile } from "./auth-providers/linux-do";
import {
  assertRegistrationAllowed,
  createRegisteredUser,
  OperationBlockedError,
} from "./operations";
import { refreshSessionFromDatabase } from "./auth-session";
import { AUTH_INPUT_LIMITS } from "./auth-inputs";

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .max(AUTH_INPUT_LIMITS.emailCharacters)
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(AUTH_INPUT_LIMITS.loginPasswordCharacters),
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
      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      });
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
        sessionVersion: user.sessionVersion,
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

const baseAdapter = PrismaAdapter(prisma);
const registrationAdapter: Adapter = {
  ...baseAdapter,
  // Credentials registration uses its own API route; Linux.do is currently the
  // only provider that asks the Auth.js adapter to create users.
  async createUser(user) {
    return (await createRegisteredUser({
      provider: "linux-do",
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: user.emailVerified,
    })) as AdapterUser;
  },
};

const nextAuth = NextAuth({
  ...authConfig,
  adapter: registrationAdapter,
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
          select: { status: true, sessionVersion: true },
        });
        if (dbUser?.status === "BANNED") return false;
        if (dbUser) user.sessionVersion = dbUser.sessionVersion;
      }

      return true;
    },
  },
});

export const { handlers, signIn, signOut } = nextAuth;

const loadSessionUser = cache((id: string) =>
  prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      status: true,
      credits: true,
      sessionVersion: true,
    },
  }),
);

export const auth = cache(async () => {
  const session = await nextAuth.auth();
  if (!session?.user?.id) return session;
  return refreshSessionFromDatabase(
    session,
    await loadSessionUser(session.user.id),
  );
});
