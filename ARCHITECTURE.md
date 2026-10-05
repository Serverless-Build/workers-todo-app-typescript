# To Do App architecture

```text
Kumo browser / REST client / MCP client
                 │ workspace bearer credential
                 ▼
Worker: Hono validation, native rate limit, REST and MCP routing
                 │ authenticated workspace ID → getByName()
                 ▼
TodoWorkspace: SQLite tasks, token hashes, expiry alarm
```

## One persistent owner

Each randomly generated workspace ID selects one `TodoWorkspace`. `SessionWorkspace` owns hashed credentials, browser-only token management, expiry, retirement, and alarm retries. `TodoWorkspace` owns task CRUD and synchronous SQLite writes. Task IDs are local to a workspace and never grant access by themselves.

The browser fetches REST endpoints using its tab-scoped credential. External tokens reference exactly the same workspace. `src/mcp.ts` creates a fresh MCP server per request after the Worker authenticates it; the factory captures only that request's authorized Durable Object stub. MCP tool handlers call the same methods as REST handlers.

## Consistency and bounds

Task mutation has no external I/O between checking the workspace state and writing SQLite. Browser, REST, and MCP therefore see one canonical state across isolate eviction and restart. SQLite's synchronous transaction boundary creates session metadata and its initial token together. Token issuance rechecks quota and expiry after asynchronous hashing.

The application bounds a workspace to 200 tasks and five external tokens. Listing is paginated; filtering has a separate matching count. The MCP resource can return all 200 bounded tasks. The browser polls only while visible and refreshes on focus to display external changes.

## Lifecycle and serving

Reset and expiry revoke all tokens first, then delete task data. Failed alarm cleanup reschedules a later attempt. Retired actors keep a small tombstone, so old credentials cannot reinitialize the workspace.

Workers Static Assets serves the Vite-built React/Kumo app. `run_worker_first` lets the Worker attach CSP, no-referrer, and nosniff headers to documents. Framing is allowed for Serverless-Build and the documented local development origins. Private API/MCP responses use `Cache-Control: no-store`.

The hosted and native claimable versions have the same bindings and behavior: assets, `TodoWorkspace`, native rate limiting, and a session-lifetime variable. The initial SQLite class migration is packaged with the native deployment. There are no external database IDs or application secrets to substitute.

This is a bounded anonymous reference workspace, not a durable user-account identity system. Use persistent authenticated user identities and deliberate retention policies when adapting it into a long-lived application.
