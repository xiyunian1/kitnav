import { prisma } from "@/lib/db";
import { PPT_PROCESSING_STATUSES } from "./status";

const activeControllers = new Map<string, AbortController>();

export class PptGenerationCancelledError extends Error {
  constructor(message = "用户已停止生成") {
    super(message);
    this.name = "PptGenerationCancelledError";
  }
}

export class PptWorkerShutdownError extends Error {
  constructor(message = "PPT worker 正在重启") {
    super(message);
    this.name = "PptWorkerShutdownError";
  }
}

export function registerPptGeneration(projectId: string, controller: AbortController) {
  activeControllers.set(projectId, controller);
  return () => {
    if (activeControllers.get(projectId) === controller) {
      activeControllers.delete(projectId);
    }
  };
}

export function cancelPptGeneration(projectId: string, reason = "用户已停止生成") {
  const controller = activeControllers.get(projectId);
  if (!controller) return false;
  if (!controller.signal.aborted) {
    controller.abort(new PptGenerationCancelledError(reason));
  }
  activeControllers.delete(projectId);
  return true;
}

export async function markPptProjectCancelled(
  projectId: string,
  userId: string,
) {
  const claimed = await prisma.pptProject.updateMany({
    where: {
      id: projectId,
      userId,
      status: { in: [...PPT_PROCESSING_STATUSES] },
    },
    data: {
      status: "FAILED",
      workerLease: null,
      currentPhase: "已停止生成",
      error: "用户已停止生成",
    },
  });
  return claimed.count === 1;
}

export function abortAllPptGenerationsForShutdown() {
  const projectIds = [...activeControllers.keys()];
  for (const [projectId, controller] of activeControllers) {
    if (!controller.signal.aborted) controller.abort(new PptWorkerShutdownError());
    activeControllers.delete(projectId);
  }
  return projectIds;
}

export function throwIfPptCancelled(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof PptWorkerShutdownError) throw reason;
  if (reason instanceof PptGenerationCancelledError) throw reason;
  if (reason instanceof Error) throw new PptGenerationCancelledError(reason.message);
  throw new PptGenerationCancelledError();
}

export function isPptGenerationCancelled(error: unknown) {
	if (error instanceof PptWorkerShutdownError) return false;
  if (error instanceof PptGenerationCancelledError) return true;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return /PptGenerationCancelledError|AbortError|用户已停止生成|已停止生成/i.test(`${name} ${message}`);
}

export function isPptWorkerShutdown(error: unknown) {
  return error instanceof PptWorkerShutdownError;
}
