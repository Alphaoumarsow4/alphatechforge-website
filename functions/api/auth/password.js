// Admin: set or change your password. Signs out your other devices.
import { handle, json, readJson, HttpError } from "../../_lib/core.js";
import { FRESH_SESSION_MS, requireAdmin } from "../../_lib/auth.js";
import { getDb } from "../../_lib/db.js";
import { checkPassword, hashPassword, validateNewPassword } from "../../_lib/passwords.js";

export const onRequestPost = handle(async ({ request, env }) => {
  const user = await requireAdmin(request, env);
  const data = await readJson(request, 2000);
  const db = await getDb(env);
  const existing = await db.prepare("SELECT * FROM credentials WHERE email = ?").bind(user.email).first();

  // Changing an existing password needs the current one, unless you've just signed in
  // (e.g. with an email link because you forgot it).
  const fresh = Date.now() - user.signedInAt < FRESH_SESSION_MS;
  if (existing && !fresh) {
    const current = typeof data.currentPassword === "string" ? data.currentPassword.slice(0, 200) : "";
    if (!current || !(await checkPassword(current, existing))) {
      throw new HttpError(400, "Your current password is incorrect. Forgot it? Sign out, sign in with an email link, then set a new one.");
    }
  }

  validateNewPassword(data.newPassword, user.email);
  const { hash, salt, iterations } = await hashPassword(data.newPassword);
  const now = Date.now();
  await db.batch([
    db.prepare(
      `INSERT INTO credentials (email, hash, salt, iterations, failed_count, locked_until, updated_at)
       VALUES (?, ?, ?, ?, 0, NULL, ?)
       ON CONFLICT(email) DO UPDATE SET hash = excluded.hash, salt = excluded.salt, iterations = excluded.iterations,
         failed_count = 0, locked_until = NULL, updated_at = excluded.updated_at`
    ).bind(user.email, hash, salt, iterations, now),
    // Sign out every other device; this one stays signed in.
    db.prepare("DELETE FROM sessions WHERE email = ? AND id_hash <> ?").bind(user.email, user.sessionHash)
  ]);
  return json({ ok: true });
});
