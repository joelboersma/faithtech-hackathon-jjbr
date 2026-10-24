import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpServer } from "../src/mcp/server";
import { runChurchAgent, type AgentDecision, type AgentModel } from "../src/backend/agent";
import { buildSinchReplyRequest, type ChurchTools } from "../src/backend/church-service";
import { inboundSchema } from "../src/backend/sinch-webhook";
import { createSinchWebhookHandler } from "../src/backend/webhook-handler";
import { POST as mcpPost } from "../src/app/api/mcp/route";

const payload = {
  project_id: "project", app_id: "app", trigger: "MESSAGE_INBOUND",
  message: { id: "sinch-message", direction: "TO_APP", contact_id: "sender", conversation_id: "origin",
    channel_identity: { channel: "WHATSAPP", identity: "123" },
    contact_message: { text_message: { text: "Our church has 12 baptisms in 2026" } } },
};
const env = { SINCH_WEBHOOK_SECRET: "test-secret", SINCH_PROJECT_ID: "project", SINCH_APP_ID: "app" };

test("SMS replies use the receiving Sinch number as SMS_SENDER and keep the contact as recipient", () => {
  const inbound = inboundSchema.parse({ ...payload, message: { ...payload.message,
    sender_id: "12025550100", channel_identity: { channel: "SMS", identity: "12025550101" },
  } });
  const request = buildSinchReplyRequest(inbound, "Reply", "12025550102");
  assert.deepEqual(request.channel_properties, { SMS_SENDER: "12025550100" });
  assert.deepEqual(request.recipient, { contact_id: "sender" });
  assert.deepEqual(request.channel_priority_order, ["SMS"]);
  assert.equal(request.message_metadata, "sinch-message");
  delete inbound.message.sender_id;
  assert.deepEqual(buildSinchReplyRequest(inbound, "Reply", " 12025550102 ").channel_properties,
    { SMS_SENDER: "12025550102" });
  assert.throws(() => buildSinchReplyRequest(inbound, "Reply", ""), /require.*sender_id.*SINCH_SMS_SENDER/);
  inbound.message.sender_id = "";
  assert.throws(() => buildSinchReplyRequest(inbound, "Reply", ""), /require.*sender_id/);
});

test("non-SMS replies accept empty sender_id and omit SMS properties", () => {
  const inbound = inboundSchema.parse({ ...payload, message: { ...payload.message, sender_id: "" } });
  assert.equal(buildSinchReplyRequest(inbound, "Reply", "12025550102").channel_properties, undefined);
});

function signedRequest(body: string, secret = env.SINCH_WEBHOOK_SECRET) {
  const timestamp = "1792857600";
  const nonce = "nonce";
  return new Request("http://localhost/api/webhooks/sinch", { method: "POST", body, headers: {
    "x-sinch-webhook-signature-timestamp": timestamp,
    "x-sinch-webhook-signature-nonce": nonce,
    "x-sinch-webhook-signature-algorithm": "HmacSHA256",
    "x-sinch-webhook-signature": createHmac("sha256", secret).update(`${body}.${nonce}.${timestamp}`).digest("base64"),
  } });
}

test("Sinch webhook verifies exact bytes, validates app, ignores receipts, and propagates retryable failures", async () => {
  let calls = 0;
  const handler = createSinchWebhookHandler({ env: () => env, process: async (inbound, raw) => {
    calls++;
    assert.equal(inbound.message.conversation_id, "origin");
    assert.deepEqual(raw, payload);
  } });
  assert.equal((await handler(signedRequest(JSON.stringify(payload), "wrong-secret"))).status, 401);
  const tampered = signedRequest(JSON.stringify(payload));
  assert.equal((await handler(new Request(tampered.url, { method: "POST", headers: tampered.headers, body: JSON.stringify(payload) + " " }))).status, 401);
  assert.equal((await handler(signedRequest("{"))).status, 400);
  assert.equal((await handler(signedRequest(JSON.stringify({ ...payload, app_id: "other" })))).status, 403);
  assert.equal((await handler(signedRequest(JSON.stringify({ ...payload, trigger: "MESSAGE_DELIVERY" })))).status, 200);
  assert.equal((await handler(signedRequest(JSON.stringify({ ...payload, message: { ...payload.message, contact_id: "" } })))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await handler(signedRequest(JSON.stringify(payload)))).status, 200);
  assert.equal(calls, 1);
  const failure = createSinchWebhookHandler({ env: () => env, process: async () => { throw new Error("private provider error"); } });
  const response = await failure(signedRequest(JSON.stringify(payload)));
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("private provider error"));
});

