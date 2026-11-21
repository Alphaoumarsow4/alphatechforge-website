// Login sessions for the client portal. Sign-in is by one-time email link; there are no passwords.
import { HttpError, sha256 } from "./core.js";
import { getDb } from "./db.js";

export const SESSION_DAYS = 30;
const COOKIE = "atf_session";

export const adminEmails = env =>
  (env.ADMIN_EMAILS || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);

export const sessionCookie = (token, maxAgeSeconds) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;

export function readSessionToken(request) {
  const match = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)atf_session=([A-Za-z0-9_-]{20,100})/);
  return match ? match[1] : null;
}

export async function currentUser(request, env) {
  const token = readSessionToken(request);
  if (!token) return null;
  const db = await getDb(env);
  const session = await db
    .prepare("SELECT email, expires_at FROM sessions WHERE id_hash = ?")
    .bind(await sha256(token))
    .first();
  if (!session || session.expires_at < Date.now()) return null;
  const user = await db.prepare("SELECT name FROM users WHERE email = ?").bind(session.email).first();
  return { email: session.email, name: user?.name || "", isAdmin: adminEmails(env).includes(session.email) };
}

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
