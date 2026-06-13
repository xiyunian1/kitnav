import { cache } from "react";
import type { ModuleType, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { MODULES } from "@/lib/modules";
import { auth } from "@/lib/auth";

export const MODULE_CONTROL_STATUSES = [
  "open",
  "admin",
  "closed",
  "hidden",
  "coming-soon",
] as const;

export type ModuleControlStatus = (typeof MODULE_CONTROL_STATUSES)[number];
export type ControlledModuleKey =
  | "image"
  | "ppt"
  | "video"
  | "audio"
  | "copywriting"
  | "code"
  | "materials"
  | "library"
  | "credits"
  | "feedback";

export interface ModuleControlDefinition {
  key: ControlledModuleKey;
  name: string;
  description: string;
  href: string;
  group: "AI 工具" | "用户功能";
  defaultStatus: ModuleControlStatus;
  moduleType?: ModuleType;
}

export interface ModuleControl extends ModuleControlDefinition {
  status: ModuleControlStatus;
  message: string;
}

export interface SidebarModuleState {
  key: string;
  status: ModuleControlStatus;
  badge?: string;
}

export interface SidebarControlState {
  modules: SidebarModuleState[];
  account: SidebarModuleState[];
}

export const MODULE_STATUS_OPTIONS: {
  value: ModuleControlStatus;
  label: string;
  description: string;
}[] = [
  { value: "open", label: "开放", description: "普通用户和管理员都可见、可使用" },
  { value: "admin", label: "仅管理员", description: "只对管理员显示和开放" },
  { value: "closed", label: "暂停", description: "入口可见，但访问和操作会被拦截" },
  { value: "hidden", label: "隐藏", description: "普通用户不可见，也不可直接访问" },
  { value: "coming-soon", label: "即将上线", description: "入口可见，但显示未上线状态" },
];

const MODULE_LOOKUP = new Map(MODULES.map((module) => [module.key, module]));

export const MODULE_CONTROL_DEFINITIONS: ModuleControlDefinition[] = [
  {
    key: "image",
    name: "图片生成",
    description: "图片生成工作台和图片生成任务",
    href: "/image",
    group: "AI 工具",
    defaultStatus: "open",
    moduleType: "IMAGE",
  },
  {
    key: "ppt",
    name: "PPT 生成",
    description: "PPT 工作台、项目生成和导出",
    href: "/ppt",
    group: "AI 工具",
    defaultStatus: "open",
    moduleType: "PPT",
  },
  {
    key: "video",
    name: "视频生成",
    description: "视频生成模块入口",
    href: "/video",
    group: "AI 工具",
    defaultStatus: "coming-soon",
    moduleType: "VIDEO",
  },
  {
    key: "audio",
    name: "音频生成",
    description: "音频生成模块入口",
    href: "/audio",
    group: "AI 工具",
    defaultStatus: "coming-soon",
  },
  {
    key: "copywriting",
    name: "文案写作",
    description: "文案写作模块入口",
    href: "/copywriting",
    group: "AI 工具",
    defaultStatus: "coming-soon",
  },
  {
    key: "code",
    name: "代码助手",
    description: "代码助手模块入口",
    href: "/code",
    group: "AI 工具",
    defaultStatus: "coming-soon",
  },
  {
    key: "materials",
    name: "素材广场",
    description: "公开素材浏览、点赞、收藏和使用",
    href: "/materials",
    group: "用户功能",
    defaultStatus: "open",
  },
  {
    key: "library",
    name: "我的素材库",
    description: "个人素材上传、保存、分享和管理",
    href: "/library",
    group: "用户功能",
    defaultStatus: "open",
  },
  {
    key: "credits",
    name: "积分充值",
    description: "积分余额、充值套餐和积分流水",
    href: "/credits",
    group: "用户功能",
    defaultStatus: "open",
  },
  {
    key: "feedback",
    name: "反馈建议",
    description: "用户反馈入口和建议提交",
    href: "/feedback",
    group: "用户功能",
    defaultStatus: "open",
  },
];

const DEFINITION_BY_KEY = new Map(MODULE_CONTROL_DEFINITIONS.map((item) => [item.key, item]));
const DEFINITION_BY_MODULE_TYPE = new Map(
  MODULE_CONTROL_DEFINITIONS.flatMap((item) => (item.moduleType ? [[item.moduleType, item]] : []))
);

function statusKey(key: string) {
  return `module.${key}.status`;
}

function messageKey(key: string) {
  return `module.${key}.message`;
}

function normalizeStatus(value: string | undefined, fallback: ModuleControlStatus): ModuleControlStatus {
  return MODULE_CONTROL_STATUSES.includes(value as ModuleControlStatus)
    ? (value as ModuleControlStatus)
    : fallback;
}

function defaultMessage(definition: ModuleControlDefinition, status: ModuleControlStatus) {
  if (status === "closed") return `${definition.name}已暂停，请稍后再试`;
  if (status === "admin") return `${definition.name}当前仅管理员可用`;
  if (status === "hidden") return `${definition.name}暂未开放`;
  if (status === "coming-soon") return `${definition.name}正在准备中，敬请期待`;
  return "";
}

export function isControlledModuleKey(key: string): key is ControlledModuleKey {
  return DEFINITION_BY_KEY.has(key as ControlledModuleKey);
}

export function getModuleControlDefinition(key: string) {
  return DEFINITION_BY_KEY.get(key as ControlledModuleKey);
}

export function getModuleControlDefinitionByModuleType(module: ModuleType) {
  return DEFINITION_BY_MODULE_TYPE.get(module);
}

export function getModuleStatusLabel(status: ModuleControlStatus) {
  return MODULE_STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status;
}

export function getModuleBadge(status: ModuleControlStatus, fallbackComingSoon = false) {
  if (status === "admin") return "管理员";
  if (status === "closed") return "暂停";
  if (status === "hidden") return "隐藏";
  if (status === "coming-soon" || fallbackComingSoon) return "soon";
  return undefined;
}

export function isModuleVisible(control: Pick<ModuleControl, "status">, isAdmin: boolean) {
  if (control.status === "hidden" || control.status === "admin") return isAdmin;
  return true;
}

export function isModuleUsable(control: Pick<ModuleControl, "status">, isAdmin: boolean) {
  if (control.status === "open") return true;
  if (control.status === "admin" || control.status === "hidden") return isAdmin;
  return false;
}

// React cache：同一请求内（layout/header/sidebar/page 各处调用）只查一次库
export const getModuleControls = cache(
  async (): Promise<Record<ControlledModuleKey, ModuleControl>> => {
    const keys = MODULE_CONTROL_DEFINITIONS.flatMap((item) => [statusKey(item.key), messageKey(item.key)]);
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
    const values = new Map(rows.map((row) => [row.key, row.value]));

    return Object.fromEntries(
      MODULE_CONTROL_DEFINITIONS.map((definition) => {
        const status = normalizeStatus(values.get(statusKey(definition.key)), definition.defaultStatus);
        const message = values.get(messageKey(definition.key))?.trim() || defaultMessage(definition, status);
        return [definition.key, { ...definition, status, message }];
      })
    ) as Record<ControlledModuleKey, ModuleControl>;
  }
);

export async function getModuleControl(key: ControlledModuleKey) {
  const controls = await getModuleControls();
  return controls[key];
}

export async function getModuleAccess(key: ControlledModuleKey, role?: Role | string | null) {
  const control = await getModuleControl(key);
  const isAdmin = role === "ADMIN";
  return {
    ...control,
    visible: isModuleVisible(control, isAdmin),
    usable: isModuleUsable(control, isAdmin),
  };
}

export async function requireModulePageAccess(key: ControlledModuleKey) {
  const session = await auth();
  const access = await getModuleAccess(key, session?.user?.role);
  return access;
}

export async function getVisibleMarketingModules(role?: Role | string | null) {
  const controls = await getModuleControls();
  const isAdmin = role === "ADMIN";

  return MODULES.flatMap((module) => {
    const control = controls[module.key as ControlledModuleKey];
    if (!control || !isModuleVisible(control, isAdmin)) return [];
    const fallbackComingSoon = module.status === "coming-soon";
    const usable = module.status === "active" && isModuleUsable(control, isAdmin);
    return [
      {
        ...module,
        control,
        usable,
        badge: usable ? "可用" : getModuleStatusLabel(fallbackComingSoon ? "coming-soon" : control.status),
      },
    ];
  });
}

export async function getSidebarControlState(role?: Role | string | null): Promise<SidebarControlState> {
  const controls = await getModuleControls();
  const isAdmin = role === "ADMIN";

  const modules = MODULES.flatMap((module) => {
    const control = controls[module.key as ControlledModuleKey];
    if (!control || !isModuleVisible(control, isAdmin)) return [];
    return [
      {
        key: module.key,
        status: control.status,
        badge: getModuleBadge(control.status, module.status === "coming-soon"),
      },
    ];
  });

  const account = (["materials", "library", "credits", "feedback"] as ControlledModuleKey[]).flatMap((key) => {
    const control = controls[key];
    if (!control || !isModuleVisible(control, isAdmin)) return [];
    return [{ key, status: control.status, badge: getModuleBadge(control.status) }];
  });

  return { modules, account };
}

export async function assertControlledModuleAvailableForUser(
  key: ControlledModuleKey,
  userId: string
) {
  const [control, user] = await Promise.all([
    getModuleControl(key),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ]);
  if (!isModuleUsable(control, user?.role === "ADMIN")) {
    throw new Error(control.message);
  }
}

export async function updateModuleControls(input: {
  key: string;
  status: string;
  message?: string;
}[]) {
  const updates = input.map((item) => {
    if (!isControlledModuleKey(item.key)) {
      throw new Error("模块不存在");
    }
    const definition = DEFINITION_BY_KEY.get(item.key)!;
    const status = normalizeStatus(item.status, definition.defaultStatus);
    return {
      key: item.key,
      status,
      message: item.message?.trim() || "",
    };
  });

  await prisma.$transaction(
    updates.flatMap((item) => [
      prisma.setting.upsert({
        where: { key: statusKey(item.key) },
        update: { value: item.status },
        create: { key: statusKey(item.key), value: item.status },
      }),
      prisma.setting.upsert({
        where: { key: messageKey(item.key) },
        update: { value: item.message },
        create: { key: messageKey(item.key), value: item.message },
      }),
    ])
  );

  return updates;
}

export function getStaticModuleMeta(key: string) {
  return MODULE_LOOKUP.get(key);
}
