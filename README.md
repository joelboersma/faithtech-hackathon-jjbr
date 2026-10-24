# FaithTech starter

Next.js App Router, React, and strict TypeScript, with Supabase SSR clients, Prisma ORM 7 for PostgreSQL, an MCP server, Zod validation, and the Sinch Node SDK.

## Get started

Use Node.js 24 (see `.nvmrc`) and npm.

```sh
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000. The starter page and `POST /api/hello` work without external credentials. Integration clients are initialized and validated only when called. Fill in `.env` before using those clients; restart Next.js after changing public environment variables.

## Supabase

Create a Supabase project and copy its project URL and **publishable** key from the Connect dialog into `.env`. The public key is intended for browser use; never put a secret or service role key in a `NEXT_PUBLIC_*` variable.

- Browser components: import `createClient` from `@/lib/supabase/client`.
- Server Components, Route Handlers, and Server Actions: import the async `createClient` from `@/lib/supabase/server`.
- `src/proxy.ts` refreshes auth cookies for page requests. It does not protect routes. Add verified user/claims checks when implementing authentication; Route Handlers must verify users themselves.

Enable Row Level Security and appropriate policies on any tables accessed through the Supabase Data API. An auth UI and provider callbacks are application-specific and are not included.

Reference: [Supabase SSR setup](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

## Prisma and PostgreSQL

Prisma connects to the same Supabase PostgreSQL database using its PostgreSQL driver adapter. Set `DATABASE_URL` to the transaction pooler URL and `DIRECT_URL` to the direct database URL (or session pooler URL if your machine requires IPv4). Copy the actual host and username from Supabase's Connect dialog, URL-encode the password, and retain the required SSL settings.

```sh
npm run db:validate
npm run db:deploy
npm run db:generate
npm run db:studio
```

The committed initial migration creates `contacts`, `channel_identities`, `conversations`, `messages`, `message_status_events`, and `webhook_events` from the supplied SQL schema. `db:deploy` applies committed migrations without a shadow database. For future schema changes, use `npm run db:migrate -- --name describe_change` against a development database with shadow-database privileges, then commit the generated migration.

Prisma models use camelCase fields mapped to the original snake_case columns. IDs are JavaScript `bigint` values; convert them to strings before JSON serialization. Timestamps use PostgreSQL `TIMESTAMPTZ`, and payloads use `JSONB`. The SQL migration enforces `messages.direction` as `inbound` or `outbound`; preserve this custom check constraint in future migrations because Prisma schema syntax cannot represent it. Status events intentionally have no foreign key to messages so receipts can arrive first.

Use Prisma in server code:

```ts
import { getPrisma } from "@/lib/prisma";

const contact = await getPrisma().contact.create({
  data: { displayName: "Alex" },
});
```

Prisma uses the database role in the connection string; it does not inherit a Supabase user's session or RLS permissions. Add authorization before exposing queries. These application models are separate from Supabase's managed `auth` schema.

Client generation runs after installation and before builds/typechecking; it does not require a live database. Runtime connections use `DATABASE_URL`; Prisma CLI database operations prefer `DIRECT_URL`. Keep Prisma CLI, client, and adapter on matching versions when upgrading.

Reference: [Prisma 7 PostgreSQL setup](https://www.prisma.io/docs/v7/prisma-orm/quickstart/postgresql).

## Church MCP and Sinch entry point

`POST /api/webhooks/sinch` is the entry point for Sinch Conversation API callbacks. It verifies Sinch's base64 HMAC signature over the exact request body, nonce, and timestamp, checks the configured app/project, and persists incoming messages. Use **CONVERSATION** processing mode and subscribe to **MESSAGE_INBOUND**. Receipts and other triggers are acknowledged without invoking the agent.

The webhook invokes **GLM 5.3 Flash through OpenRouter** using model ID `z-ai/glm-5.3-flash`. Set `OPENROUTER_API_KEY` in your local `.env` and deployment secrets; `OPENROUTER_MODEL` defaults to that exact model. The key stays on the server. Missing credentials or provider failures return HTTP 503 after saving the inbound message, allowing Sinch to retry.

`src/backend/openrouter.ts` calls OpenRouter's chat completions endpoint using native function/tool messages. It preserves tool-call IDs and returned reasoning context between turns, supplies MCP tool schemas on every request, and requires providers to support the requested parameters. It does not fall back to a different model. Requests have a 20-second timeout, and each agent run has a 45-second model/tool execution budget and an eight-turn limit. Truncated or malformed model responses fail rather than being sent as confirmations.

`src/backend/agent.ts` defines the provider contract: the model receives instructions, recent conversation context, and discovered MCP tool schemas, and returns text or tool calls. It uses a real in-memory MCP client/server connection to execute calls. The server is bound to the verified inbound message, so the model cannot select another sender or destination.

Available application tools:

| Tool | Behavior |
| --- | --- |
| `get_church_context` | Read the sender's church and recent messages. |
| `onboard_church` | Register a church name and location for this sender. Repeated identical calls are safe. |
| `update_baptisms_2026` | Set the absolute 2026 total to a nonnegative integer, including zero. |
| `reply_to_conversation` | Send one reply to the originating contact on the originating channel. |

The agent asks for missing onboarding details or ambiguous baptism totals. A Sinch contact owns one church across channels and conversations; another contact cannot update it by supplying a church ID. Sharing one church among multiple representatives and ownership transfers are not implemented. Church names are not globally unique.

The existing `greet` connectivity tool and `faithtech://info` resource remain available. `src/mcp/stdio.ts` connects the server using stdio, independently of Next.js.

