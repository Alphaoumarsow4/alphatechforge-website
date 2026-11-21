import { handle, json } from "../_lib/core.js";
import { FRESH_SESSION_MS, publicUser, requireUser } from "../_lib/auth.js";
import { getDb } from "../_lib/db.js";

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env);
  const me = publicUser(user);
  if (user.isAdmin) {
    const db = await getDb(env);
    const cred = await db.prepare("SELECT 1 FROM credentials WHERE email = ?").bind(user.email).first();
    me.hasPassword = Boolean(cred);
    // Just signed in: may set a new password without typing the current one.
    me.canResetPassword = Date.now() - user.signedInAt < FRESH_SESSION_MS;
  }
  return json(me);
});
