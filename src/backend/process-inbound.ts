import { getPrisma } from "./prisma";
import { getChurchService } from "./church-service";
import { runChurchAgent, type AgentModel } from "./agent";
import type { Inbound } from "./sinch-webhook";

export async function processInbound(inbound: Inbound, raw: object, model: AgentModel) {
  const db = getPrisma();
  const service = getChurchService();
  const id = BigInt(await service.ingest(inbound, raw));
  const claimed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`${inbound.app_id}:${inbound.message.contact_id}`}, 0))`;
    const message = await tx.message.findUniqueOrThrow({ where: { id } });
    if (message.status === "processed") return false;
    const busy = await tx.message.findFirst({ where: {
      direction: "inbound", status: "processing", claimedAt: { gte: new Date(Date.now() - 300000) },
      conversation: { channelIdentityId: (await tx.conversation.findUniqueOrThrow({ where: { id: message.conversationId } })).channelIdentityId },
    } });
    if (busy) throw new Error("This sender already has an active agent run");
    await tx.message.update({ where: { id }, data: { status: "processing", claimedAt: new Date() } });
    return true;
  });
  if (!claimed) return;
  try {
    if (inbound.message.contact_message.text_message) {
      await runChurchAgent(id.toString(), model, service);
    } else {
      await service.reply(id.toString(), { text: "Please send a text message so I can help register your church or update your 2026 baptism total." });
    }
    await db.message.update({ where: { id }, data: { status: "processed", claimedAt: null } });
  } catch (error) {
    await db.message.update({ where: { id }, data: { status: "failed", claimedAt: null } });
    throw error;
  }
}
