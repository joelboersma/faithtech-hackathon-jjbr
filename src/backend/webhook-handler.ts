import { z } from "zod";
import { inboundSchema, verifySinchSignature } from "./sinch-webhook";

export const webhookEnvSchema = z.object({
  SINCH_WEBHOOK_SECRET: z.string().min(1),
  SINCH_PROJECT_ID: z.string().min(1),
  SINCH_APP_ID: z.string().min(1),
});

type WebhookDependencies = {
  env: () => z.infer<typeof webhookEnvSchema>;
  process: (inbound: z.infer<typeof inboundSchema>, raw: object) => Promise<void>;
};

export function createSinchWebhookHandler(dependencies: WebhookDependencies) {
  return async (request: Request) => {
    let env: z.infer<typeof webhookEnvSchema>;
    try { env = dependencies.env(); }
    catch { return Response.json({ error: "Sinch webhook is not configured" }, { status: 503 }); }
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 256000) return Response.json({ error: "Payload too large" }, { status: 413 });
    if (!verifySinchSignature(raw, request.headers, env.SINCH_WEBHOOK_SECRET)) {
      return Response.json({ error: "Invalid Sinch signature" }, { status: 401 });
    }
    let payload: unknown;
    try { payload = JSON.parse(raw); }
    catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
    const envelope = z.object({ project_id: z.string(), app_id: z.string(), trigger: z.string().optional() }).safeParse(payload);
    if (!envelope.success) return Response.json({ error: "Invalid callback" }, { status: 400 });
    if (envelope.data.app_id !== env.SINCH_APP_ID || envelope.data.project_id !== env.SINCH_PROJECT_ID) {
      return Response.json({ error: "Unexpected Sinch app or project" }, { status: 403 });
    }
    if (envelope.data.trigger && envelope.data.trigger !== "MESSAGE_INBOUND") {
      return Response.json({ status: "ignored" });
    }
    // Older Conversation API callbacks can omit trigger. Receipts and outbound
    // callbacks must never start the agent or create a reply loop.
    if (!envelope.data.trigger && !z.object({ message: z.object({ direction: z.literal("TO_APP") }) }).safeParse(payload).success) {
      return Response.json({ status: "ignored" });
    }
    const inbound = inboundSchema.safeParse(payload);
    if (!inbound.success) return Response.json({ error: "Invalid inbound message; use Sinch CONVERSATION mode" }, { status: 400 });
    try {
      await dependencies.process(inbound.data, payload as object);
      return Response.json({ status: "processed" });
    } catch {
      // Non-2xx allows Sinch to retry transient database, agent and send failures.
      // Do not expose messages, credentials or provider error bodies in responses.
      return Response.json({ error: "Message processing unavailable; retry later" }, { status: 503 });
    }
  };
}
