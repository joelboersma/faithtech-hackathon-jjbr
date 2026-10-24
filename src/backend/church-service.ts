import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client";
import { getPrisma } from "./prisma";
import { getSinch } from "./sinch";
import { inboundSchema, type Inbound } from "./sinch-webhook";

export const churchInput = z.object({
  name: z.string().trim().min(1).max(200).describe("Church name supplied by the sender"),
  location: z.string().trim().min(1).max(300).describe("Church city/region and country supplied by the sender"),
});
export const baptismInput = z.object({
  total: z.number().int().min(0).max(2147483647).describe("The absolute total of baptisms during 2026; replaces the previous total"),
});
export const replyInput = z.object({ text: z.string().trim().min(1).max(4000) });

export type ChurchTools = Pick<ChurchService, "getContext" | "onboardChurch" | "updateBaptisms" | "reply">;
export type SendReply = (inbound: Inbound, text: string) => Promise<string>;

export const sendSinchReply: SendReply = async (inbound, text) => {
  const api = getSinch().conversation;
  // SendMessage has no conversation_id parameter. Resolve and verify the active
  // conversation before sending to its contact on the original channel.
  const conversation = await api.conversation.get({ conversation_id: inbound.message.conversation_id });
  if (!conversation.active || conversation.app_id !== inbound.app_id
    || conversation.contact_id !== inbound.message.contact_id) {
    throw new Error("The originating Sinch conversation is no longer active");
  }
  const result = await api.messages.send({ sendMessageRequestBody: {
    app_id: inbound.app_id,
    recipient: { contact_id: inbound.message.contact_id },
    channel_priority_order: [inbound.message.channel_identity.channel],
    message: { text_message: { text } },
    message_metadata: inbound.message.id,
  } });
  if (!result.message_id) throw new Error("Sinch did not return a message ID");
  return result.message_id;
};

export class ChurchService {
  constructor(private readonly db: PrismaClient, private readonly send: SendReply = sendSinchReply) {}

  async ingest(inbound: Inbound, rawPayload: object) {
    return this.db.$transaction(async (tx) => {
      // Serialize the sender's callbacks, including concurrent duplicate deliveries.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${inbound.app_id}:${inbound.message.contact_id}`}, 0))`;
      const duplicate = await tx.message.findUnique({ where: { providerMessageId: inbound.message.id } });
      if (duplicate) {
        const previous = inboundSchema.parse(duplicate.rawPayload);
        if (previous.app_id !== inbound.app_id || previous.message.contact_id !== inbound.message.contact_id
          || previous.message.conversation_id !== inbound.message.conversation_id) throw new Error("Duplicate message owner mismatch");
        return duplicate.id.toString();
      }
      // A Sinch contact survives channel changes and new conversations. Namespacing
      // the identity by app prevents church ownership leaking between apps.
      const identity = await tx.channelIdentity.upsert({
        where: { channel_externalId: { channel: "SINCH", externalId: `${inbound.app_id}:${inbound.message.contact_id}` } },
        create: { channel: "SINCH", externalId: `${inbound.app_id}:${inbound.message.contact_id}`, contact: { create: {} } },
        update: {},
      });
      const conversation = await tx.conversation.upsert({
        where: { sinchConversationId: inbound.message.conversation_id },
        create: { channelIdentityId: identity.id, sinchConversationId: inbound.message.conversation_id, lastMessageAt: new Date() },
        update: { lastMessageAt: new Date() },
      });
      if (conversation.channelIdentityId !== identity.id) throw new Error("Conversation owner mismatch");
      const message = await tx.message.create({ data: {
        conversationId: conversation.id, direction: "inbound", providerMessageId: inbound.message.id,
        messageType: inbound.message.contact_message.text_message ? "text" : "unsupported",
        body: inbound.message.contact_message.text_message?.text,
        rawPayload: JSON.parse(JSON.stringify(rawPayload)),
      } });
      await tx.webhookEvent.create({ data: { rawPayload: JSON.parse(JSON.stringify(rawPayload)), processed: true } });
      return message.id.toString();
    });
  }

  private async source(inboundMessageId: string) {
    if (!/^[1-9]\d*$/.test(inboundMessageId)) throw new Error("Invalid inbound message ID");
    const message = await this.db.message.findUnique({
      where: { id: BigInt(inboundMessageId) },
      include: { conversation: { include: { channelIdentity: true } } },
    });
    if (!message || message.direction !== "inbound") throw new Error("Inbound message not found");
    return { message, contactId: message.conversation.channelIdentity.contactId };
  }

