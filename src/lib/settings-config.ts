// 系统设置的 key 与默认值集中定义。
// seed 用它初始化 Setting 表，后台设置页读写这些 key。

export const SETTING_KEYS = {
  SITE_NAME: "site_name",
  MAINTENANCE_MODE: "maintenance_mode",
  MAINTENANCE_MESSAGE: "maintenance_message",
  REGISTRATION_MODE: "registration_mode",
  MAX_USERS: "max_users",
  EMAIL_DOMAIN_ALLOWLIST: "email_domain_allowlist",
  DAILY_IP_REGISTER_LIMIT: "daily_ip_register_limit",
  SIGNUP_BONUS: "signup_bonus", // 注册赠送积分
  IMAGE_MODULE_ENABLED: "image_module_enabled",
  IMAGE_CREDIT_COST: "image_credit_cost", // 图片生成单价（每张）
  IMAGE_PARALLEL_LIMIT: "image_parallel_limit", // 图片多图生成并行数
  IMAGE_DAILY_USER_LIMIT: "image_daily_user_limit",
  IMAGE_USER_CONCURRENT_LIMIT: "image_user_concurrent_limit",
  IMAGE_GLOBAL_CONCURRENT_LIMIT: "image_global_concurrent_limit",
  CREDITS_RECHARGE_ENABLED: "credits_recharge_enabled",
  VIDEO_CREDIT_COST: "video_credit_cost",
  PPT_CREDIT_COST: "ppt_credit_cost",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export const DEFAULT_SETTINGS: Record<string, string> = {
  [SETTING_KEYS.SITE_NAME]: "AI 聚合站",
  [SETTING_KEYS.MAINTENANCE_MODE]: "0",
  [SETTING_KEYS.MAINTENANCE_MESSAGE]: "系统维护中，请稍后再试",
  [SETTING_KEYS.REGISTRATION_MODE]: "open",
  [SETTING_KEYS.MAX_USERS]: "0",
  [SETTING_KEYS.EMAIL_DOMAIN_ALLOWLIST]: "",
  [SETTING_KEYS.DAILY_IP_REGISTER_LIMIT]: "10",
  [SETTING_KEYS.SIGNUP_BONUS]: "100",
  [SETTING_KEYS.IMAGE_MODULE_ENABLED]: "1",
  [SETTING_KEYS.IMAGE_CREDIT_COST]: "10",
  [SETTING_KEYS.IMAGE_PARALLEL_LIMIT]: "3",
  [SETTING_KEYS.IMAGE_DAILY_USER_LIMIT]: "0",
  [SETTING_KEYS.IMAGE_USER_CONCURRENT_LIMIT]: "0",
  [SETTING_KEYS.IMAGE_GLOBAL_CONCURRENT_LIMIT]: "0",
  [SETTING_KEYS.CREDITS_RECHARGE_ENABLED]: "1",
  [SETTING_KEYS.VIDEO_CREDIT_COST]: "50",
  [SETTING_KEYS.PPT_CREDIT_COST]: "30",
};

// 设置项的展示元数据，供后台设置页渲染表单
export const SETTING_META: {
  key: string;
  label: string;
  description: string;
  type: "text" | "number";
  group?: string;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  allowEmpty?: boolean;
}[] = [
  { key: SETTING_KEYS.SITE_NAME, label: "站点名称", description: "显示在导航栏和标题", type: "text", group: "基础" },
  {
    key: SETTING_KEYS.MAINTENANCE_MODE,
    label: "维护模式",
    description: "开启后普通用户无法使用前台受保护页面，管理员不受影响",
    type: "number",
    group: "基础",
    min: 0,
    max: 1,
    integer: true,
  },
  { key: SETTING_KEYS.MAINTENANCE_MESSAGE, label: "维护提示", description: "维护模式下展示给用户的提示", type: "text", group: "基础" },
  {
    key: SETTING_KEYS.REGISTRATION_MODE,
    label: "注册模式",
    description: "open=开放，closed=关闭，invite=邀请码，linuxdo=仅 Linux.do",
    type: "text",
    group: "注册",
    options: [
      { label: "开放注册", value: "open" },
      { label: "关闭注册", value: "closed" },
      { label: "仅邀请码", value: "invite" },
      { label: "仅 Linux.do", value: "linuxdo" },
    ],
  },
  { key: SETTING_KEYS.MAX_USERS, label: "注册人数上限", description: "0 表示不限制", type: "number", group: "注册", min: 0, integer: true },
  { key: SETTING_KEYS.EMAIL_DOMAIN_ALLOWLIST, label: "邮箱域名白名单", description: "逗号分隔，留空表示不限，如 gmail.com,qq.com", type: "text", group: "注册", allowEmpty: true },
  { key: SETTING_KEYS.DAILY_IP_REGISTER_LIMIT, label: "单 IP 每日注册数", description: "0 表示不限制", type: "number", group: "注册", min: 0, integer: true },
  { key: SETTING_KEYS.SIGNUP_BONUS, label: "注册赠送积分", description: "新用户注册时自动发放的积分", type: "number", group: "积分", min: 0, integer: true },
  {
    key: SETTING_KEYS.IMAGE_MODULE_ENABLED,
    label: "图片生成开关",
    description: "0=暂停图片生成，1=允许图片生成",
    type: "number",
    group: "图片",
    min: 0,
    max: 1,
    integer: true,
  },
  { key: SETTING_KEYS.IMAGE_CREDIT_COST, label: "图片生成单价", description: "每张图片消耗的积分", type: "number", group: "图片", min: 0, integer: true },
  {
    key: SETTING_KEYS.IMAGE_PARALLEL_LIMIT,
    label: "图片并行数",
    description: "多图生成时同时请求的图片数量，范围 1-10，默认 3",
    type: "number",
    group: "图片",
    min: 1,
    max: 10,
    step: 1,
    integer: true,
  },
  { key: SETTING_KEYS.IMAGE_DAILY_USER_LIMIT, label: "单用户每日生成上限", description: "0 表示不限制，按提交轮次计算", type: "number", group: "图片", min: 0, integer: true },
  { key: SETTING_KEYS.IMAGE_USER_CONCURRENT_LIMIT, label: "单用户并发任务上限", description: "0 表示不限制，统计 PENDING 轮次", type: "number", group: "图片", min: 0, integer: true },
  { key: SETTING_KEYS.IMAGE_GLOBAL_CONCURRENT_LIMIT, label: "全站并发任务上限", description: "0 表示不限制，统计 PENDING 轮次", type: "number", group: "图片", min: 0, integer: true },
  {
    key: SETTING_KEYS.CREDITS_RECHARGE_ENABLED,
    label: "积分充值开关",
    description: "0=暂停充值，1=允许充值",
    type: "number",
    group: "积分",
    min: 0,
    max: 1,
    integer: true,
  },
  { key: SETTING_KEYS.VIDEO_CREDIT_COST, label: "视频生成单价", description: "每个视频消耗的积分（模块未上线）", type: "number", group: "未来模块", min: 0, integer: true },
  { key: SETTING_KEYS.PPT_CREDIT_COST, label: "PPT 生成单价", description: "每份 PPT 消耗的积分（模块未上线）", type: "number", group: "未来模块", min: 0, integer: true },
];
