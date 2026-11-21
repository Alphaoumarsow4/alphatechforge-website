import { checkOrigin, handle, json, sha256 } from "../../_lib/core.js";
import { readSessionToken, sessionCookie } from "../../_lib/auth.js";
import { getDb } from "../../_lib/db.js";

export const onRequestPost = handle(async ({ request, env }) => {
  checkOrigin(request);
  const token = readSessionToken(request);
  if (token) {
    const db = await getDb(env);
    await db.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256(token)).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
});
