# To Do App

A Kumo task workspace on Cloudflare Workers. The browser, REST API, and MCP tools operate on the same SQLite Durable Object, isolated by a visitor-specific bearer credential.

## What you can try

- Create, rename, complete, filter, paginate, and delete tasks.
- Open the **API** tab and make real requests against your active workspace.
- Create and revoke external API/MCP credentials in **Session**.
- Connect an MCP client and use `list_todos`, `add_todo`, `update_todo`, `complete_todo`, and `delete_todo`.
- Reset the session to delete its tasks and revoke every credential.

The hosted app and temporary deployment use the complete implementation. A workspace lasts 24 hours by default and supports 200 tasks, titles up to 200 characters, and five external tokens. The native request limiter is configured for 60 requests per minute per client IP. Temporary accounts last up to one hour unless claimed; claiming preserves the deployment, while workspace expiry remains separately configured.

## Run locally

Use Node.js 24.21 (see `.node-version`), or a supported Node.js 22.18+ / 24.11+ installation.

```sh
npm ci
npm run typecheck
npm run dev
```

Open `http://localhost:8787`. Wrangler builds the browser assets automatically. SQLite schemas initialize in the Durable Object constructor; no D1 provisioning or SQL migration command is needed.

## Deploy

```sh
npx wrangler login
# Set CLOUDFLARE_ACCOUNT_ID if your login has multiple accounts.
npm run deploy
```

Wrangler deploys the Worker, assets, rate limiter, and initial SQLite Durable Object migration. The **Deploy to Cloudflare** button uses the standalone repository and its package scripts. Keep the `TodoWorkspace` class and its migration history when updating an existing deployment.

## REST API

`POST /api/session` creates a workspace and returns `{workspaceId, token, expiresAt}`. All task and credential-management routes require `Authorization: Bearer $WORKSPACE_TOKEN`. Use the returned browser credential or create a scoped external token through the Session tab. An external token cannot mint more tokens or reset the workspace.

```sh
BASE=http://localhost:8787
# Run this once and copy the returned token into WORKSPACE_TOKEN in your shell.
curl --request POST "$BASE/api/session"

curl "$BASE/api/todos" --header "Authorization: Bearer $WORKSPACE_TOKEN"
curl --request POST "$BASE/api/todos" \
  --header "Authorization: Bearer $WORKSPACE_TOKEN" \
  --header 'Content-Type: application/json' --data '{"title":"Ship the demo"}'
curl --request PATCH "$BASE/api/todos/1" \
  --header "Authorization: Bearer $WORKSPACE_TOKEN" \
  --header 'Content-Type: application/json' --data '{"completed":true}'
curl --request DELETE "$BASE/api/todos/1" --header "Authorization: Bearer $WORKSPACE_TOKEN"
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Readiness and reviewed deployment marker |
| GET | `/api/capabilities` | Actual storage, MCP support, and session lifetime |
| GET | `/api/openapi.json` | API documentation |
| POST / GET / DELETE | `/api/session` | Create, inspect, or retire a workspace |
| POST | `/api/tokens` | Issue `{name}` token, shown once |
| DELETE | `/api/tokens/:id` | Revoke an external token |
| GET / POST | `/api/todos` | List tasks or create `{title}` |
| GET / PATCH / DELETE | `/api/todos/:id` | Read, update, or delete one task |

Listing accepts `status=all|active|completed`, `page=1..100`, and `limit=1..100`. Responses include `todos`, overall `total` and `completed`, `filteredTotal`, `limit`, and `offset`. Invalid input returns 400, missing credentials 401, another workspace's task 404, and successful deletion 204.

## MCP

The endpoint is `https://YOUR_WORKER_HOST/mcp`, using authenticated Streamable HTTP. Create an external token in **Session**, then configure a client with that URL and a bearer header. With a legacy-compatible client:

```sh
npx mcp-remote https://YOUR_WORKER_HOST/mcp \
  --header "Authorization: Bearer $WORKSPACE_TOKEN"
```

Use MCP Inspector with the same endpoint and authorization header to initialize, list tools, and call them. `list_todos` supports status, limit, and page. The `todos://workspace/tasks` resource contains the workspace's bounded task list. Browser changes are visible to MCP immediately; the browser refreshes on focus and every ten seconds while visible.

The MCP handler uses the Agents SDK's stateless SDK v2 factory, with ordinary legacy tool/resource compatibility. Application state persists in SQLite independently of MCP transport sessions. Revoking a token disables both REST and MCP access.

## Configuration and operations

Change `SESSION_TTL_HOURS` in `wrangler.jsonc` for newly created workspaces. Browser credentials live in tab-scoped `sessionStorage`; only their SHA-256 hashes are persisted server-side. IDs alone never authorize access. Present browser Origins must match the app origin. JSON bodies are stream-bounded to 16 KB, responses are private/non-cacheable, and expiry alarms revoke credentials before cleaning up data.

Run `npm run typecheck` after configuration changes. `npm run bundle:claimable` produces the reviewed Worker bundle without deploying. Use `npx wrangler tail --config wrangler.jsonc` for structured request errors.

See [ARCHITECTURE.md](./ARCHITECTURE.md), [Durable Objects](https://developers.cloudflare.com/durable-objects/), and [MCP handler APIs](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/) for the service boundaries and current APIs.

The catalog URL retains `todo-api-d1` for existing links; the current app uses SQLite Durable Objects.

## Solution and live demo

- [Solution page](https://serverless.build/solutions/todo-api-d1)
- [Live deployment](https://workers-todo-app-typescript.dwarven.workers.dev)
