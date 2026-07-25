import { ScanEye } from "lucide-react";

export function GuestModeBanner() {
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
    >
      <ScanEye className="size-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">游客参观模式</span>
      <span className="text-sky-800 dark:text-sky-200">
        页面可浏览，生成、上传、收藏、充值和设置操作已关闭。
      </span>
    </div>
  );
}
