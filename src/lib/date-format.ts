export const CHINA_TIME_ZONE = "Asia/Shanghai";

export function formatChinaDateTime(value: Date | null | undefined) {
  if (!value) return "-";
  return value.toLocaleString("zh-CN", { timeZone: CHINA_TIME_ZONE });
}

export function formatChinaDate(value: Date | null | undefined) {
  if (!value) return "-";
  return value.toLocaleDateString("zh-CN", { timeZone: CHINA_TIME_ZONE });
}
