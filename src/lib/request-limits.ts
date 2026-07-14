import { createHash } from "node:crypto";
import {
  getRequestIp,
  rateLimitCheck,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { boundedIntegerEnv } from "@/lib/runtime-config";

interface LimitOptions {
  prefix: string;
  maxEnv: string;
  windowEnv: string;
  defaultMax: number;
  defaultWindowMs: number;
  message?: string;
}

async function enforce(key: string, options: LimitOptions) {
  const result = await rateLimitCheck(
    `${options.prefix}:${key}`,
    boundedIntegerEnv(options.maxEnv, options.defaultMax),
    boundedIntegerEnv(options.windowEnv, options.defaultWindowMs, { min: 1_000 }),
  );
  return result.allowed
    ? null
    : rateLimitResponse(result, options.message ?? "请求过于频繁，请稍后再试");
}

export function enforceUserRequestLimit(
  userId: string,
  options: LimitOptions,
) {
  return enforce(`u:${userId}`, options);
}

export function enforceIpRequestLimit(request: Request, options: LimitOptions) {
  return enforce(`ip:${getRequestIp(request) ?? "unknown"}`, options);
}

export function enforceOpaqueValueLimit(
  value: string,
  options: LimitOptions,
) {
  const digest = createHash("sha256").update(value).digest("hex");
  return enforce(`v:${digest}`, options);
}

export const REQUEST_LIMITS = {
  login: {
    prefix: "auth-login",
    maxEnv: "AUTH_LOGIN_RATE_MAX",
    windowEnv: "AUTH_LOGIN_RATE_WINDOW_MS",
    defaultMax: 10,
    defaultWindowMs: 5 * 60_000,
    message: "登录尝试过于频繁，请稍后再试",
  },
  loginAccount: {
    prefix: "auth-login-account",
    maxEnv: "AUTH_LOGIN_ACCOUNT_RATE_MAX",
    windowEnv: "AUTH_LOGIN_ACCOUNT_RATE_WINDOW_MS",
    defaultMax: 30,
    defaultWindowMs: 15 * 60_000,
    message: "该账号登录尝试过于频繁，请稍后再试",
  },
  register: {
    prefix: "register",
    maxEnv: "REGISTER_RATE_MAX",
    windowEnv: "REGISTER_RATE_WINDOW_MS",
    defaultMax: 5,
    defaultWindowMs: 60 * 60_000,
    message: "注册请求过于频繁，请稍后再试",
  },
  imageGenerate: {
    prefix: "image-generate",
    maxEnv: "IMAGE_GENERATE_RATE_MAX",
    windowEnv: "IMAGE_GENERATE_RATE_WINDOW_MS",
    defaultMax: 20,
    defaultWindowMs: 60_000,
    message: "图片生成请求过于频繁，请稍后再试",
  },
  imageCancel: {
    prefix: "image-cancel",
    maxEnv: "IMAGE_CANCEL_RATE_MAX",
    windowEnv: "IMAGE_CANCEL_RATE_WINDOW_MS",
    defaultMax: 30,
    defaultWindowMs: 60_000,
  },
  imageConversationWrite: {
    prefix: "image-conversation-write",
    maxEnv: "IMAGE_CONVERSATION_WRITE_RATE_MAX",
    windowEnv: "IMAGE_CONVERSATION_WRITE_RATE_WINDOW_MS",
    defaultMax: 60,
    defaultWindowMs: 60_000,
    message: "会话操作过于频繁，请稍后再试",
  },
  promptOptimize: {
    prefix: "prompt-optimize",
    maxEnv: "PROMPT_OPTIMIZE_RATE_MAX",
    windowEnv: "PROMPT_OPTIMIZE_RATE_WINDOW_MS",
    defaultMax: 20,
    defaultWindowMs: 60_000,
  },
  materialUpload: {
    prefix: "material-upload",
    maxEnv: "MATERIAL_UPLOAD_RATE_MAX",
    windowEnv: "MATERIAL_UPLOAD_RATE_WINDOW_MS",
    defaultMax: 20,
    defaultWindowMs: 60_000,
    message: "素材上传请求过于频繁，请稍后再试",
  },
  materialSave: {
    prefix: "material-save",
    maxEnv: "MATERIAL_SAVE_RATE_MAX",
    windowEnv: "MATERIAL_SAVE_RATE_WINDOW_MS",
    defaultMax: 30,
    defaultWindowMs: 60_000,
  },
  materialReport: {
    prefix: "material-report",
    maxEnv: "MATERIAL_REPORT_RATE_MAX",
    windowEnv: "MATERIAL_REPORT_RATE_WINDOW_MS",
    defaultMax: 10,
    defaultWindowMs: 60 * 60_000,
    message: "举报过于频繁，请稍后再试",
  },
  recharge: {
    prefix: "credits-recharge",
    maxEnv: "RECHARGE_RATE_MAX",
    windowEnv: "RECHARGE_RATE_WINDOW_MS",
    defaultMax: 10,
    defaultWindowMs: 10 * 60_000,
    message: "充值请求过于频繁，请稍后再试",
  },
  passwordChange: {
    prefix: "password-change",
    maxEnv: "PASSWORD_CHANGE_RATE_MAX",
    windowEnv: "PASSWORD_CHANGE_RATE_WINDOW_MS",
    defaultMax: 5,
    defaultWindowMs: 15 * 60_000,
    message: "密码修改尝试过于频繁，请稍后再试",
  },
  pptGenerate: {
    prefix: "ppt-generate",
    maxEnv: "PPT_GENERATE_RATE_MAX",
    windowEnv: "PPT_GENERATE_RATE_WINDOW_MS",
    defaultMax: 10,
    defaultWindowMs: 60_000,
    message: "生成请求过于频繁，请稍后再试。",
  },
  pptUpload: {
    prefix: "ppt-upload",
    maxEnv: "PPT_UPLOAD_RATE_MAX",
    windowEnv: "PPT_UPLOAD_RATE_WINDOW_MS",
    defaultMax: 20,
    defaultWindowMs: 60_000,
    message: "上传请求过于频繁，请稍后再试。",
  },
  apiProbe: {
    prefix: "api-probe",
    maxEnv: "API_TEST_RATE_MAX",
    windowEnv: "API_TEST_RATE_WINDOW_MS",
    defaultMax: 10,
    defaultWindowMs: 60_000,
    message: "模型接口探测过于频繁，请稍后再试",
  },
} satisfies Record<string, LimitOptions>;
