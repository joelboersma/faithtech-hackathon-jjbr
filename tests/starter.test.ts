import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server";
import { POST } from "../src/app/api/hello/route";

test("hello endpoint validates JSON and trims the name", async () => {
  for (const body of ["{", JSON.stringify({ name: " " })]) {
    const response = await POST(new Request("http://localhost/api/hello", { method: "POST", body }));
    assert.equal(response.status, 400);
  }
  const response = await POST(new Request("http://localhost/api/hello", {
    method: "POST", body: JSON.stringify({ name: "  FaithTech  " }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: "Hello, FaithTech!" });
});

test("MCP client can discover tools, call greet, and read the resource", async () => {
  const server = createMcpServer();
  const client = new Client({ name: "starter-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "greet"));
    const result = await client.callTool({ name: "greet", arguments: { name: "FaithTech" } });
    assert.deepEqual(result.content, [{ type: "text", text: "Hello, FaithTech!" }]);
    const invalid = await client.callTool({ name: "greet", arguments: { name: " " } });
    assert.equal(invalid.isError, true);
    const resource = await client.readResource({ uri: "faithtech://info" });
    assert.equal(resource.contents[0].mimeType, "application/json");
  } finally {
    await client.close();
    await server.close();
  }
});
