/**
 * 轻量结构化日志器。
 *
 * 为何不用 pino/winston：全项目仅有约 14 处运维级日志（后台任务错误、worker 异常、
 * 重试记录），均为低频且无请求级高吞吐场景。引入 pino 需额外处理 Turbopack 下
 * transport worker 的打包问题，收益与成本不成比例。本模块以最小依赖提供结构化输出：
 *  - 生产：单行 JSON（含 level/time/msg/module/以及任意 context 字段），便于日志聚合。
 *  - 开发：可读的多行格式。
 *  - Error 对象自动展开 message/stack/cause，避免打印出 `{}`。
 */

type Level = "error" | "warn" | "info" | "debug";

const LEVEL_PRIORITY: Record<Level, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

function configuredLevel(): Level {
	const env = (process.env.LOG_LEVEL || "info").toLowerCase();
	return env in LEVEL_PRIORITY ? (env as Level) : "info";
}

const isDev = process.env.NODE_ENV !== "production";
const minPriority = LEVEL_PRIORITY[configuredLevel()];

/** 把任意值规范化为可序列化对象，重点处理 Error。 */
function serialize(value: unknown): unknown {
	if (value instanceof Error) {
		const obj: Record<string, unknown> = {
			message: value.message,
			stack: value.stack,
		};
		if (value.cause !== undefined) obj.cause = serialize(value.cause);
		// 保留 Error 子类的自定义可枚举属性
		for (const key of Object.keys(value)) {
			if (!(key in obj))
				obj[key] = (value as unknown as Record<string, unknown>)[key];
		}
		return obj;
	}
	if (typeof value === "object" && value !== null) {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
		return out;
	}
	return value;
}

function emit(
	level: Level,
	module: string,
	message: string,
	context?: Record<string, unknown>,
): void {
	if (LEVEL_PRIORITY[level] > minPriority) return;
	const time = new Date().toISOString();
	const ctx = context
		? Object.fromEntries(
				Object.entries(context).map(([k, v]) => [k, serialize(v)]),
			)
		: undefined;
	const stream =
		level === "error" || level === "warn" ? process.stderr : process.stdout;

	if (isDev) {
		const tag = `[${level.toUpperCase()}] [${module}]`;
		const tail = ctx ? " " + JSON.stringify(ctx) : "";
		stream.write(`${tag} ${message}${tail}\n`);
		return;
	}
	const line = JSON.stringify({ level, time, module, msg: message, ...ctx });
	stream.write(line + "\n");
}

export const logger = {
	error: (module: string, message: string, context?: Record<string, unknown>) =>
		emit("error", module, message, context),
	warn: (module: string, message: string, context?: Record<string, unknown>) =>
		emit("warn", module, message, context),
	info: (module: string, message: string, context?: Record<string, unknown>) =>
		emit("info", module, message, context),
	debug: (module: string, message: string, context?: Record<string, unknown>) =>
		emit("debug", module, message, context),
};

/**
 * 生成一个用于 fire-and-forget `.catch(onError(...))` 的错误处理器，
 * 取代语义模糊的 `.catch(console.error)`，确保后台任务失败被结构化记录。
 */
export function onError(
	module: string,
	message: string,
): (error: unknown) => void {
	return (error: unknown) => emit("error", module, message, { error });
}
