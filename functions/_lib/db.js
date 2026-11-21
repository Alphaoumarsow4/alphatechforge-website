// Database access (Cloudflare D1). Tables are created automatically on first use.
import { HttpError, newId } from "./core.js";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     email TEXT PRIMARY KEY, name TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_tokens (
     token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL,
     used_at INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens (email, created_at)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS projects (
     id TEXT PRIMARY KEY, client_email TEXT NOT NULL, title TEXT NOT NULL, service TEXT NOT NULL,
     status TEXT NOT NULL, duration_hours INTEGER, start_at INTEGER, due_at INTEGER, notes TEXT,
     source TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_client ON projects (client_email)`,
  `CREATE TABLE IF NOT EXISTS items (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
     amount_cents INTEGER NOT NULL, position INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS payments (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, label TEXT NOT NULL, amount_cents INTEGER NOT NULL,
     status TEXT NOT NULL, position INTEGER NOT NULL, stripe_session_id TEXT, paid_at INTEGER,
     created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS events (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS messages (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL,
     created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS files (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, r2_key TEXT NOT NULL, filename TEXT NOT NULL,
     content_type TEXT, size INTEGER NOT NULL, uploaded_by TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS credentials (
     email TEXT PRIMARY KEY, hash TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL,
     failed_count INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, updated_at INTEGER NOT NULL)`
];

let schemaReady = false;

export async function getDb(env) {
  if (!env.DB) throw new HttpError(503, "The client portal isn't set up yet.");
  if (!schemaReady) {
    await env.DB.batch(SCHEMA.map(sql => env.DB.prepare(sql)));
    schemaReady = true;
  }
  return env.DB;
}

// Project stages. Websites go through design and build; other services use "In progress".
export const STAGES = {
  web: [
    ["estimate", "Estimate"], ["booked", "Booked"], ["design", "Design"],
    ["build", "Build"], ["review", "Review"], ["done", "Launched"]
  ],
  general: [
    ["estimate", "Estimate"], ["booked", "Booked"], ["build", "In progress"],
    ["review", "Review"], ["done", "Delivered"]
  ]
};
export const ALL_STATUSES = ["estimate", "booked", "design", "build", "review", "done", "cancelled"];
export const SERVICES = [
  "Web Design & Development",
  "Cybersecurity Solutions",
  "IT Support & Troubleshooting",
  "Presentations & Documents",
  "Excel & Data Solutions",
  "Tailored Digital Project"
];
export const stageKind = service => (service === "Web Design & Development" ? "web" : "general");
export function statusLabel(service, status) {
  if (status === "cancelled") return "Cancelled";
  return STAGES[stageKind(service)].find(([key]) => key === status)?.[1] || status;
}

export async function ensureUser(db, email, name = "") {
  await db
    .prepare(
      `INSERT INTO users (email, name, created_at) VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE users.name END`
    )
    .bind(email, name, Date.now())
    .run();
}

// Loads projects with everything the dashboards show. `where` must only use bound parameters.
export async function loadProjects(db, where = "1 = 1", params = []) {
  const { results: projects } = await db
    .prepare(
      `SELECT p.*, u.name AS client_name FROM projects p LEFT JOIN users u ON u.email = p.client_email
       WHERE ${where} ORDER BY (p.due_at IS NULL), p.due_at, p.created_at DESC`
    )
    .bind(...params)
    .all();
  if (!projects.length) return [];

  const ids = projects.map(p => p.id);
  const marks = ids.map(() => "?").join(",");
  const query = sql => db.prepare(sql).bind(...ids).all().then(r => r.results);
  const [items, payments, events, messages, files] = await Promise.all([
    query(`SELECT * FROM items WHERE project_id IN (${marks}) ORDER BY position`),
    query(`SELECT * FROM payments WHERE project_id IN (${marks}) ORDER BY position, created_at`),
    query(`SELECT * FROM events WHERE project_id IN (${marks}) ORDER BY created_at DESC`),
    query(`SELECT * FROM messages WHERE project_id IN (${marks}) ORDER BY created_at`),
    query(`SELECT id, project_id, filename, content_type, size, uploaded_by, created_at FROM files
           WHERE project_id IN (${marks}) ORDER BY created_at DESC`)
  ]);
  const group = rows => rows.reduce((map, row) => ((map[row.project_id] ||= []).push(row), map), {});
  const [byItems, byPayments, byEvents, byMessages, byFiles] = [items, payments, events, messages, files].map(group);

  return projects.map(p => {
    const kind = stageKind(p.service);
    return {
      id: p.id,
      clientEmail: p.client_email,
      clientName: p.client_name || "",
      title: p.title,
      service: p.service,
      status: p.status,
      statusLabel: statusLabel(p.service, p.status),
      stages: STAGES[kind].map(([key, label]) => ({ key, label })),
      durationHours: p.duration_hours,
      startAt: p.start_at,
      dueAt: p.due_at,
      notes: p.notes || "",
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      items: (byItems[p.id] || []).map(i => ({ id: i.id, name: i.name, amountCents: i.amount_cents })),
      payments: (byPayments[p.id] || []).map(x => ({
        id: x.id, label: x.label, amountCents: x.amount_cents, status: x.status, paidAt: x.paid_at
      })),
      events: (byEvents[p.id] || []).map(e => ({ id: e.id, text: e.text, at: e.created_at })),
      messages: (byMessages[p.id] || []).map(m => ({ id: m.id, sender: m.sender, body: m.body, at: m.created_at })),
      files: (byFiles[p.id] || []).map(f => ({
        id: f.id, name: f.filename, size: f.size, uploadedBy: f.uploaded_by, at: f.created_at
      }))
    };
  });
}

export async function addEvent(db, projectId, text) {
  await db
    .prepare("INSERT INTO events (id, project_id, text, created_at) VALUES (?, ?, ?, ?)")
    .bind(newId("evt"), projectId, text, Date.now())
    .run();
}

export const DEFAULT_HOURS = 36;

// Splits a total across a schedule in whole dollars; the last payment absorbs rounding.
export function splitPayments(totalCents, schedule) {
  let used = 0;
  return schedule.map((step, i) => {
    const amount = i === schedule.length - 1 ? totalCents - used : Math.round((totalCents * step.percent) / 10000) * 100;
    used += amount;
    return { label: step.label, amountCents: amount };
  });
}
