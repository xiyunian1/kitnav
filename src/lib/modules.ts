import type { LucideIcon } from "lucide-react";
import { ImageIcon, Video, Music, FileText, Code, Presentation } from "lucide-react";

export type ModuleStatus = "active" | "coming-soon";

export interface AppModule {
  key: string;
  name: string;
  description: string;
  icon: LucideIcon;
  href: string;
  status: ModuleStatus;
  // 对应数据库 ModuleType 枚举（仅 active 模块需要）
  moduleType?: "IMAGE" | "VIDEO" | "PPT";
  // 主题色，用于卡片渐变
  accent: string;
}

// 模块注册表 —— 首页卡片、用户区侧边栏导航都从这里渲染。
// 新增一个 AI 模块：在此加一项 + 加对应页面 + （若需生成）加 Provider 实现。
export const MODULES: AppModule[] = [
  {
    key: "image",
    name: "图片生成",
    description: "输入文字描述，AI 为你生成精美图片",
    icon: ImageIcon,
    href: "/image",
    status: "active",
    moduleType: "IMAGE",
    accent: "from-violet-500 to-purple-600",
  },
  {
    key: "video",
    name: "视频生成",
    description: "文字或图片转视频，敬请期待",
    icon: Video,
    href: "/video",
    status: "coming-soon",
    moduleType: "VIDEO",
    accent: "from-sky-500 to-blue-600",
  },
  {
    key: "ppt",
    name: "PPT 生成",
    description: "从任意文档生成原生可编辑的 PPT",
    icon: Presentation,
    href: "/ppt",
    status: "active",
    moduleType: "PPT",
    accent: "from-orange-500 to-red-600",
  },
  {
    key: "audio",
    name: "音频生成",
    description: "AI 配音与音乐创作，敬请期待",
    icon: Music,
    href: "/audio",
    status: "coming-soon",
    accent: "from-emerald-500 to-teal-600",
  },
  {
    key: "copywriting",
    name: "文案写作",
    description: "智能文案与内容创作，敬请期待",
    icon: FileText,
    href: "/copywriting",
    status: "coming-soon",
    accent: "from-pink-500 to-rose-600",
  },
  {
    key: "code",
    name: "代码助手",
    description: "AI 编程与代码生成，敬请期待",
    icon: Code,
    href: "/code",
    status: "coming-soon",
    accent: "from-slate-500 to-gray-600",
  },
];

export function getModule(key: string): AppModule | undefined {
  return MODULES.find((m) => m.key === key);
}

export const ACTIVE_MODULES = MODULES.filter((m) => m.status === "active");
