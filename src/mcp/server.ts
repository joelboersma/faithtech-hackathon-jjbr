import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { greetingSchema } from "../lib/validation";

export function createMcpServer() {
  const server = new McpServer({ name: "faithtech-starter", version: "0.1.0" });

  server.registerTool(
    "greet",
    {
      description: "Return a greeting. Replace this with your application tools.",
      inputSchema: greetingSchema.shape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => ({ content: [{ type: "text", text: `Hello, ${name}!` }] }),
  );

  server.registerResource(
    "app-info",
    "faithtech://info",
    { description: "Starter application information", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ name: "FaithTech starter", version: "0.1.0" }) }],
    }),
  );

  return server;
}
