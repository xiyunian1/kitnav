import { describe, expect, it, vi } from "vitest";

// 被测函数不访问数据库和登录态；替换掉 next-auth 与 Prisma，避免在单元测试中初始化它们
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
	apiTokenDisplayPrefix,
	generateApiTokenValue,
	hashApiToken,
	readBearerToken,
} from "@/lib/api-access-tokens";
import {
	createPptDownloadUrl,
	PPT_SIGNED_DOWNLOAD_TTL_MS,
	signPptDownload,
	verifyPptDownloadSignature,
} from "@/lib/ppt-agent/pptx-download";
import type { PptPlanningRecommendations } from "@/lib/ppt-agent/planning-confirmation";
import {
	buildDesignConfirmation,
	buildPptGenerationBody,
	createKitnavMcpServer,
	McpToolError,
	readApiResponse,
	type CreatePptInput,
} from "./kitnav-mcp-server";

const env = { AUTH_SECRET: "test-secret-for-signing" };

describe("API access tokens", () => {
	it("generates unguessable tokens that the bearer parser accepts", () => {
		const token = generateApiTokenValue();
		expect(token).toMatch(/^kn_[A-Za-z0-9_-]{43}$/);
		expect(generateApiTokenValue()).not.toBe(token);
		expect(readBearerToken(`Bearer ${token}`)).toBe(token);
		expect(readBearerToken(`bearer  ${token} `)).toBe(token);
		expect(hashApiToken(token)).toMatch(/^[0-9a-f]{64}$/);
		expect(apiTokenDisplayPrefix(token)).toBe(token.slice(0, 11));
	});

	it("rejects malformed authorization headers without touching the database", () => {
		expect(readBearerToken(null)).toBeNull();
		expect(readBearerToken("Basic abc")).toBeNull();
		expect(readBearerToken("Bearer sk-not-a-kitnav-token")).toBeNull();
		expect(readBearerToken(`Bearer kn_${"a".repeat(42)}`)).toBeNull();
	});
});

