import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { greetingSchema } from "../lib/validation";
import { z } from "zod";
import { baptismInput, churchInput, getChurchService, replyInput, type ChurchTools } from "../backend/church-service";

export function createMcpServer(options: { inboundMessageId?: string; service?: ChurchTools } = {}) {
  const server = new McpServer({ name: "faithtech-churches", version: "0.2.0" });

  server.registerTool(
    "greet",
    {
      description: "Return a greeting to check MCP connectivity.",
      inputSchema: greetingSchema.shape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => ({ content: [{ type: "text", text: `Hello, ${name}!` }] }),
  );

  // Webhook agents receive a server bound to one verified inbound message.
  // Stdio/HTTP clients are trusted backend operators and must supply its saved ID.
  const contextSchema: Record<string, z.ZodString> = options.inboundMessageId ? {} : {
    inboundMessageId: z.string().regex(/^[1-9]\d*$/).describe("Saved inbound database message ID returned by webhook ingestion"),
  };
  const service = () => options.service ?? getChurchService();
  const contextId = (input: Record<string, unknown>) => options.inboundMessageId ?? String(input.inboundMessageId);
  const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

  server.registerTool("get_church_context", {
    description: "Read the originating message, recent conversation history, and the sender's church. Use before onboarding or updating baptisms.",
    inputSchema: contextSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (input) => result(await service().getContext(contextId(input))));

  server.registerTool("onboard_church", {
    description: "Register the sender's church using its name and location. Ask for missing details; never invent them. Repeated identical onboarding is safe. One church per Sinch contact; existing ownership cannot be reassigned.",
    inputSchema: { ...contextSchema, ...churchInput.shape },
    annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input) => result(await service().onboardChurch(contextId(input), input)));

  server.registerTool("update_baptisms_2026", {
    description: "Replace the sender's church baptism total for calendar year 2026. Requires onboarding. Use an explicit absolute total; if the user gives an increment or ambiguous year, clarify the resulting 2026 total first. Zero is valid.",
    inputSchema: { ...contextSchema, ...baptismInput.shape },
    annotations: { idempotentHint: true, destructiveHint: true, openWorldHint: false },
  }, async (input) => result(await service().updateBaptisms(contextId(input), input)));

  server.registerTool("reply_to_conversation", {
    description: "Send one text reply to the originating Sinch contact on the originating channel. Use for clarification or the final response. Destination is fixed by the verified inbound message. Repeat calls return the first saved reply; only one reply per inbound message is supported.",
    inputSchema: { ...contextSchema, ...replyInput.shape },
    annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: true },
  }, async (input) => result(await service().reply(contextId(input), input)));

  server.registerResource(
    "app-info",
    "faithtech://info",
    { description: "Church reporting application information", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ name: "FaithTech churches", version: "0.2.0", reportingYear: 2026 }) }],
    }),
  );

  return server;
}
