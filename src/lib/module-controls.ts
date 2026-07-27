import { cache } from "react";
import type { Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import {
  getModuleBadge,
  getModuleControlDefinition,
  getModuleControlDefinitionByModuleType,
  getModuleStatusLabel,
  isControlledModuleKey,
  isModuleUsable,
  isModuleVisible,
  messageKey,
  MODULE_CONTROL_DEFINITIONS,
  MODULE_CONTROL_STATUSES,
  MODULE_STATUS_OPTIONS,
  normalizeStatus,
  resolveModuleControls,
  statusKey,
  type ControlledModuleKey,
  type ModuleControl,
  type ModuleControlDefinition,
  type ModuleControlStatus,
} from "@/lib/module-control-core";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettingRows } from "@/lib/credits";
import { MODULES } from "@/lib/modules";

export {
  getModuleBadge,
  getModuleControlDefinition,
  getModuleControlDefinitionByModuleType,
  getModuleStatusLabel,
  isControlledModuleKey,
  isModuleUsable,
  isModuleVisible,
  MODULE_CONTROL_DEFINITIONS,
  MODULE_CONTROL_STATUSES,
  MODULE_STATUS_OPTIONS,
  type ControlledModuleKey,
  type ModuleControl,
  type ModuleControlDefinition,
  type ModuleControlStatus,
};

export interface SidebarModuleState {
  key: string;
  status: ModuleControlStatus;
  badge?: string;
}

export interface SidebarControlState {
  modules: SidebarModuleState[];
  account: SidebarModuleState[];
}

const MODULE_LOOKUP = new Map(MODULES.map((module) => [module.key, module]));

async function loadModuleControls() {
  return resolveModuleControls(await getSettingRows());
}

// React cache deduplicates layout/header/sidebar/page reads within one request.
export const getModuleControls = cache(loadModuleControls);

export async function getModuleControl(key: ControlledModuleKey) {
  const controls = await getModuleControls();
  return controls[key];
}

export async function getModuleAccess(
  key: ControlledModuleKey,
  role?: Role | string | null,
) {
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
        badge: usable
          ? "可用"
          : getModuleStatusLabel(
              fallbackComingSoon ? "coming-soon" : control.status,
            ),
      },
    ];
  });
}

export async function getSidebarControlState(
  role?: Role | string | null,
): Promise<SidebarControlState> {
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

  const account = (
    ["materials", "library", "credits", "feedback"] as ControlledModuleKey[]
  ).flatMap((key) => {
    const control = controls[key];
    if (!control || !isModuleVisible(control, isAdmin)) return [];
    return [{ key, status: control.status, badge: getModuleBadge(control.status) }];
  });

  return { modules, account };
}

export async function assertControlledModuleAvailableForUser(
  key: ControlledModuleKey,
  userId: string,
) {
  const [control, user] = await Promise.all([
    getModuleControl(key),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ]);
  if (!isModuleUsable(control, user?.role === "ADMIN")) {
    throw new Error(control.message);
  }
}

export async function updateModuleControls(
  input: {
    key: string;
    status: string;
    message?: string;
  }[],
) {
  return prisma.$transaction((tx) =>
    updateModuleControlsInTransaction(tx, input),
  );
}

export async function updateModuleControlsInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    key: string;
    status: string;
    message?: string;
  }[],
) {
  const updates = input.map((item) => {
    if (!isControlledModuleKey(item.key)) {
      throw new Error("模块不存在");
    }
    const definition = getModuleControlDefinition(item.key)!;
    const status = normalizeStatus(item.status, definition.defaultStatus);
    return {
      key: item.key,
      status,
      message: item.message?.trim() || "",
    };
  });

  await Promise.all(
    updates.flatMap((item) => [
      tx.setting.upsert({
        where: { key: statusKey(item.key) },
        update: { value: item.status },
        create: { key: statusKey(item.key), value: item.status },
      }),
      tx.setting.upsert({
        where: { key: messageKey(item.key) },
        update: { value: item.message },
        create: { key: messageKey(item.key), value: item.message },
      }),
    ]),
  );

  return updates;
}

export function getStaticModuleMeta(key: string) {
  return MODULE_LOOKUP.get(key);
}
