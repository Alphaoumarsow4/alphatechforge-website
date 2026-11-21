// Step 1 of sign-in: email a one-time login link (valid 15 minutes).
import { cleanEmail, handle, json, randomToken, readJson, sha256, validEmail, HttpError } from "../../_lib/core.js";
import { adminEmails } from "../../_lib/auth.js";
import { getDb } from "../../_lib/db.js";
import { sendEmail } from "../../_lib/services.js";

const LINK_MINUTES = 15;
const MAX_LINKS_PER_15_MIN = 3;

export const onRequestPost = handle(async ({ request, env }) => {
  const data = await readJson(request, 2000);
  const email = cleanEmail(data.email);
  if (!validEmail(email)) throw new HttpError(400, "Please enter a valid email address.");

  // Same reply whether or not the email has an account, so nobody can probe for clients.
  const reply = json({ ok: true, message: "If that email has a client account, a sign-in link is on its way. It expires in 15 minutes." });

  const db = await getDb(env);
  const known =
    adminEmails(env).includes(email) ||
    (await db.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first());
  if (!known) return reply;

  const since = Date.now() - 15 * 60 * 1000;
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > ?")
    .bind(email, since)
    .first();
  if (recent.n >= MAX_LINKS_PER_15_MIN) return reply;

  const token = randomToken(32);
  await db
    .prepare("INSERT INTO login_tokens (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), email, Date.now() + LINK_MINUTES * 60 * 1000, Date.now())
    .run();

  const url = `${new URL(request.url).origin}/portal/?login=${token}`;
  await sendEmail(env, {
    to: email,
    subject: "Your AlphaTechForge sign-in link",
    lines: [
      "Hi,",
      `Use the button below to sign in to your AlphaTechForge client portal. The link works once and expires in ${LINK_MINUTES} minutes.`,
      "If you didn't ask to sign in, you can ignore this email."
    ],
    button: { label: "Sign in to your portal", url }
  });
  return reply;
});
