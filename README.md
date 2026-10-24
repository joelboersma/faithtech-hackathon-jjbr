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
npm run db:migrate -- --name init
npm run db:generate
npm run db:studio
```

The migration command creates the example `Note` table. It needs a development database and may require a shadow database; for a hosted database without shadow-database privileges, generate migrations against a local development PostgreSQL instance, commit `prisma/migrations`, then apply them with `npm run db:deploy`. No migration has been applied by this scaffold.

Use Prisma in server code:

```ts
import { getPrisma } from "@/lib/prisma";
import { createNoteSchema } from "@/lib/validation";

const data = createNoteSchema.parse({ title: "First idea" });
const note = await getPrisma().note.create({ data });
```

Prisma uses the database role in the connection string; it does not inherit a Supabase user's session or RLS permissions. Add authorization before exposing queries. The example `Note` model is separate from Supabase's managed `auth` schema.

Client generation runs after installation and before builds/typechecking; it does not require a live database. Runtime connections use `DATABASE_URL`; Prisma CLI database operations prefer `DIRECT_URL`. Keep Prisma CLI, client, and adapter on matching versions when upgrading.

Reference: [Prisma 7 PostgreSQL setup](https://www.prisma.io/docs/v7/prisma-orm/quickstart/postgresql).

## MCP server

`src/mcp/server.ts` creates a server with a Zod-validated `greet` tool and a JSON resource at `faithtech://info`. Add tools and resources there. `src/mcp/stdio.ts` connects it using stdio, independently of Next.js.

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

Keep stdout reserved for MCP JSON-RPC messages; use stderr for logging. This local starter exposes no database or messaging operations. Add authorization before exposing sensitive tools, and use Streamable HTTP plus authentication if you later host a remote MCP endpoint.

Reference: [MCP TypeScript server guide](https://ts.sdk.modelcontextprotocol.io/server).

## Zod validation

Shared input schemas live in `src/lib/validation.ts`; integration environment schemas live in `src/lib/env.ts`. The example endpoint handles malformed JSON and invalid inputs with HTTP 400:

```sh
curl http://localhost:3000/api/hello \
  -H 'Content-Type: application/json' \
  -d '{"name":"FaithTech"}'
```

## Sinch

Set `SINCH_PROJECT_ID`, `SINCH_KEY_ID`, and `SINCH_KEY_SECRET` using credentials from the Sinch dashboard. Import `getSinch` from `@/lib/sinch` in server code to access the initialized `SinchClient`. Choose and configure the Sinch API for your use case; some APIs require additional credentials or an application ID. The scaffold does not send messages or incur messaging charges.

The Prisma and Sinch modules use `server-only` to prevent accidental browser imports. For future standalone MCP tools, extract shared service factories into backend modules that do not depend on Next.js's `server-only` marker.

Reference: [Sinch Node SDK setup and supported APIs](https://developers.sinch.com/docs/sdks/node/sdk-reference-docs).

## Checks and production

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

Tests cover API validation and MCP tool discovery, invocation, input rejection, and resource reads over an in-memory transport. Supabase, database, and Sinch connectivity require your own project credentials and are not exercised by these tests. Configure environment variables on your hosting platform before deployment, and apply committed database migrations with `npm run db:deploy`.

Dependency installation creates `package-lock.json`; commit it to make subsequent installs reproducible with `npm ci`.