describe("signed PPTX download links", () => {
	const now = Date.UTC(2026, 9, 11, 8, 0, 0);
	const link = createPptDownloadUrl({ origin: "https://ai.kitnav.com", projectId: "p1", ownerId: "u1", now, environment: env });
	const url = new URL(link.url);
	const expiresAt = Number(url.searchParams.get("exp"));
	const signature = url.searchParams.get("sig") ?? "";

	it("builds an absolute link that verifies for the owner until it expires", () => {
		expect(url.origin + url.pathname).toBe("https://ai.kitnav.com/api/ppt/projects/p1/download");
		expect(link.expiresAt.getTime()).toBe(Math.floor((now + PPT_SIGNED_DOWNLOAD_TTL_MS) / 1000) * 1000);
		const check = (overrides: Partial<Parameters<typeof verifyPptDownloadSignature>[0]>) =>
			verifyPptDownloadSignature({ projectId: "p1", ownerId: "u1", expiresAt, signature, now, environment: env, ...overrides });
		expect(check({})).toBe(true);
		expect(check({ now: now + PPT_SIGNED_DOWNLOAD_TTL_MS + 1000 })).toBe(false);
		expect(check({ ownerId: "u2" })).toBe(false);
		expect(check({ projectId: "p2" })).toBe(false);
		expect(check({ signature: signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A") })).toBe(false);
		expect(check({ environment: { AUTH_SECRET: "other" } })).toBe(false);
	});

	it("rejects correctly signed links whose lifetime exceeds the limit", () => {
		const farFuture = Math.floor(now / 1000) + 24 * 3600;
		const forged = signPptDownload("p1", "u1", farFuture, env);
		expect(verifyPptDownloadSignature({ projectId: "p1", ownerId: "u1", expiresAt: farFuture, signature: forged, now, environment: env })).toBe(false);
	});
});

describe("MCP tool input mapping", () => {
	const models = [
		{ model: "deepseek-v4-pro", source: "platform" as const },
		{ model: "my-model", source: "user" as const },
	];
	const base: CreatePptInput = {
		slide_count: 10,
		aspect_ratio: "16:9",
		style: "auto",
		confirm_design: false,
		visual_review: false,
	};

	it("maps a topic request onto the web generation body with the default model", () => {
		expect(buildPptGenerationBody({ ...base, topic: "医药仓储数字化" }, models)).toEqual({
			sourceType: "topic",
			sourceTopic: "医药仓储数字化",
			slideCount: 10,
			aspectRatio: "16:9",
			style: "auto",
			model: "deepseek-v4-pro",
			modelSource: "platform",
			confirmDesign: false,
			visualReview: false,
		});
	});

	it("maps markdown content, explicit model and content options", () => {
		const body = buildPptGenerationBody(
			{ ...base, content: "# 标题", model: "my-model", model_source: "user", audience: "executives", confirm_design: true },
			models,
		);
		expect(body).toMatchObject({ sourceType: "markdown", sourceMarkdown: "# 标题", model: "my-model", modelSource: "user", audience: "executives", confirmDesign: true });
		expect(body).not.toHaveProperty("sourceTopic");
	});

	it("explains invalid input", () => {
		expect(() => buildPptGenerationBody(base, models)).toThrow(McpToolError);
		expect(() => buildPptGenerationBody({ ...base, topic: "a", content: "b" }, models)).toThrow("topic 或 content");
		expect(() => buildPptGenerationBody({ ...base, topic: "a", model: "gpt-x" }, models)).toThrow("可用模型：deepseek-v4-pro（platform）");
		expect(() => buildPptGenerationBody({ ...base, topic: "a" }, [])).toThrow("没有可用的 PPT 模型");
	});

	it("confirms the recommended design unless the caller overrides a choice", () => {
		const recommendations = {
			recommendedDirectionId: "d1",
			recommendedPaletteId: "p1",
			recommendedTypographyId: "t1",
			recommendedImageStrategyId: "i1",
			pagePlan: [{ page: 1, title: "封面", purpose: "开场", rhythm: "anchor", layoutFamily: "cover" }],
		} as unknown as PptPlanningRecommendations;
		expect(buildDesignConfirmation(recommendations, { project_id: "x", palette_id: "p3" })).toEqual({
			kind: "design",
			directionId: "d1",
			paletteId: "p3",
			typographyId: "t1",
			imageStrategyId: "i1",
			pagePlan: recommendations.pagePlan,
		});
	});

	it("turns API error responses into tool errors with the server message", async () => {
		await expect(readApiResponse(Response.json({ projectId: "p" }))).resolves.toEqual({ projectId: "p" });
		await expect(readApiResponse(Response.json({ error: "积分不足" }, { status: 402 }))).rejects.toThrow("积分不足");
		await expect(readApiResponse(new Response("oops", { status: 502 }))).rejects.toThrow("HTTP 502");
	});
});

describe("KitNav MCP server", () => {
	it("exposes the PPT tools with input schemas over the MCP protocol", async () => {
		const server = createKitnavMcpServer({ userId: "u1", origin: "https://ai.kitnav.com" });
		const client = new Client({ name: "test", version: "1.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual(
			["confirm_ppt_plan", "create_ppt", "get_ppt_download", "get_ppt_status", "list_my_ppts", "list_ppt_models"].sort(),
		);
		const create = tools.find((tool) => tool.name === "create_ppt");
		expect(create?.inputSchema.properties).toHaveProperty("topic");
		expect(create?.inputSchema.properties).toHaveProperty("slide_count");
		expect(tools.find((tool) => tool.name === "get_ppt_status")?.annotations?.readOnlyHint).toBe(true);
		expect(client.getInstructions()).toContain("create_ppt");
		await client.close();
	});
});