function fakeService() {
  const calls: { name: string; id: string; input?: unknown }[] = [];
  const church = { id: "1", name: "Grace Church", location: "Portland, USA", baptisms2026: 0 };
  const service: ChurchTools = {
    getContext: async (id) => { calls.push({ name: "context", id }); return { inboundMessageId: id, message: "hello", church: null, history: [] }; },
    onboardChurch: async (id, input) => { calls.push({ name: "onboard", id, input }); return { ...church, ...input }; },
    updateBaptisms: async (id, input) => { calls.push({ name: "baptisms", id, input }); return { name: church.name, year: 2026, previousTotal: 0, total: input.total }; },
    reply: async (id, input) => { calls.push({ name: "reply", id, input }); return { messageId: "outbound", status: "sent" }; },
  };
  return { service, calls };
}

test("scoped MCP rejects invalid totals and binds writes and replies to the verified message", async () => {
  const { service, calls } = fakeService();
  const server = createMcpServer({ inboundMessageId: "42", service });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b);
    await client.connect(a);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.find((tool) => tool.name === "reply_to_conversation")!.inputSchema.properties?.inboundMessageId, undefined);
    for (const total of [-1, 1.5, "12", 2147483648]) {
      assert.equal((await client.callTool({ name: "update_baptisms_2026", arguments: { total } })).isError, true);
    }
    assert.equal((await client.callTool({ name: "onboard_church", arguments: { name: " ", location: "USA" } })).isError, true);
    assert.equal(calls.length, 0);
    await client.callTool({ name: "update_baptisms_2026", arguments: { total: 0, inboundMessageId: "99" } });
    await client.callTool({ name: "reply_to_conversation", arguments: { text: "Saved", recipient: "someone-else" } });
    assert.deepEqual(calls.map((call) => call.id), ["42", "42"]);
    assert.deepEqual(calls[1].input, { text: "Saved" });
  } finally { await client.close(); await server.close(); }
});

test("agent uses MCP tools to onboard, record baptisms, and reply in the originating conversation", async () => {
  const { service, calls } = fakeService();
  const decisions: AgentDecision[] = [
    { calls: [{ name: "onboard_church", arguments: { name: "Grace Church", location: "Portland, USA" } }] },
    { calls: [{ name: "update_baptisms_2026", arguments: { total: 12 } }] },
    { text: "Grace Church is registered with 12 baptisms in 2026." },
  ];
  const model: AgentModel = { decide: async ({ tools, messages }) => {
    assert.equal(tools.length, 4);
    assert.ok(messages.length > 0);
    return decisions.shift()!;
  } };
  await runChurchAgent("42", model, service);
  assert.deepEqual(calls.map((call) => call.name), ["context", "onboard", "baptisms", "reply"]);
  assert.ok(calls.every((call) => call.id === "42"));
});

test("agent stops after sending a reply and cannot run extra mutations in the same batch", async () => {
  const { service, calls } = fakeService();
  await runChurchAgent("42", { decide: async () => ({ calls: [
    { name: "reply_to_conversation", arguments: { text: "What is your church name?" } },
    { name: "update_baptisms_2026", arguments: { total: 999 } },
  ] }) }, service);
  assert.deepEqual(calls.map((call) => call.name), ["context", "reply"]);
});

test("HTTP MCP authenticates and supports a real client handshake and tool discovery", async () => {
  const previous = process.env.MCP_BEARER_TOKEN;
  process.env.MCP_BEARER_TOKEN = "test-token";
  const client = new Client({ name: "http-test", version: "1" });
  try {
    assert.equal((await mcpPost(new Request("http://localhost/api/mcp", { method: "POST" }))).status, 401);
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/api/mcp"), {
      requestInit: { headers: { Authorization: "Bearer test-token" } },
      fetch: async (url, init) => mcpPost(new Request(url, init)),
    });
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === "onboard_church"));
  } finally {
    await client.close();
    if (previous === undefined) delete process.env.MCP_BEARER_TOKEN;
    else process.env.MCP_BEARER_TOKEN = previous;
  }
});
