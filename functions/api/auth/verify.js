// Step 2 of sign-in: exchange the one-time link token for a session cookie.
import { handle, json, readJson, sha256, HttpError } from "../../_lib/core.js";
import { createSession } from "../../_lib/auth.js";
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
  return json({ ok: true }, 200, { "Set-Cookie": await createSession(db, used.email) });
});
