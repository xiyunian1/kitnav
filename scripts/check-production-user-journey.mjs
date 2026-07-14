import assert from "node:assert/strict";

const baseUrl = (process.argv[2] || process.env.APP_BASE_URL || "").replace(/\/$/, "");
if (!baseUrl) {
  throw new Error("Usage: node scripts/check-production-user-journey.mjs <base-url>");
}

class CookieJar {
  #cookies = new Map();

  header() {
    return [...this.#cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  update(headers) {
    const combined = headers.get("set-cookie");
    const values =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : combined
          ? combined.split(/,(?=\s*[^=;,]+\s*=)/)
          : [];

    for (const value of values) {
      const pair = value.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const cookieValue = pair.slice(separator + 1).trim();
      if (cookieValue) this.#cookies.set(name, cookieValue);
      else this.#cookies.delete(name);
    }
  }
}

async function request(path, init = {}, jar) {
  const headers = new Headers(init.headers);
  const cookie = jar?.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(new URL(path, `${baseUrl}/`), {
    ...init,
    headers,
    redirect: "manual",
  });
  jar?.update(response.headers);
  return response;
}

async function readJson(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON (${response.status}): ${text.slice(0, 300)}`);
  }
}

async function register({ email, name, password, ip, expectedStatus = 200 }) {
  const response = await request("/api/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ email, name, password }),
  });
  const body = await readJson(response, "registration");
  assert.equal(response.status, expectedStatus, `registration failed: ${JSON.stringify(body)}`);
  return body;
}

async function login(email, password) {
  const jar = new CookieJar();
  const csrfResponse = await request("/api/auth/csrf", {}, jar);
  assert.equal(csrfResponse.status, 200, "CSRF endpoint must be available");
  const csrf = await readJson(csrfResponse, "CSRF endpoint");
  assert.equal(typeof csrf.csrfToken, "string", "CSRF response must contain a token");

  const response = await request(
    "/api/auth/callback/credentials",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-auth-return-redirect": "1",
      },
      body: new URLSearchParams({
        callbackUrl: `${baseUrl}/`,
        csrfToken: csrf.csrfToken,
        email,
        password,
      }),
    },
    jar,
  );
  const result = await readJson(response, "credentials callback");
  assert.equal(response.status, 200, `credentials login failed: ${JSON.stringify(result)}`);
  assert.ok(result.url && !new URL(result.url).searchParams.has("error"), "login returned an error URL");

  const sessionResponse = await request("/api/auth/session", {}, jar);
  const session = await readJson(sessionResponse, "session endpoint");
  assert.equal(sessionResponse.status, 200);
  assert.equal(session.user?.email, email);
  assert.equal(session.user?.credits, 100);
  return jar;
}

async function listConversations(jar) {
  const response = await request("/api/image/conversations?take=2", {}, jar);
  const body = await readJson(response, "conversation list");
  assert.equal(response.status, 200, `conversation list failed: ${JSON.stringify(body)}`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(Array.isArray(body.conversations));
  return body;
}

async function createConversation(jar) {
  const response = await request(
    "/api/image/conversations",
    { method: "POST" },
    jar,
  );
  const body = await readJson(response, "conversation creation");
  assert.equal(response.status, 200, `conversation creation failed: ${JSON.stringify(body)}`);
  assert.equal(typeof body.conversation?.id, "string");
  return body.conversation;
}

async function clearConversations(jar) {
  const response = await request(
    "/api/image/conversations?all=1",
    { method: "DELETE" },
    jar,
  );
  const body = await readJson(response, "conversation cleanup");
  assert.equal(response.status, 200, `conversation cleanup failed: ${JSON.stringify(body)}`);
  assert.equal(body.ok, true);
}

const anonymousPage = await request("/image");
assert.ok([302, 303, 307, 308].includes(anonymousPage.status));
const loginLocation = new URL(anonymousPage.headers.get("location"), `${baseUrl}/`);
assert.equal(loginLocation.pathname, "/login");
assert.equal(loginLocation.searchParams.get("callbackUrl"), "/image");

const anonymousApi = await request("/api/image/conversations");
assert.equal(anonymousApi.status, 401);

for (const path of [
  "/projects/private-project/sources/source.md",
  "/uploads/unclassified/private-file.png",
]) {
  const response = await request(path);
  assert.equal(response.status, 404, `${path} must never expose runtime data`);
  assert.equal(response.headers.get("cache-control"), "no-store");
}

const password = "RuntimeJourney!2026";
const firstEmail = "runtime-journey-a@example.com";
const secondEmail = "runtime-journey-b@example.com";

await register({
  email: firstEmail,
  name: "Runtime A",
  password,
  ip: "198.51.100.10",
});
await register({
  email: firstEmail,
  name: "Runtime A",
  password,
  ip: "198.51.100.10",
  expectedStatus: 409,
});

const firstJar = await login(firstEmail, password);
assert.equal((await listConversations(firstJar)).conversations.length, 0);
const firstConversation = await createConversation(firstJar);
assert.deepEqual(
  (await listConversations(firstJar)).conversations.map((item) => item.id),
  [firstConversation.id],
);

await register({
  email: secondEmail,
  name: "Runtime B",
  password,
  ip: "198.51.100.11",
});
const secondJar = await login(secondEmail, password);
assert.equal((await listConversations(secondJar)).conversations.length, 0);

const crossUserResponse = await request(
  `/api/image/conversations/${encodeURIComponent(firstConversation.id)}`,
  {},
  secondJar,
);
assert.equal(crossUserResponse.status, 404, "another user's conversation must remain private");

const secondConversation = await createConversation(secondJar);
assert.deepEqual(
  (await listConversations(secondJar)).conversations.map((item) => item.id),
  [secondConversation.id],
);
assert.deepEqual(
  (await listConversations(firstJar)).conversations.map((item) => item.id),
  [firstConversation.id],
);

for (const jar of [firstJar, secondJar]) {
  const projectsResponse = await request("/api/ppt/projects", {}, jar);
  const projects = await readJson(projectsResponse, "PPT project list");
  assert.equal(projectsResponse.status, 200, `PPT project list failed: ${JSON.stringify(projects)}`);
  assert.deepEqual(projects.projects, []);
}

for (const path of ["/image", "/ppt"]) {
  const response = await request(path, {}, firstJar);
  const body = await response.text();
  assert.equal(response.status, 200, `${path} failed to render`);
  assert.ok(body.includes("AI 聚合站"), `${path} returned an unexpected page`);
}

await clearConversations(firstJar);
await clearConversations(secondJar);
assert.equal((await listConversations(firstJar)).conversations.length, 0);
assert.equal((await listConversations(secondJar)).conversations.length, 0);

console.log("Production user journey check passed.");
