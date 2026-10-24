import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server";

const server = createMcpServer();
await server.connect(new StdioServerTransport());

// stdout belongs exclusively to the MCP protocol. Send diagnostics to stderr.
async function shutdown() {
  await server.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
