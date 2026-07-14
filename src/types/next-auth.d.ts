import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "USER" | "ADMIN";
      credits: number;
      sessionVersion?: number;
    } & DefaultSession["user"];
  }

  interface User {
    role?: "USER" | "ADMIN";
    credits?: number;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "USER" | "ADMIN";
    credits: number;
    sessionVersion: number;
  }
}
