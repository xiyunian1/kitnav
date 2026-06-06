import { prisma } from "@/lib/db";

const CHINA_TIME_ZONE = "Asia/Shanghai";
const DAY_MS = 24 * 60 * 60 * 1000;

const chinaDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CHINA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function utcDateToDayKey(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function getChinaDayKey(date = new Date()) {
  const parts = chinaDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function getRecentChinaDayKeys(count: number) {
  const today = getChinaDayKey();
  const [year, month, day] = today.split("-").map(Number);
  const base = Date.UTC(year, month - 1, day);

  return Array.from({ length: count }, (_, index) => {
    const offset = count - 1 - index;
    return utcDateToDayKey(new Date(base - offset * DAY_MS));
  });
}

export function getChinaDayStart(dayKey: string) {
  return new Date(`${dayKey}T00:00:00.000+08:00`);
}

export async function recordDailyActivity(userId: string) {
  const day = getChinaDayKey();

  try {
    await prisma.userDailyActivity.upsert({
      where: { userId_day: { userId, day } },
      update: { lastSeenAt: new Date() },
      create: { userId, day },
    });
  } catch (error) {
    console.error("Failed to record daily activity", error);
  }
}
