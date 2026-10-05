import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { allowedOrigin, credentials, documentCsp, hashSecret, integer, randomSecret, readJson, text } from './lib/http';
import { handleMcp } from './mcp';
import { TodoWorkspace } from './workspace';
export { TodoWorkspace };
const workspaces = (env: Env) => env.WORKSPACES;

const app = new Hono<{ Bindings: Env; Variables: { workspace: DurableObjectStub<TodoWorkspace>; workspaceId: string; hash: string } }>();
app.use('*', async (c, next) => {
  c.header('x-content-type-options', 'nosniff'); c.header('referrer-policy', 'no-referrer'); c.header('cache-control', 'no-store'); c.header('content-security-policy', documentCsp);
  if (!allowedOrigin(c.req.raw)) throw new HTTPException(403, { message: 'Origin is not allowed.' });
  if (c.req.path.startsWith('/api/') || c.req.path === '/mcp') {
    const { success } = await c.env.RATE_LIMITER.limit({ key: c.req.header('cf-connecting-ip') ?? 'local' });
    if (!success) throw new HTTPException(429, { message: 'Too many requests. Try again shortly.' });
  }
  await next();
});
app.get('/health', async c => { const result = await workspaces(c.env).getByName('health-readiness').list(1); return c.json({ status: 'ok', storage: 'sqlite-durable-objects', ready: result.total === 0, marker: 'SERVERLESS_BUILD_TODO_APP_V1' }); });
app.get('/api/capabilities', c => c.json({ profile: 'complete', storage: 'sqlite-durable-objects', api: true, mcp: true, sessionTtlHours: Number(c.env.SESSION_TTL_HOURS) }));
app.get('/api/openapi.json', c => c.json({ openapi: '3.1.0', info: { title: 'To Do App API', version: '2.0.0' }, servers: [{ url: new URL(c.req.url).origin }], security: [{ workspace: [] }], components: { securitySchemes: { workspace: { type: 'http', scheme: 'bearer', description: 'Create a workspace with POST /api/session, or issue a scoped token in the app.' } } }, paths: { '/api/session': { post: { summary: 'Create an isolated session', security: [], responses: { '201': { description: 'Workspace ID, bearer credential, and expiry' } } }, get: { summary: 'Session and token list', responses: { '200': { description: 'Session metadata' } } }, delete: { summary: 'Reset workspace and revoke tokens', responses: { '204': { description: 'Deleted' } } } }, '/api/todos': { get: { summary: 'List tasks: status=all|active|completed, limit=1..100, page=1..100', responses: { '200': { description: 'Tasks and counts' } } }, post: { summary: 'Create a task', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 1, maxLength: 200 } } } } } }, responses: { '201': { description: 'Created task' } } } }, '/api/todos/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }], get: { summary: 'Read task', responses: { '200': { description: 'Task' }, '404': { description: 'Not found' } } }, patch: { summary: 'Change title and/or completed (boolean)', responses: { '200': { description: 'Updated task' } } }, delete: { summary: 'Delete task', responses: { '204': { description: 'Deleted' } } } } } }));
app.post('/api/session', async c => {
  const workspaceId = crypto.randomUUID(); const secret = randomSecret();
  const { expiresAt } = await workspaces(c.env).getByName(workspaceId).bootstrap(await hashSecret(secret), workspaceId);
  return c.json({ workspaceId, token: `${workspaceId}.${secret}`, expiresAt }, 201);
});
app.use('*', async (c, next) => {
  if (!c.req.path.startsWith('/api/') && c.req.path !== '/mcp') return next();
  const credential = credentials(c.req.raw); const hash = await hashSecret(credential.token);
  const workspace = workspaces(c.env).getByName(credential.workspaceId);
  const browserOnly = c.req.path === '/api/tokens' || c.req.path.startsWith('/api/tokens/') || (c.req.path === '/api/session' && c.req.method === 'DELETE');
  if (!await workspace.authorize(hash, browserOnly)) throw new HTTPException(401, { message: 'Workspace credential has expired or was revoked.' });
  c.set('workspace', workspace); c.set('workspaceId', credential.workspaceId); c.set('hash', hash); await next();
});
app.get('/api/session', async c => c.json(await c.get('workspace').info()));
app.delete('/api/session', async c => { await c.get('workspace').retire(); return c.body(null, 204); });
app.post('/api/tokens', async c => {
  const body = await readJson(c.req.raw); const token = await c.get('workspace').issueToken(text(body.name, 'name', 50));
  if (!token) throw new HTTPException(409, { message: 'Revoke an existing token before creating another.' });
  return c.json({ id: token.id, name: token.name, token: `${c.get('workspaceId')}.${token.secret}` }, 201);
});
app.delete('/api/tokens/:id', async c => { if (!await c.get('workspace').revokeToken(c.req.param('id'))) throw new HTTPException(404, { message: 'Token not found.' }); return c.body(null, 204); });
app.get('/api/todos', async c => {
  const status = c.req.query('status') ?? 'all'; if (!['all', 'active', 'completed'].includes(status)) throw new HTTPException(400, { message: 'Invalid task status.' });
  const limit = integer(c.req.query('limit'), 100, 100); const page = integer(c.req.query('page'), 1, 100);
  return c.json(await c.get('workspace').list(limit, (page - 1) * limit, status));
});
app.post('/api/todos', async c => { const body = await readJson(c.req.raw); const todo = await c.get('workspace').create(text(body.title, 'title', 200)); if (!todo) throw new HTTPException(409, { message: 'This demo workspace supports up to 200 tasks.' }); return c.json(todo, 201); });
app.get('/api/todos/:id', async c => { const todo = await c.get('workspace').get(integer(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER)); if (!todo) throw new HTTPException(404, { message: 'Task not found.' }); return c.json(todo); });
app.patch('/api/todos/:id', async c => {
  const body = await readJson(c.req.raw);
  if (body.title === undefined && body.completed === undefined) throw new HTTPException(400, { message: 'Specify title or completed.' });
  if (body.completed !== undefined && typeof body.completed !== 'boolean') throw new HTTPException(400, { message: 'completed must be boolean.' });
  const todo = await c.get('workspace').update(integer(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER), body.title === undefined ? undefined : text(body.title, 'title', 200), body.completed as boolean | undefined);
  if (!todo) throw new HTTPException(404, { message: 'Task not found.' }); return c.json(todo);
});
app.delete('/api/todos/:id', async c => { if (!await c.get('workspace').remove(integer(c.req.param('id'), 0, Number.MAX_SAFE_INTEGER))) throw new HTTPException(404, { message: 'Task not found.' }); return c.body(null, 204); });
app.all('/mcp', c => handleMcp(c.req.raw, c.get('workspace')));
app.all('/api/*', c => c.json({ error: 'Endpoint not found.' }, 404));
app.all('*', async c => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  // Materialize the asset response so Worker security headers are preserved.
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', documentCsp);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  return new Response(response.body, { status: response.status, headers });
});
app.onError((error, c) => { if (!(error instanceof HTTPException)) console.error(JSON.stringify({ event: 'request_error', kind: error.name })); return c.json({ error: error instanceof HTTPException ? error.message : 'Request failed. Please retry.' }, error instanceof HTTPException ? error.status : 500); });
export default app;
