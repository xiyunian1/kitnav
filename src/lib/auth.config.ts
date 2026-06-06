import type { NextAuthConfig } from "next-auth";

// 精简配置：仅用于 middleware 的路由保护（Edge runtime 友好，不引入 bcrypt/prisma）。
// 完整配置（含 Credentials Provider）在 auth.ts 中。
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [], // 在 auth.ts 中补全
  session: { strategy: "jwt" },
  callbacks: {
    // 把 user 信息写入 token，再透传到 session
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user.role ?? "USER") as "USER" | "ADMIN";
        token.credits = user.credits ?? 0;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as "USER" | "ADMIN";
        session.user.credits = token.credits as number;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
