import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectDir = mkdtempSync(join(tmpdir(), "ppt-agent-extension-check-"));
const configDir = join(projectDir, ".pi-agent");
const skillDir = join(projectDir, ".ppt-master-skill");
const extensionPath = resolve("scripts", "ppt-agent-extension.mjs");
const requests = [];

mkdirSync(join(skillDir, "scripts"), { recursive: true });
mkdirSync(configDir, { recursive: true });
writeFileSync(
  join(projectDir, "extension-proof.png"),
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
);

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  requests.push(body);
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });

  if (requests.length === 1) {
    writeEvent(response, {
      id: "chatcmpl-tool",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });
    writeEvent(response, {
      id: "chatcmpl-tool",
      object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_write_test",
            type: "function",
            function: {
              name: "write",
              arguments: JSON.stringify({ path: "extension-proof.txt", content: "sandboxed" }),
            },
          }],
        },
        finish_reason: null,
      }],
    });
    writeEvent(response, {
      id: "chatcmpl-tool",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    });
  } else if (requests.length === 2) {
    writeEvent(response, {
      id: "chatcmpl-image-tool",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });
    writeEvent(response, {
      id: "chatcmpl-image-tool",
      object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_read_image_test",
            type: "function",
            function: {
              name: "read",
              arguments: JSON.stringify({ path: "extension-proof.png" }),
            },
          }],
        },
        finish_reason: null,
      }],
    });
    writeEvent(response, {
      id: "chatcmpl-image-tool",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    });
  } else {
    writeEvent(response, {
      id: "chatcmpl-final",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: null }],
    });
    writeEvent(response, {
      id: "chatcmpl-final",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
  }
  response.end("data: [DONE]\n\n");
});

try {
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start mock server");
  writePiConfig(address.port);

  const result = await runPi();
  if (result.code !== 0) throw new Error(`Pi extension check failed:\n${result.output}`);
  const proofPath = join(projectDir, "extension-proof.txt");
  if (!existsSync(proofPath) || readFileSync(proofPath, "utf-8") !== "sandboxed") {
    throw new Error("The restricted write tool was not executed");
  }
  const toolNames = (requests[0]?.tools || []).map((tool) => tool.function?.name).sort();
  const expected = ["bash", "edit", "find", "grep", "ls", "read", "write"];
  if (JSON.stringify(toolNames) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected Pi tools: ${toolNames.join(", ")}`);
  }
  if (!JSON.stringify(requests[2]).includes("data:image/png;base64,")) {
    throw new Error("The restricted read tool did not return the PNG as an image attachment");
  }
  console.log(`PPT agent extension verified with tools: ${toolNames.join(", ")}`);
} finally {
  server.closeIdleConnections();
  server.closeAllConnections();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  rmSync(projectDir, { recursive: true, force: true });
}

function writeEvent(response, value) {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function writePiConfig(port) {
  writeFileSync(
    join(configDir, "settings.json"),
    JSON.stringify({ defaultProvider: "extension-check", defaultModel: "test-model" }),
  );
  writeFileSync(
    join(configDir, "models.json"),
    JSON.stringify({
      providers: {
        "extension-check": {
          name: "Extension Check",
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: "$PPT_PI_API_KEY",
          api: "openai-completions",
          models: [{
            id: "test-model",
            name: "Test Model",
            reasoning: false,
            input: ["text", "image"],
            contextWindow: 32000,
            maxTokens: 2048,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          }],
        },
      },
    }),
  );
  writeFileSync(
    join(configDir, "auth.json"),
    "{}",
  );
}

function runPi() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("pi", [
      "-p",
      "--mode", "json",
      "--approve",
      "--no-builtin-tools",
      "--no-extensions",
      "--no-context-files",
      "--extension", extensionPath,
      "--provider", "extension-check",
      "--model", "test-model",
      "--tools", "read,write,edit,bash,grep,find,ls",
      "--no-session",
      "Write the requested proof file.",
    ], {
      cwd: projectDir,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: configDir,
        PPT_PI_API_KEY: "test-key",
        PPT_AGENT_PROJECT_DIR: projectDir,
        PPT_MASTER_SKILL_DIR: skillDir,
      },
    });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Pi extension check timed out:\n${output}`));
    }, 20_000);
    child.stdin.end();
    child.stdout.on("data", (chunk) => { output += chunk.toString("utf-8"); });
    child.stderr.on("data", (chunk) => { output += chunk.toString("utf-8"); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolvePromise({ code, output });
    });
  });
}
