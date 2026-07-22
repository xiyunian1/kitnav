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
let upstreamEditRequests = 0;
let lastEditBody = "";
const server = createServer((request, response) => {
  const isGeneration = request.url === "/v1/images/generations";
  const isEdit = request.url === "/v1/images/edits";
  if (request.method !== "POST" || (!isGeneration && !isEdit)) {
    response.writeHead(404).end();
    return;
  }
  upstreamRequests += 1;
  if (isEdit) upstreamEditRequests += 1;
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    if (isEdit) lastEditBody = Buffer.concat(chunks).toString("latin1");
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
const {
  parseStoredImageInputReferences,
  readImageEditInput,
} = await import("@/lib/image-inputs");

const userId = "image-worker-integration-user";
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);
const editImages = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    blob: new Blob([png], { type: "image/png" }),
    filename: `${String(index + 1).padStart(2, "0")}.png`,
  }));

async function storedReferences(turnId: string) {
  const row = await prisma.imageTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: {
      editInputs: true,
      editInputPath: true,
      editInputName: true,
      referenceThumbs: true,
    },
  });
  return {
    references: parseStoredImageInputReferences(
      row.editInputs,
      row.editInputPath,
      row.editInputName,
    ),
    thumbnails: row.referenceThumbs
      ? (JSON.parse(row.referenceThumbs) as string[])
      : [],
  };
}

async function assertInputsDeleted(
  references: Array<{ token: string }>,
) {
  for (const reference of references) {
    await assert.rejects(readImageEditInput(userId, reference.token));
  }
}

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
      model: "gpt-image-2",
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
    model: "gpt-image-2",
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

  const editQueued = await enqueueImageTurn({
    userId,
    prompt: "integration three-image edit",
    ratio: "1:1",
    quality: "standard",
    count: 1,
    mode: "edit",
    model: "gpt-image-2",
    modelSource: "platform",
    editImages: editImages(3),
  });
  const editStored = await storedReferences(editQueued.id);
  assert.deepEqual(
    editStored.references.map((reference) => reference.filename),
    ["01.png", "02.png", "03.png"],
  );
  assert.equal(editStored.thumbnails.length, 3);
  assert(editStored.thumbnails.every((thumbnail) => thumbnail.startsWith("data:image/webp")));
  const editClaim = await claimNextImageTurn();
  assert(editClaim);
  assert.equal(editClaim.id, editQueued.id);
  const edited = await executeImageTurn(editClaim.id, editClaim.lease);
  assert.equal(edited?.status, "SUCCESS");
  assert.equal(upstreamEditRequests, 1);
  const firstPosition = lastEditBody.indexOf('filename="01.png"');
  const secondPosition = lastEditBody.indexOf('filename="02.png"');
  const thirdPosition = lastEditBody.indexOf('filename="03.png"');
  assert(firstPosition >= 0 && firstPosition < secondPosition && secondPosition < thirdPosition);
  assert.equal((lastEditBody.match(/name="image\[\]"/g) || []).length, 3);
  assert(!lastEditBody.includes('name="image"\r\n'));
  await assertInputsDeleted(editStored.references);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits, 70);

  const cancelledQueued = await enqueueImageTurn({
    userId,
    prompt: "integration cancel",
    ratio: "1:1",
    quality: "standard",
    count: 1,
    mode: "edit",
    model: "gpt-image-2",
    modelSource: "platform",
    editImages: editImages(2),
  });
  const cancelledStored = await storedReferences(cancelledQueued.id);
  const cancelled = await cancelImageTurn(userId, cancelledQueued.id);
  assert.equal(cancelled.status, "FAILED");
  assert.equal(cancelled.creditsCost, 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits, 70);
  await assertInputsDeleted(cancelledStored.references);

  upstreamMode = "failure";
  const failureQueued = await enqueueImageTurn({
    userId,
    prompt: "integration failure",
    ratio: "1:1",
    quality: "standard",
    count: 1,
    mode: "edit",
    model: "gpt-image-2",
    modelSource: "platform",
    editImages: editImages(3),
  });
  const failureStored = await storedReferences(failureQueued.id);
  const failureClaim = await claimNextImageTurn();
  assert(failureClaim);
  assert.equal(failureClaim.id, failureQueued.id);
  const failed = await executeImageTurn(failureClaim.id, failureClaim.lease);
  assert(failed);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.creditsCost, 0);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits, 70);
  await assertInputsDeleted(failureStored.references);

  upstreamMode = "success";
  const requeueCandidate = await enqueueImageTurn({
    userId,
    prompt: "integration requeue",
    ratio: "1:1",
    quality: "standard",
    count: 1,
    mode: "edit",
    model: "gpt-image-2",
    modelSource: "platform",
    editImages: editImages(2),
  });
  const requeueStored = await storedReferences(requeueCandidate.id);
  const firstLease = await claimNextImageTurn();
  assert(firstLease);
  assert.equal(firstLease.id, requeueCandidate.id);
  assert.equal(await requeueImageTurn(firstLease.id, firstLease.lease), true);
  await expectStoredInputs(requeueStored.references);
  const secondLease = await claimNextImageTurn();
  assert(secondLease);
  assert.equal(secondLease.id, requeueCandidate.id);
  assert.notEqual(secondLease.lease, firstLease.lease);
  const retried = await executeImageTurn(secondLease.id, secondLease.lease);
  assert.equal(retried?.status, "SUCCESS");
  await assertInputsDeleted(requeueStored.references);

  const legacyQueued = await enqueueImageTurn({
    userId,
    prompt: "integration legacy single image",
    ratio: "1:1",
    quality: "standard",
    count: 1,
    mode: "edit",
    model: "gpt-image-2",
    modelSource: "platform",
    editImages: editImages(1),
  });
  await prisma.imageTurn.update({
    where: { id: legacyQueued.id },
    data: { editInputs: null },
  });
  const legacyStored = await storedReferences(legacyQueued.id);
  assert.equal(legacyStored.references.length, 1);
  const legacyClaim = await claimNextImageTurn();
  assert(legacyClaim);
  const legacyCompleted = await executeImageTurn(legacyClaim.id, legacyClaim.lease);
  assert.equal(legacyCompleted?.status, "SUCCESS");
  await assertInputsDeleted(legacyStored.references);

  const generations = await prisma.generation.count({
    where: { userId, module: "IMAGE" },
  });
  assert.equal(generations, 6);
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

async function expectStoredInputs(references: Array<{ token: string }>) {
  for (const reference of references) {
    await expectBlob(readImageEditInput(userId, reference.token));
  }
}

async function expectBlob(value: Promise<Blob>) {
  assert((await value) instanceof Blob);
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
