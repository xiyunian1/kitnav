import { describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import { refreshSessionFromDatabase } from "./auth-session";

const session = {
  user: {
    id: "user-1",
    email: "user@example.com",
    role: "USER",
    credits: 10,
    sessionVersion: 0,
  },
  expires: "2099-01-01T00:00:00.000Z",
} satisfies Session;

describe("refreshSessionFromDatabase", () => {
  it("refreshes mutable authorization fields from the database", () => {
    expect(
      refreshSessionFromDatabase(session, {
        id: "user-1",
        role: "ADMIN",
        status: "ACTIVE",
        credits: 75,
        sessionVersion: 0,
      }),
    ).toMatchObject({
      user: { id: "user-1", role: "ADMIN", credits: 75 },
    });
  });

  it("invalidates deleted, banned, or mismatched users", () => {
    expect(refreshSessionFromDatabase(session, null)).toBeNull();
    expect(
      refreshSessionFromDatabase(session, {
        id: "user-1",
        role: "USER",
        status: "BANNED",
        credits: 10,
        sessionVersion: 0,
      }),
    ).toBeNull();
    expect(
      refreshSessionFromDatabase(session, {
        id: "user-2",
        role: "USER",
        status: "ACTIVE",
        credits: 10,
        sessionVersion: 0,
      }),
    ).toBeNull();
  });

  it("invalidates a JWT issued before the user's session version changed", () => {
    expect(
      refreshSessionFromDatabase(session, {
        id: "user-1",
        role: "USER",
        status: "ACTIVE",
        credits: 10,
        sessionVersion: 1,
      }),
    ).toBeNull();
  });

  it("treats legacy JWTs without a version as version zero", () => {
    const legacySession = {
      ...session,
      user: { ...session.user, sessionVersion: undefined },
    };
    expect(
      refreshSessionFromDatabase(legacySession, {
        id: "user-1",
        role: "USER",
        status: "ACTIVE",
        credits: 10,
        sessionVersion: 0,
      }),
    ).not.toBeNull();
  });
});
