import { SessionWorkspace } from './lib/session';
export type Todo = { id: number; title: string; completed: boolean; createdAt: number; updatedAt: number };
type Row = Omit<Todo, 'completed'> & { completed: number };
const dto = (row: Row): Todo => ({ ...row, completed: row.completed === 1 });

export class TodoWorkspace extends SessionWorkspace<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
      createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    )`);
  }
  list(limit = 100, offset = 0, status = 'all') {
    const condition = status === 'active' ? 'WHERE completed = 0' : status === 'completed' ? 'WHERE completed = 1' : '';
    const todos = this.ctx.storage.sql.exec<Row>(`SELECT * FROM todos ${condition} ORDER BY id DESC LIMIT ? OFFSET ?`, limit, offset).toArray().map(dto);
    const { total, completed } = this.ctx.storage.sql.exec<{ total: number; completed: number }>('SELECT COUNT(*) total, COALESCE(SUM(completed), 0) completed FROM todos').one();
    const filteredTotal = status === 'active' ? total - completed : status === 'completed' ? completed : total;
    return { todos, total, completed, filteredTotal, limit, offset };
  }
  get(id: number): Todo | null { const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM todos WHERE id = ?', id).toArray()[0]; return row ? dto(row) : null; }
  create(title: string): Todo | null {
    if (!this.isActive() || this.list(1).total >= 200) return null;
    const now = Date.now();
    return dto(this.ctx.storage.sql.exec<Row>('INSERT INTO todos (title, createdAt, updatedAt) VALUES (?, ?, ?) RETURNING *', title, now, now).one());
  }
  update(id: number, title?: string, completed?: boolean): Todo | null {
    const current = this.get(id); if (!this.isActive() || !current) return null;
    return dto(this.ctx.storage.sql.exec<Row>('UPDATE todos SET title = ?, completed = ?, updatedAt = ? WHERE id = ? RETURNING *', title ?? current.title, (completed ?? current.completed) ? 1 : 0, Date.now(), id).one());
  }
  remove(id: number): boolean { return this.isActive() && this.ctx.storage.sql.exec('DELETE FROM todos WHERE id = ? RETURNING id', id).toArray().length > 0; }
  protected cleanup() { this.ctx.storage.sql.exec('DELETE FROM todos'); }
}
