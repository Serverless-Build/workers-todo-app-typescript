import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@cloudflare/kumo/components/button';
import { Input } from '@cloudflare/kumo/components/input';
import { Checkbox } from '@cloudflare/kumo/components/checkbox';
import { LayerCard } from '@cloudflare/kumo/components/layer-card';
import { AppShell, readResponse, useWorkspace } from './client';
import type { Todo } from '../workspace';
import './app.css';

function Todos() {
  const { request } = useWorkspace();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [counts, setCounts] = useState({ total: 0, completed: 0, filteredTotal: 0 });
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const refresh = async () => { const value = await readResponse<{ todos: Todo[]; total: number; completed: number; filteredTotal: number }>(await request(`/api/todos?status=${filter}&page=${page}`)); setTodos(value.todos); setCounts(value); if (page > Math.max(1, Math.ceil(value.filteredTotal / 100))) setPage(Math.max(1, Math.ceil(value.filteredTotal / 100))); };
  useEffect(() => {
    const update = () => void refresh().catch(error => setError(error.message));
    update();
    const timer = setInterval(() => { if (!document.hidden) update(); }, 10_000);
    window.addEventListener('focus', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); };
  }, [filter, page]);
  const mutate = async (path: string, method: string, body?: object) => {
    setBusy(true); setError('');
    try { await request(path, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }); await refresh(); return true; }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save task.'); return false; }
    finally { setBusy(false); }
  };
  const add = async (event: FormEvent) => { event.preventDefault(); if (await mutate('/api/todos', 'POST', { title })) setTitle(''); };
  return <><div className="stat-grid"><div className="stat"><span>Total tasks</span><strong>{counts.total}</strong></div><div className="stat"><span>Active</span><strong>{counts.total - counts.completed}</strong></div><div className="stat"><span>Completed</span><strong>{counts.completed}</strong></div></div>
    <LayerCard className="panel"><h2>Your tasks</h2><p>Add a task, then explore the API and MCP tabs to manage this same list from other interfaces.</p><form onSubmit={event => void add(event)} className="form-row"><label className="grow">New task<Input aria-label="New task" value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required placeholder="What needs doing?" /></label><Button type="submit" variant="primary" disabled={busy || !title.trim()}>Add task</Button></form>
      <div className="button-row mt-5">{['all', 'active', 'completed'].map(status => <Button key={status} variant={filter === status ? 'primary' : 'secondary'} onClick={() => { setFilter(status); setPage(1); }}>{status[0].toUpperCase() + status.slice(1)}</Button>)}<Button onClick={() => void refresh().catch(error => setError(error.message))}>Refresh tasks</Button></div>
      {error && <p role="alert" className="notice error">{error}</p>}
      <ul className="resource-list">{todos.map(todo => <li key={todo.id}>
        <Checkbox aria-label={`Complete ${todo.title}`} checked={todo.completed} onCheckedChange={checked => void mutate(`/api/todos/${todo.id}`, 'PATCH', { completed: checked === true })} disabled={busy} />
        {edit === todo.id ? <form className="form-row grow" onSubmit={event => { event.preventDefault(); void mutate(`/api/todos/${todo.id}`, 'PATCH', { title: draft }).then(ok => { if (ok) setEdit(null); }); }}><Input aria-label="Edit task title" value={draft} onChange={event => setDraft(event.target.value)} required maxLength={200} /><Button type="submit" disabled={busy}>Save task</Button><Button type="button" onClick={() => setEdit(null)}>Cancel</Button></form> : <div className="grow"><span style={{ textDecoration: todo.completed ? 'line-through' : 'none' }}>{todo.title}</span><div className="muted text-xs mt-1">Task {todo.id} · {new Date(todo.updatedAt).toLocaleTimeString()}</div></div>}
        <Button onClick={() => { setEdit(todo.id); setDraft(todo.title); }} disabled={busy} aria-label={`Edit ${todo.title}`}>Edit</Button><Button onClick={() => void mutate(`/api/todos/${todo.id}`, 'DELETE')} disabled={busy} aria-label={`Delete ${todo.title}`}>Delete</Button>
      </li>)}</ul>{!todos.length && <p className="notice">{page > 1 ? 'No tasks on this page. Return to the previous page.' : filter === 'all' ? 'Your workspace is empty. Add your first task above.' : `No ${filter} tasks yet.`}</p>}
      {(page > 1 || counts.filteredTotal > 100) && <div className="button-row"><Button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous page</Button><span>Page {page}</span><Button disabled={page * 100 >= counts.filteredTotal} onClick={() => setPage(page + 1)}>Next page</Button></div>}
    </LayerCard></>;
}
createRoot(document.getElementById('root')!).render(<AppShell title="To Do App" description="One private workspace, three ways to work: browser, REST API, and MCP." apiPath="/api/todos" mcp><Todos /></AppShell>);
