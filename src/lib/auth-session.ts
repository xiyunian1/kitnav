import type { Session } from "next-auth";
import type { Role, UserStatus } from "@prisma/client";

export interface SessionDatabaseUser {
  id: string;
  role: Role;
  status: UserStatus;
  credits: number;
  sessionVersion: number;
}

export function refreshSessionFromDatabase(
  session: Session | null,
  user: SessionDatabaseUser | null,
): Session | null {
  if (!session?.user?.id || !user || user.status !== "ACTIVE") return null;
  if (user.id !== session.user.id) return null;
  if ((session.user.sessionVersion ?? 0) !== user.sessionVersion) return null;
  return {
    ...session,
    user: {
      ...session.user,
      id: user.id,
      role: user.role,
      credits: user.credits,
      sessionVersion: user.sessionVersion,
    },
  };
}
