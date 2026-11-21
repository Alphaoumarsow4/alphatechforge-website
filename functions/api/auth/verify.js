// Step 2 of sign-in: exchange the one-time link token for a session cookie.
import { handle, json, randomToken, readJson, sha256, HttpError } from "../../_lib/core.js";
import { SESSION_DAYS, sessionCookie } from "../../_lib/auth.js";
import { ensureUser, getDb } from "../../_lib/db.js";

export const onRequestPost = handle(async ({ request, env }) => {
  const data = await readJson(request, 1000);
  const token = typeof data.token === "string" ? data.token : "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new HttpError(400, "This sign-in link is invalid.");

  const db = await getDb(env);
  const now = Date.now();
  // Marks the token used in the same statement that checks it, so a link can't be used twice.
  const used = await db
    .prepare(
      `UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
       RETURNING email`
    )
    .bind(now, await sha256(token), now)
    .first();
  if (!used) throw new HttpError(400, "This sign-in link has expired or was already used. Please request a new one.");

  await ensureUser(db, used.email);
  const session = randomToken(32);
  await db
    .prepare("INSERT INTO sessions (id_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(session), used.email, now + SESSION_DAYS * 24 * 60 * 60 * 1000, now)
    .run();
  // Housekeeping: drop expired tokens and sessions.
  await db.batch([
    db.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(now - 24 * 60 * 60 * 1000),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now)
  ]);

  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(session, SESSION_DAYS * 24 * 60 * 60) });
});
