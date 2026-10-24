import assert from "node:assert/strict";
import test from "node:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { OpenRouterModel, openRouterEnvSchema } from "../src/backend/openrouter";
import { runChurchAgent } from "../src/backend/agent";
import type { ChurchTools } from "../src/backend/church-service";

const config = () => ({ OPENROUTER_API_KEY: "test-key", OPENROUTER_MODEL: "z-ai/glm-5.3-flash" });
const tool: Tool = { name: "update_baptisms_2026", description: "Set 2026 total", inputSchema: {
  type: "object", properties: { total: { type: "integer", minimum: 0 } }, required: ["total"],
} };
const input = { instructions: "Church assistant", messages: [{ role: "user" as const, content: "We have 12 baptisms" }], tools: [tool] };
const completion = (message: object, finish_reason = "stop") => ({ choices: [{ finish_reason, message }] });
const toolCall = (id: string, name: string, args: object) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

test("OpenRouter defaults to the requested model and requires a private API key", () => {
  assert.equal(openRouterEnvSchema.parse({ OPENROUTER_API_KEY: "key" }).OPENROUTER_MODEL, "z-ai/glm-5.3-flash");
  assert.equal(openRouterEnvSchema.safeParse({ OPENROUTER_API_KEY: " " }).success, false);
});

test("GLM agent completes onboarding and baptism updates using native MCP tool-call round trips", async () => {
  const reasoning = [{ type: "reasoning.encrypted", data: "opaque-context", id: "r1", format: "unknown", index: 0 }];
  const responses = [
    completion({ content: null, reasoning_details: reasoning,
      tool_calls: [toolCall("onboard-1", "onboard_church", { name: "Grace Church", location: "Portland, USA" })] }, "tool_calls"),
    completion({ content: null, tool_calls: [toolCall("baptisms-1", "update_baptisms_2026", { total: 12 })] }, "tool_calls"),
    completion({ content: "Grace Church is registered with 12 baptisms in 2026." }),
  ];
  const requests: Record<string, unknown>[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
    assert.ok(init?.signal);
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    assert.equal(body.model, "z-ai/glm-5.3-flash");
    assert.equal(body.parallel_tool_calls, false);
    assert.deepEqual(body.provider, { require_parameters: true });
    assert.equal(body.tools.length, 4);
    assert.equal(body.messages[0].role, "system");
    assert.ok(body.tools.every((item: { function: { parameters: { properties: object } } }) => !("inboundMessageId" in item.function.parameters.properties)));
    if (requests.length === 2) {
      assert.equal(body.messages[2].role, "assistant");
      assert.deepEqual(body.messages[2].reasoning_details, reasoning);
      assert.equal(body.messages[2].tool_calls[0].id, "onboard-1");
      assert.equal(body.messages[3].role, "tool");
      assert.equal(body.messages[3].tool_call_id, "onboard-1");
    }
    return Response.json(responses.shift());
  };
  const calls: { name: string; id: string; input?: unknown }[] = [];
  const service: ChurchTools = {
    getContext: async (id) => ({ inboundMessageId: id, message: "Register Grace Church in Portland, USA with 12 baptisms", church: null, history: [] }),
    onboardChurch: async (id, data) => { calls.push({ name: "onboard", id, input: data }); return { id: "1", ...data, baptisms2026: 0 }; },
    updateBaptisms: async (id, data) => { calls.push({ name: "update", id, input: data }); return { name: "Grace Church", year: 2026, previousTotal: 0, total: data.total }; },
    reply: async (id, data) => { calls.push({ name: "reply", id, input: data }); return { messageId: "reply-1", status: "sent" }; },
  };
  await runChurchAgent("42", new OpenRouterModel(config, request), service);
  assert.equal(requests.length, 3);
  assert.deepEqual(calls.map((call) => [call.name, call.id]), [["onboard", "42"], ["update", "42"], ["reply", "42"]]);
  assert.deepEqual(calls[2].input, { text: "Grace Church is registered with 12 baptisms in 2026." });
});

test("OpenRouter failures reject without exposing upstream response bodies", async () => {
  for (const status of [401, 429, 500]) {
    const model = new OpenRouterModel(config, async () => new Response("private-key-and-message", { status }));
    await assert.rejects(model.decide(input), (error: Error) => {
      assert.ok(error.message.includes(String(status)));
      assert.ok(!error.message.includes("private-key"));
      return true;
    });
  }
});

test("OpenRouter rejects empty, truncated, malformed and non-object tool responses", async () => {
  const invalid = [
    { error: { message: "private provider failure" } },
    completion({ content: "" }),
    completion({ content: "partial confirmation" }, "length"),
    completion({ content: null, tool_calls: [] }, "tool_calls"),
    completion({ tool_calls: [{ id: "x", type: "function", function: { name: tool.name, arguments: "{" } }] }, "tool_calls"),
    completion({ tool_calls: [{ id: "x", type: "function", function: { name: tool.name, arguments: "[]" } }] }, "tool_calls"),
  ];
  for (const payload of invalid) {
    await assert.rejects(new OpenRouterModel(config, async () => Response.json(payload)).decide(input));
  }
  await assert.rejects(new OpenRouterModel(config, async () => new Response("{")).decide(input), /invalid JSON/);
});

test("OpenRouter honors the agent cancellation signal", async () => {
  const controller = new AbortController();
  controller.abort();
  const model = new OpenRouterModel(config, async (_url, init) => {
    init?.signal?.throwIfAborted();
    throw new Error("Expected an aborted signal");
  });
  await assert.rejects(model.decide({ ...input, signal: controller.signal }), { name: "AbortError" });
});