  async getContext(inboundMessageId: string) {
    const { message, contactId } = await this.source(inboundMessageId);
    const church = await this.db.church.findUnique({ where: { ownerContactId: contactId } });
    const history = await this.db.message.findMany({
      where: { conversationId: message.conversationId, OR: [
        { direction: "inbound", id: { lte: message.id } }, { direction: "outbound", status: "sent" },
      ] },
      orderBy: { id: "desc" }, take: 20,
    });
    return {
      inboundMessageId, message: message.body,
      church: church ? { id: church.id.toString(), name: church.name, location: church.location, baptisms2026: church.baptisms2026 } : null,
      history: history.reverse().map((item) => ({ role: item.direction === "inbound" ? "user" : "assistant", text: item.body })),
    };
  }

  async onboardChurch(inboundMessageId: string, input: z.infer<typeof churchInput>) {
    const data = churchInput.parse(input);
    const { contactId } = await this.source(inboundMessageId);
    const church = await this.db.church.upsert({
      where: { ownerContactId: contactId }, create: { ownerContactId: contactId, ...data }, update: {},
    });
    if (church.name !== data.name || church.location !== data.location) {
      throw new Error("This sender already represents a different church. Church transfer requires administrator help.");
    }
    return { id: church.id.toString(), name: church.name, location: church.location, baptisms2026: church.baptisms2026 };
  }

  async updateBaptisms(inboundMessageId: string, input: z.infer<typeof baptismInput>) {
    const { total } = baptismInput.parse(input);
    const { message, contactId } = await this.source(inboundMessageId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`baptisms:${inboundMessageId}`}, 0))`;
      const current = await tx.message.findUniqueOrThrow({ where: { id: message.id } });
      if (current.baptismResult) {
        const saved = z.object({ name: z.string(), year: z.number(), previousTotal: z.number(), total: z.number() }).parse(current.baptismResult);
        if (saved.total !== total) throw new Error("This inbound message already recorded a different total; ask the sender to send a new message");
        return saved;
      }
      const church = await tx.church.findUnique({ where: { ownerContactId: contactId } });
      if (!church) throw new Error("Onboard this sender's church before recording baptisms");
      await tx.church.update({ where: { id: church.id }, data: { baptisms2026: total } });
      const result = { name: church.name, year: 2026, previousTotal: church.baptisms2026, total };
      await tx.message.update({ where: { id: message.id }, data: { baptismResult: result } });
      return result;
    });
  }

  async reply(inboundMessageId: string, input: z.infer<typeof replyInput>) {
    const { text } = replyInput.parse(input);
    const { message } = await this.source(inboundMessageId);
    const inbound = inboundSchema.parse(message.rawPayload);
    const outgoing = await this.db.message.upsert({
      where: { replyToMessageId: message.id }, update: {},
      create: { conversationId: message.conversationId, direction: "outbound", providerMessageId: `pending:${randomUUID()}`,
        messageType: "text", body: text, status: "queued", rawPayload: {}, replyToMessageId: message.id },
    });
    if (outgoing.status === "sent") return { messageId: outgoing.providerMessageId, status: "sent" };
    // A lease permits recovery after a process crash. The saved body is reused on
    // retries, even if the model generates a different answer the second time.
    const claimed = await this.db.message.updateMany({
      where: { id: outgoing.id, OR: [{ status: "queued" }, { status: "failed" },
        { status: "sending", claimedAt: { lt: new Date(Date.now() - 300000) } }] },
      data: { status: "sending", claimedAt: new Date() },
    });
    if (!claimed.count) throw new Error("Reply is already being sent; retry later");
    try {
      const providerMessageId = await this.send(inbound, outgoing.body!);
      await this.db.message.update({ where: { id: outgoing.id }, data: { providerMessageId, status: "sent", claimedAt: null } });
      return { messageId: providerMessageId, status: "sent" };
    } catch (error) {
      await this.db.message.update({ where: { id: outgoing.id }, data: { status: "failed", claimedAt: null } });
      throw error;
    }
  }
}

export function getChurchService() { return new ChurchService(getPrisma()); }