```sh
npm run mcp:dev
# Or, without watching:
npm run mcp:start
```

Stdio waits for an MCP client; it is not an HTTP endpoint. Configure a local MCP client with absolute paths (replace the examples):

```json
{
  "mcpServers": {
    "faithtech": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/repo/node_modules/tsx/dist/cli.mjs",
        "/absolute/path/to/repo/src/mcp/stdio.ts"
      ],
      "cwd": "/absolute/path/to/repo"
    }
  }
}
```

Keep stdout reserved for MCP JSON-RPC messages; use stderr for logging. Stdio is trusted local operator access. `POST /api/mcp` also exposes a stateless Streamable HTTP MCP server and requires `Authorization: Bearer <MCP_BEARER_TOKEN>`. These operator clients must provide the saved database `inboundMessageId` when calling application tools. Their credential grants access to all saved conversations; give church representatives access through Sinch, not this operator endpoint. Use HTTPS for hosted endpoints. MCP clients must accept both `application/json` and `text/event-stream`.

Reference: [MCP TypeScript server guide](https://ts.sdk.modelcontextprotocol.io/server).

## Zod validation

Shared input schemas live in `src/lib/validation.ts`; integration environment schemas live in `src/lib/env.ts`. The example endpoint handles malformed JSON and invalid inputs with HTTP 400:

```sh
curl http://localhost:3000/api/hello \
  -H 'Content-Type: application/json' \
  -d '{"name":"FaithTech"}'
```

## Sinch

Set `SINCH_PROJECT_ID`, `SINCH_KEY_ID`, `SINCH_KEY_SECRET`, `SINCH_APP_ID`, `SINCH_REGION` (`us`, `eu`, or `br`), and `SINCH_WEBHOOK_SECRET` in `.env`, along with `OPENROUTER_API_KEY`. The webhook secret must match the secret set on the Sinch webhook. Apply the migration with `npm run db:deploy`, deploy Next.js, and configure the webhook target as `https://your-host/api/webhooks/sinch`.

Replies use the Sinch Conversation API and can incur messaging charges. The SDK send request takes a contact rather than a conversation ID; the service checks that the originating conversation is still active and belongs to the expected app/contact before sending on its original channel. Sinch allows one active conversation per contact/app. Receipt processing is not included, so a saved outbound status of `sent` means accepted by Sinch, not delivered to the handset.

Duplicate inbound callbacks reuse the saved message. Agent runs are serialized per sender using a five-minute database lease. Baptism changes and their saved tool results commit together; retrying an old callback cannot overwrite a newer update. Replies use a persisted outbox record and send lease, reusing the first saved reply on retries. A crash or timeout after Sinch accepts a send but before its ID is committed can still cause a duplicate reply; there is no cross-system exactly-once guarantee.

The webhook currently waits for the agent and reply before returning 200; failures return 503 for Sinch retry. A process crash leaves a lease that can be reclaimed by a later callback after five minutes. There is no independent queue worker/retry scheduler. For production traffic, put the persisted inbox behind a durable worker so model latency does not hold the Sinch callback open. Non-text messages receive a request to send text.

Next.js wrappers in `src/lib/prisma.ts` and `src/lib/sinch.ts` retain `server-only`; standalone MCP services use shared factories in `src/backend`. Never import backend modules into browser components.

References: [Sinch callbacks and signature verification](https://developers.sinch.com/docs/conversation/callbacks), [Sinch Node SDK](https://developers.sinch.com/docs/sdks/node/sdk-reference-docs).

## Checks and production

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

Tests cover API validation, MCP discovery/invocation, scoped tools, baptism input validation, agent execution, OpenRouter request/response handling and native tool round trips, webhook signature/identity checks, receipt filtering, retry responses, and authenticated HTTP MCP transport. Live database, AI-provider, and Sinch connectivity are not exercised by these tests. Configure environment variables on your hosting platform before deployment, and apply committed database migrations with `npm run db:deploy`.

Dependency installation creates `package-lock.json`; commit it to make subsequent installs reproducible with `npm ci`.
