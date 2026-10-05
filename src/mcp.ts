import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import type { TodoWorkspace } from './workspace';

export function handleMcp(request: Request, workspace: DurableObjectStub<TodoWorkspace>) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: 'serverless-build-todo', version: '2.0.0' });
    const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
    server.registerTool('list_todos', { description: 'List tasks in this user workspace with status filtering and pagination.', inputSchema: { status: z.enum(['all', 'active', 'completed']).default('all'), limit: z.number().int().min(1).max(100).default(100), page: z.number().int().min(1).max(100).default(1) }, annotations: { readOnlyHint: true } }, async ({ status, limit, page }) => result(await workspace.list(limit, (page - 1) * limit, status)));
    server.registerTool('add_todo', { description: 'Add one task to this workspace. The title must describe the task and contain 1–200 characters.', inputSchema: { title: z.string().trim().min(1).max(200) } }, async ({ title }) => {
      const todo = await workspace.create(title); return todo ? result(todo) : { ...result({ error: 'Workspace task limit reached.' }), isError: true };
    });
    server.registerTool('update_todo', { description: 'Rename a task or change its completion status in this workspace.', inputSchema: { id: z.number().int().positive(), title: z.string().trim().min(1).max(200).optional(), completed: z.boolean().optional() } }, async ({ id, title, completed }) => {
      if (title === undefined && completed === undefined) return { ...result({ error: 'Specify title or completed.' }), isError: true };
      const todo = await workspace.update(id, title, completed); return todo ? result(todo) : { ...result({ error: 'Task not found.' }), isError: true };
    });
    server.registerTool('complete_todo', { description: 'Mark an existing task completed in this workspace.', inputSchema: { id: z.number().int().positive() } }, async ({ id }) => {
      const todo = await workspace.update(id, undefined, true); return todo ? result(todo) : { ...result({ error: 'Task not found.' }), isError: true };
    });
    server.registerTool('delete_todo', { description: 'Permanently delete one task owned by this workspace.', inputSchema: { id: z.number().int().positive() }, annotations: { destructiveHint: true } }, async ({ id }) => {
      const removed = await workspace.remove(id); return { ...result({ removed }), ...(removed ? {} : { isError: true }) };
    });
    server.registerResource('tasks', 'todos://workspace/tasks', { description: 'Tasks from the authenticated workspace.', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await workspace.list(200)) }] }));
    return server;
  }, { route: '/mcp', responseMode: 'json', allowedHostnames: [new URL(request.url).hostname], allowedOriginHostnames: [new URL(request.url).hostname], corsOptions: false }).fetch(request);
}
