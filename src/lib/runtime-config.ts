export const MAX_NODE_TIMER_MS = 2_147_483_647;

export function boundedIntegerEnv(
  name: string,
  fallback: number,
  options: {
    min?: number;
    max?: number;
    environment?: Readonly<Record<string, string | undefined>>;
  } = {},
) {
  const min = options.min ?? 1;
  const max = options.max ?? MAX_NODE_TIMER_MS;
  if (
    !Number.isSafeInteger(fallback) ||
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min > max ||
    fallback < min ||
    fallback > max
  ) {
    throw new Error(`Invalid bounds for ${name}`);
  }

  const configured = (options.environment ?? process.env)[name]?.trim();
  if (!configured) return fallback;
  const value = Number(configured);
  return Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}
