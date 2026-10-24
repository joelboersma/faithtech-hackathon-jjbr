CREATE TABLE "churches" (
  "id" BIGSERIAL PRIMARY KEY,
  "owner_contact_id" BIGINT NOT NULL UNIQUE REFERENCES "contacts"("id"),
  "name" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "baptisms_2026" INTEGER NOT NULL DEFAULT 0 CHECK ("baptisms_2026" >= 0),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "messages" ADD COLUMN "reply_to_message_id" BIGINT UNIQUE REFERENCES "messages"("id");
ALTER TABLE "messages" ADD COLUMN "claimed_at" TIMESTAMPTZ(6);
ALTER TABLE "messages" ADD COLUMN "baptism_result" JSONB;
