import { z } from "zod";
import type { AgentDecision, AgentMessage, AgentModel } from "./agent";

export const openRouterEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().trim().min(1),
  OPENROUTER_MODEL: z.string().trim().min(1).default("z-ai/glm-5.3-flash"),
});

const completionSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({
      content: z.string().nullable().optional(),
      reasoning: z.string().nullable().optional(),
      reasoning_details: z.array(z.unknown()).optional(),
      tool_calls: z.array(z.object({
        id: z.string().min(1), type: z.literal("function"),
        function: z.object({ name: z.string().min(1), arguments: z.string() }),
      })).max(4).optional(),
    }),
  })).min(1),
});

function toOpenRouterMessage(message: AgentMessage) {
  if (message.role === "user") return message;
  if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  return {
    role: "assistant", content: message.content ?? null,
    tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments) } })),
    ...(message.reasoning !== undefined && { reasoning: message.reasoning }),
    ...(message.reasoningDetails !== undefined && { reasoning_details: message.reasoningDetails }),
  };
}

export class OpenRouterModel implements AgentModel {
  constructor(
    private readonly config = () => openRouterEnvSchema.parse(process.env),
    private readonly request: typeof fetch = fetch,
  ) {}

  async decide(input: Parameters<AgentModel["decide"]>[0]): Promise<AgentDecision> {
    // Read credentials only at runtime, after the webhook has saved its message.
    const env = this.config();
    const response = await this.request("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL,
        messages: [{ role: "system", content: input.instructions }, ...input.messages.map(toOpenRouterMessage)],
        tools: input.tools.map((tool) => ({ type: "function", function: {
          name: tool.name, description: tool.description, parameters: tool.inputSchema,
        } })),
        tool_choice: "auto", parallel_tool_calls: false,
        provider: { require_parameters: true },
        max_tokens: 2048, stream: false,
      }),
    });
    // Never include upstream bodies, which can contain messages or credentials.
    if (!response.ok) throw new Error(`OpenRouter request failed (HTTP ${response.status})`);
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new Error("OpenRouter returned invalid JSON"); }
    const parsed = completionSchema.safeParse(payload);
    if (!parsed.success) throw new Error("OpenRouter returned an invalid completion");
    const { finish_reason: reason, message } = parsed.data.choices[0];
    if (reason !== "stop" && reason !== "tool_calls") throw new Error("OpenRouter completion was interrupted");
    if (message.tool_calls?.length) {
      const calls = message.tool_calls.map((call) => {
        let args: unknown;
        try { args = JSON.parse(call.function.arguments); }
        catch { throw new Error("OpenRouter returned invalid tool arguments"); }
        const result = z.record(z.string(), z.unknown()).safeParse(args);
        if (!result.success) throw new Error("OpenRouter tool arguments must be an object");
        return { id: call.id, name: call.function.name, arguments: result.data };
      });
      return { calls, content: message.content, reasoning: message.reasoning, reasoningDetails: message.reasoning_details };
    }
    if (reason === "tool_calls" || !message.content?.trim()) throw new Error("OpenRouter returned an empty completion");
    return { text: message.content.trim() };
  }
}
