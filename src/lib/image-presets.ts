import type { AspectRatio } from "@/lib/providers/types";

// 通用大众向中文提示词预设。一键填入创作台。
// mode: "generate"=文生图（直接用）；"edit"=图生图（需先上传参考图）。
export interface ImagePreset {
  id: string;
  title: string;
  description: string;
  prompt: string;
  mode: "generate" | "edit";
  ratio?: AspectRatio;
  referenceImageUrl?: string;
  referenceTitle?: string;
}

export const IMAGE_PRESETS: ImagePreset[] = [
  {
    id: "3d-character",
    title: "3D 卡通形象",
    description: "圆润可爱的 3D 渲染角色",
    prompt:
      "一个圆润可爱的 3D 卡通角色，柔和的材质质感，明亮干净的配色，简洁的纯色背景，柔光照明，高质量 3D 渲染，皮克斯风格",
    mode: "generate",
    ratio: "1:1",
  },
  {
    id: "id-photo",
    title: "职业头像 / 证件照",
    description: "正装职业形象照",
    prompt:
      "专业职业头像，正装着装，自然柔和的影棚灯光，纯色背景，面带微笑，高清写实，商务风格，清晰锐利的细节",
    mode: "edit",
    ratio: "3:4",
  },
  {
    id: "product-shot",
    title: "电商产品图",
    description: "干净的商业产品摄影",
    prompt:
      "高端商业产品摄影，干净的纯白背景，专业柔光箱布光，精致的反光与阴影，居中构图，超高清细节，电商主图风格",
    mode: "generate",
    ratio: "1:1",
  },
  {
    id: "illustration-avatar",
    title: "插画头像",
    description: "扁平风格人物插画",
    prompt:
      "扁平风格人物插画头像，柔和的渐变配色，简洁的线条，现代矢量插画风格，温暖友好的氛围",
    mode: "generate",
    ratio: "1:1",
  },
  {
    id: "wallpaper",
    title: "风景壁纸",
    description: "唯美自然风光",
    prompt:
      "壮丽的自然风光，唯美的光影氛围，黄金时刻的暖色调，电影感构图，超广角，高动态范围，4K 高清壁纸",
    mode: "generate",
    ratio: "16:9",
  },
  {
    id: "logo",
    title: "Logo 设计",
    description: "简约现代标志",
    prompt:
      "简约现代的品牌 Logo 设计，几何造型，扁平化，单色或双色配色，矢量风格，纯白背景，居中，专业商标设计",
    mode: "generate",
    ratio: "1:1",
  },
  {
    id: "food",
    title: "美食摄影",
    description: "诱人的食物特写",
    prompt:
      "诱人的美食摄影，俯拍或 45 度角，自然光，浅景深背景虚化，新鲜的食材，精致摆盘，杂志级商业美食大片",
    mode: "generate",
    ratio: "1:1",
  },
  {
    id: "architecture",
    title: "建筑渲染",
    description: "现代建筑效果图",
    prompt:
      "现代建筑效果图，简洁的几何线条，玻璃与混凝土材质，蓝天白云背景，专业建筑摄影，超写实渲染，宽幅构图",
    mode: "generate",
    ratio: "16:9",
  },
  {
    id: "anime",
    title: "动漫插画",
    description: "日系二次元风格",
    prompt:
      "日系动漫插画风格，精致的人物作画，鲜艳的色彩，柔和的光影，细腻的背景，高质量二次元插画",
    mode: "generate",
    ratio: "3:4",
  },
  {
    id: "watercolor",
    title: "水彩艺术",
    description: "柔和的水彩画风",
    prompt:
      "柔和的水彩画风格，晕染的色彩过渡，留白的艺术构图，纸张纹理质感，清新淡雅，手绘艺术插画",
    mode: "generate",
    ratio: "4:3",
  },
  {
    id: "restore-enhance",
    title: "照片高清修复",
    description: "提升清晰度与质感",
    prompt:
      "请对这张照片做高清修复与质感增强：提升清晰度与细节，修正曝光与白平衡，降噪去模糊，保留真实纹理，不改变主体内容与构图",
    mode: "edit",
    ratio: "1:1",
  },
  {
    id: "style-transfer",
    title: "风格转换",
    description: "把照片转成艺术风格",
    prompt:
      "把这张图片转换为艺术风格：保留主体结构与构图，重新演绎为富有艺术感的画面，统一的色调与笔触，高质量艺术作品",
    mode: "edit",
    ratio: "1:1",
  },
];
