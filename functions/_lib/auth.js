// Login sessions for the client portal.
// Clients sign in with a one-time email link. Admins can also set a password.
import { HttpError, randomToken, sha256 } from "./core.js";
import { getDb } from "./db.js";

export const SESSION_DAYS = 30;
// Within this time after signing in, an admin may set a new password without the old one
// (this is how "forgot password" works: sign in with an email link, then choose a new one).
export const FRESH_SESSION_MS = 15 * 60 * 1000;
const COOKIE = "atf_session";

export const adminEmails = env =>
  (env.ADMIN_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);

export const sessionCookie = (token, maxAgeSeconds) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;

export function readSessionToken(request) {
  const match = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)atf_session=([A-Za-z0-9_-]{20,100})/);
  return match ? match[1] : null;
}

// Creates a session and returns the Set-Cookie header value.
export async function createSession(db, email) {
  const now = Date.now();
  const token = randomToken(32);
  await db
    .prepare("INSERT INTO sessions (id_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), email, now + SESSION_DAYS * 24 * 60 * 60 * 1000, now)
    .run();
  // Housekeeping: drop expired tokens and sessions.
  await db.batch([
    db.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(now - 24 * 60 * 60 * 1000),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now)
  ]);
  return sessionCookie(token, SESSION_DAYS * 24 * 60 * 60);
}

export async function currentUser(request, env) {
  const token = readSessionToken(request);
  if (!token) return null;
  const db = await getDb(env);
  const sessionHash = await sha256(token);
  const session = await db
    .prepare("SELECT email, expires_at, created_at FROM sessions WHERE id_hash = ?")
    .bind(sessionHash)
    .first();
  if (!session || session.expires_at < Date.now()) return null;
  const user = await db.prepare("SELECT name FROM users WHERE email = ?").bind(session.email).first();
  return {
    email: session.email,
    name: user?.name || "",
    isAdmin: adminEmails(env).includes(session.email),
    sessionHash,
    signedInAt: session.created_at
  };
}

// What the browser is allowed to see about the signed-in user.
export const publicUser = user => ({ email: user.email, name: user.name, isAdmin: user.isAdmin });

export async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, "Please sign in.");
  return user;
}

export async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (!user.isAdmin) throw new HttpError(403, "Admins only.");
  return user;
}

// Returns the project if this user may see it (its client, or an admin).
export async function projectForUser(db, user, projectId) {
  const project = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(String(projectId)).first();
  if (!project || (!user.isAdmin && project.client_email !== user.email)) {
    throw new HttpError(404, "Project not found.");
  }
  return project;
}
