// Admin sign-in with email and password. Clients sign in with email links only.
import { cleanEmail, handle, json, readJson, HttpError } from "../../_lib/core.js";
import { adminEmails, createSession } from "../../_lib/auth.js";
import { getDb } from "../../_lib/db.js";
import { LOCK_MS, MAX_FAILED, checkPassword, dummyCheck } from "../../_lib/passwords.js";

const WRONG = "That email and password don't match. You can also sign in with an email link.";

export const onRequestPost = handle(async ({ request, env }) => {
  const data = await readJson(request, 2000);
  const email = cleanEmail(data.email);
  const password = typeof data.password === "string" ? data.password.slice(0, 200) : "";
  if (!email || !password) throw new HttpError(400, "Enter your email and password.");

  const db = await getDb(env);
  const cred = adminEmails(env).includes(email)
    ? await db.prepare("SELECT * FROM credentials WHERE email = ?").bind(email).first()
    : null;
  if (!cred) {
    await dummyCheck(password);
    throw new HttpError(401, WRONG);
  }

  const now = Date.now();
  if (cred.locked_until && cred.locked_until > now) {
    const minutes = Math.ceil((cred.locked_until - now) / 60000);
    throw new HttpError(429, `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or sign in with an email link.`);
  }

  if (!(await checkPassword(password, cred))) {
    const failed = cred.failed_count + 1;
    const lock = failed >= MAX_FAILED;
    await db
      .prepare("UPDATE credentials SET failed_count = ?, locked_until = ? WHERE email = ?")
      .bind(lock ? 0 : failed, lock ? now + LOCK_MS : null, email)
      .run();
    if (lock) throw new HttpError(429, "Too many wrong attempts. Password sign-in is paused for 15 minutes. You can still sign in with an email link.");
    throw new HttpError(401, WRONG);
  }

  await db.prepare("UPDATE credentials SET failed_count = 0, locked_until = NULL WHERE email = ?").bind(email).run();
  return json({ ok: true }, 200, { "Set-Cookie": await createSession(db, email) });
});
