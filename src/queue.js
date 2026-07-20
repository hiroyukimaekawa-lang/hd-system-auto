import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class JobQueue {
  constructor(file = 'state/jobs.sqlite') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file); this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, payload TEXT NOT NULL, channel_id TEXT, thread_ts TEXT,
      progress TEXT DEFAULT '', error TEXT DEFAULT '', result TEXT DEFAULT '{}', cancel_requested INTEGER DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
    ); CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, created_at);`);
    this.db.prepare("UPDATE jobs SET status='queued', progress='再起動後の再開待ち', updated_at=? WHERE status='running'").run(new Date().toISOString());
  }
  add(job) { const now = new Date().toISOString(); this.db.prepare('INSERT INTO jobs(id,status,payload,channel_id,thread_ts,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(job.id, 'queued', JSON.stringify(job.payload), job.channelId || '', job.threadTs || '', now, now); return this.get(job.id); }
  get(id) { const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id); return row ? this.decode(row) : null; }
  next() { const row = this.db.prepare("SELECT * FROM jobs WHERE status='queued' AND cancel_requested=0 ORDER BY created_at LIMIT 1").get(); return row ? this.decode(row) : null; }
  list(limit = 20) { return this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit).map(row => this.decode(row)); }
  update(id, fields) { const allowed = ['status','channel_id','thread_ts','progress','error','result','cancel_requested','started_at','finished_at']; const entries = Object.entries(fields).filter(([key]) => allowed.includes(key)); if (!entries.length) return this.get(id); entries.push(['updated_at', new Date().toISOString()]); const values = entries.map(([key, value]) => key === 'result' && typeof value !== 'string' ? JSON.stringify(value) : value); this.db.prepare(`UPDATE jobs SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`).run(...values, id); return this.get(id); }
  cancel(id) { const job = this.get(id); if (!job) return null; if (['completed','failed','cancelled'].includes(job.status)) return job; return this.update(id, { cancel_requested: 1, status: job.status === 'queued' ? 'cancelled' : job.status, progress: 'キャンセル要求済み', ...(job.status === 'queued' ? { finished_at: new Date().toISOString() } : {}) }); }
  decode(row) { return { ...row, payload: JSON.parse(row.payload), result: JSON.parse(row.result || '{}'), cancelRequested: Boolean(row.cancel_requested) }; }
}

export function createJobId(date = new Date()) {
  const day = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).format(date).replaceAll('/', '');
  return `${day}-${crypto.randomInt(0, 100000).toString().padStart(5, '0')}`;
}
