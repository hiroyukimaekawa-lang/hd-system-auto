import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir } from '../../output.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
export const DATA_ROOT = path.join(ROOT, 'data', 'is', 'list-generation');

export function jobsRoot() { return path.join(DATA_ROOT, 'jobs'); }
export function jobDir(jobId) { return path.join(jobsRoot(), jobId); }

export function newJobId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `is_${stamp}_${crypto.randomUUID().slice(0, 8)}`;
}

export function loadState(jobId) {
  const file = path.join(jobDir(jobId), 'state.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

export function saveState(state) {
  const dir = jobDir(state.jobId);
  ensureDir(dir);
  state.updatedAt = new Date().toISOString();
  const target = path.join(dir, 'state.json');
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  fs.renameSync(temporary, target);
  return state;
}

export function appendLog(jobId, message, details = {}) {
  const dir = jobDir(jobId);
  ensureDir(dir);
  const entry = { at: new Date().toISOString(), message, ...details };
  fs.appendFileSync(path.join(dir, 'job.log'), `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

export function readLog(jobId, limit = 200) {
  const file = path.join(jobDir(jobId), 'job.log');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map(line => {
    try { return JSON.parse(line); } catch { return { at: '', message: line }; }
  });
}

export function listJobs(limit = 20) {
  ensureDir(jobsRoot());
  const ids = fs.readdirSync(jobsRoot()).filter(name => fs.statSync(path.join(jobsRoot(), name)).isDirectory());
  const jobs = ids.map(id => loadState(id)).filter(Boolean);
  jobs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return jobs.slice(0, limit);
}
