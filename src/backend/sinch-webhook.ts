import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const id = z.string().min(1).max(200);
export const inboundSchema = z.object({
  app_id: id,
  project_id: id,
  trigger: z.literal("MESSAGE_INBOUND").optional(),
  message: z.object({
    id,
    direction: z.literal("TO_APP"),
    contact_id: id,
    conversation_id: id,
    // For SMS this is our receiving number, not the contact's phone number.
    sender_id: z.string().trim().max(200).optional(),
    channel_identity: z.object({ channel: id, identity: id }),
    contact_message: z.object({ text_message: z.object({ text: z.string().min(1).max(10000) }).optional() }),
  }),
});

export type Inbound = z.infer<typeof inboundSchema>;

// Sinch signs the exact body, nonce and Unix timestamp with a base64 HMAC.
export function verifySinchSignature(raw: string, headers: Headers, secret: string) {
  const timestamp = headers.get("x-sinch-webhook-signature-timestamp");
  const nonce = headers.get("x-sinch-webhook-signature-nonce");
  const signature = headers.get("x-sinch-webhook-signature");
  if (!timestamp || !nonce || !signature || !/^[A-Za-z\d+/]{43}=$/.test(signature)
    || headers.get("x-sinch-webhook-signature-algorithm") !== "HmacSHA256") return false;
  const expected = createHmac("sha256", secret).update(`${raw}.${nonce}.${timestamp}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "base64"));
}
