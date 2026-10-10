import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateApiAccessToken, readBearerToken } from "@/lib/api-access-tokens";
import { JSON_BODY_LIMITS, jsonRequestErrorDetails, readLimitedJsonBody } from "@/lib/json-request";
import { logger } from "@/lib/logger";
import { createKitnavMcpServer } from "@/lib/mcp/kitnav-mcp-server";
import { enforceIpRequestLimit, enforceUserRequestLimit, REQUEST_LIMITS } from "@/lib/request-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
	return Response.json(
		{ jsonrpc: "2.0", error: { code: -32001, message: "需要有效的访问令牌：Authorization: Bearer kn_..." }, id: null },
		{ status: 401, headers: { "WWW-Authenticate": 'Bearer realm="kitnav-mcp"' } },
	);
}

function siteOrigin(req: Request) {
	const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
	if (configured) {
		try {
			return new URL(configured).origin;
		} catch {
			// 配置无效时回退到请求地址
		}
	}
	return new URL(req.url).origin;
}

/**
 * MCP Streamable HTTP 端点（无状态模式，JSON 响应）。
 * 使用个人访问令牌认证，每个请求创建一个绑定该用户的 MCP Server，处理完即释放。
 */
export async function POST(req: Request) {
	const token = readBearerToken(req.headers.get("authorization"));
	const identity = token ? await authenticateApiAccessToken(token) : null;
	if (!identity) {
		// 无效令牌按 IP 限流，限制暴力尝试
		const limited = await enforceIpRequestLimit(req, REQUEST_LIMITS.mcpAuthFailure);
		return limited ?? unauthorized();
	}
	const limited = await enforceUserRequestLimit(identity.userId, REQUEST_LIMITS.mcp);
	if (limited) return limited;

	let body: unknown;
	try {
		body = await readLimitedJsonBody(req, JSON_BODY_LIMITS.pptGeneration);
	} catch (error) {
		const details = jsonRequestErrorDetails(error, "请求体不是有效的 JSON");
		return Response.json(
			{ jsonrpc: "2.0", error: { code: -32700, message: details.message }, id: null },
			{ status: details.status },
		);
	}

	const server = createKitnavMcpServer({ userId: identity.userId, origin: siteOrigin(req) });
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	try {
		await server.connect(transport);
		return await transport.handleRequest(req, { parsedBody: body });
	} catch (error) {
		logger.error("mcp", "处理 MCP 请求失败", { error });
		return Response.json(
			{ jsonrpc: "2.0", error: { code: -32603, message: "服务暂时不可用" }, id: null },
			{ status: 500 },
		);
	} finally {
		await server.close().catch(() => undefined);
	}
}

/** 无状态模式不支持服务端推送流和会话删除。 */
function methodNotAllowed() {
	return Response.json(
		{ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null },
		{ status: 405, headers: { Allow: "POST" } },
	);
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
