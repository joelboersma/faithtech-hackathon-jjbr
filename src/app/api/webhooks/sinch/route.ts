import { processInbound } from "../../../../backend/process-inbound";
import { OpenRouterModel } from "../../../../backend/openrouter";
import { createSinchWebhookHandler, webhookEnvSchema } from "../../../../backend/webhook-handler";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = createSinchWebhookHandler({
  env: () => webhookEnvSchema.parse(process.env),
  process: (inbound, raw) => processInbound(inbound, raw, new OpenRouterModel()),
});
