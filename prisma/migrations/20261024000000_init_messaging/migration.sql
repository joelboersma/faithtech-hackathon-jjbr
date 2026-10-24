CREATE TABLE IF NOT EXISTS contacts (
    id           BIGSERIAL PRIMARY KEY,
    display_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_identities (
    id          BIGSERIAL PRIMARY KEY,
    contact_id  BIGINT NOT NULL REFERENCES contacts(id),
    channel     TEXT NOT NULL,
    external_id TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (channel, external_id)
);

CREATE TABLE IF NOT EXISTS conversations (
    id                    BIGSERIAL PRIMARY KEY,
    channel_identity_id   BIGINT NOT NULL REFERENCES channel_identities(id),
    sinch_conversation_id TEXT UNIQUE,
    last_message_at       TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
    id                  BIGSERIAL PRIMARY KEY,
    conversation_id     BIGINT NOT NULL REFERENCES conversations(id),
    direction           TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    provider_message_id TEXT NOT NULL UNIQUE,
    message_type        TEXT NOT NULL,
    body                TEXT,
    status              TEXT NOT NULL DEFAULT 'received',
    raw_payload         JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx
    ON messages (conversation_id, created_at DESC);

-- No FK on provider_message_id: a receipt can arrive before its message is stored.
CREATE TABLE IF NOT EXISTS message_status_events (
    id                  BIGSERIAL PRIMARY KEY,
    provider_message_id TEXT NOT NULL,
    status              TEXT NOT NULL,
    reason              JSONB,
    event_time          TIMESTAMPTZ,
    raw_payload         JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS status_events_msg_idx
    ON message_status_events (provider_message_id);

CREATE TABLE IF NOT EXISTS webhook_events (
    id           BIGSERIAL PRIMARY KEY,
    raw_payload  JSONB NOT NULL,
    processed    BOOLEAN NOT NULL DEFAULT FALSE,
    error        TEXT,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
