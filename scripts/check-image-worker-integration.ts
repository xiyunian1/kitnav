import assert from "node:assert/strict";
import { createServer } from "node:http";

const databaseUrl = process.env.IMAGE_WORKER_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("IMAGE_WORKER_INTEGRATION_DATABASE_URL is required");
}
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.endsWith("_image_worker_test")) {
  throw new Error("Integration database name must end with _image_worker_test");
}

async function main() {
process.env.DATABASE_URL = databaseUrl;
process.env.ENCRYPTION_KEY = "11".repeat(32);
process.env.IMAGE_UPSTREAM_MAX_ATTEMPTS = "2";
process.env.IMAGE_USER_MAX_PENDING = "10";

let upstreamMode: "success" | "failure" = "success";
let upstreamRequests = 0;
const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/images/generations") {
    response.writeHead(404).end();
    return;
  }
  upstreamRequests += 1;
  request.resume();
  request.on("end", () => {
    response.setHeader("Content-Type", "application/json");
    if (upstreamMode === "failure") {
      response.writeHead(503).end(JSON.stringify({ error: { message: "temporary" } }));
      return;
    }
    response
      .writeHead(200)
      .end(
        JSON.stringify({
          data: [
            {
              url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            },
          ],
        }),
      );
  });
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
assert(address && typeof address === "object");

const { prisma } = await import("@/lib/db");
const { encrypt } = await import("@/lib/crypto");
const {
  cancelImageTurn,
  claimNextImageTurn,
  enqueueImageTurn,
  executeImageTurn,
  requeueImageTurn,
} = await import("@/lib/image-workbench");

const userId = "image-worker-integration-user";

try {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.providerConfig.deleteMany({ where: { module: "IMAGE" } });
  await prisma.user.create({
    data: {
      id: userId,
      email: "image-worker-integration@example.com",
      credits: 100,
    },
  });
  await prisma.providerConfig.create({
    data: {
      module: "IMAGE",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: encrypt("integration-key"),
      model: "integration-image-model",
      enabled: true,
    },
  });
  await prisma.setting.upsert({
    where: { key: "image_credit_cost" },
    create: { key: "image_credit_cost", value: "10" },
    update: { value: "10" },
  });
  await prisma.setting.upsert({
    where: { key: "image_parallel_limit" },
    create: { key: "image_parallel_limit", value: "2" },
    update: { value: "2" },
  });
  await prisma.setting.upsert({
    where: { key: "image_request_timeout_seconds" },
    create: { key: "image_request_timeout_seconds", value: "10" },
    update: { value: "10" },
  });

  const queued = await enqueueImageTurn({
    userId,
    prompt: "integration success",
    ratio: "1:1",
    quality: "standard",
    count: 2,
    mode: "generate",
    model: "integration-image-model",
    modelSource: "platform",
  });
  assert.equal(queued.status, "PENDING");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits, 80);

  const claimed = await claimNextImageTurn();
  assert(claimed);
  assert.equal(claimed.id, queued.id);
  const completed = await executeImageTurn(claimed.id, claimed.lease);
  assert(completed);
  assert.equal(completed.status, "SUCCESS");
  assert.equal(completed.creditsCost, 20);
  assert.equal(completed.images.filter((image) => image.status === "success").length, 2);
  assert.equal(upstreamRequests, 2);

  const cancelledQueued = await enqueueImageTurn({
    userId,
    prompt: "integration cancel",
    ratio: "1:1",
    quality: "standard",
    count: 1,
    mode: "generate",
    model: "integration-image-model",
    modelSource: "platform",
  });
  const cancelled = await cancelImageTurn(userId, cancelledQueued.id);
  assert.equal(cancelled.status, "FAILED");
  assert.equal(cancelled.creditsCost, 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits, 80);

  upstreamMode = "failure";
  const failureQueued = await enqueueImageTurn({
    userId,
    prompt: "integration failure",
    ratio: "1:1",
    quality: "standard",
    count: 1,
    mode: "generate",
    model: "integration-image-model",
    modelSource: "platform",
  });
  const failureClaim = await claimNextImageTurn();
  assert(failureClaim);
  assert.equal(failureClaim.id, failureQueued.id);
  const failed = await executeImageTurn(failureClaim.id, failureClaim.lease);
  assert(failed);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.creditsCost, 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits, 80);

  upstreamMode = "success";
  const requeueCandidate = await enqueueImageTurn({
    userId,
    prompt: "integration requeue",
    ratio: "1:1",
    quality: "standard",
    count: 1,
    mode: "generate",
    model: "integration-image-model",
    modelSource: "platform",
  });
  const firstLease = await claimNextImageTurn();
  assert(firstLease);
  assert.equal(firstLease.id, requeueCandidate.id);
  assert.equal(await requeueImageTurn(firstLease.id, firstLease.lease), true);
  const secondLease = await claimNextImageTurn();
  assert(secondLease);
  assert.equal(secondLease.id, requeueCandidate.id);
  assert.notEqual(secondLease.lease, firstLease.lease);
  const retried = await executeImageTurn(secondLease.id, secondLease.lease);
  assert.equal(retried?.status, "SUCCESS");

  const generations = await prisma.generation.count({
    where: { userId, module: "IMAGE" },
  });
  assert.equal(generations, 4);
  const refunds = await prisma.creditTransaction.count({
    where: { userId, type: "REFUND" },
  });
  assert.equal(refunds, 2);
  console.log("Image worker integration check passed.");
} finally {
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
  await prisma.providerConfig.deleteMany({ where: { module: "IMAGE" } }).catch(
    () => undefined,
  );
  await prisma.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
