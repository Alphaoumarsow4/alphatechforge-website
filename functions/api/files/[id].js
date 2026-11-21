// Downloads a project file (only the project's client or an admin), or deletes it (admin).
import { checkOrigin, handle, json, HttpError } from "../../_lib/core.js";
import { projectForUser, requireAdmin, requireUser } from "../../_lib/auth.js";
import { getDb } from "../../_lib/db.js";

async function findFile(db, user, id) {
  const file = await db.prepare("SELECT * FROM files WHERE id = ?").bind(String(id)).first();
  if (!file) throw new HttpError(404, "File not found.");
  await projectForUser(db, user, file.project_id);
  return file;
}

export const onRequestGet = handle(async ({ request, env, params }) => {
  const user = await requireUser(request, env);
  if (!env.FILES) throw new HttpError(503, "File storage isn't set up yet.");
  const db = await getDb(env);
  const file = await findFile(db, user, params.id);
  const object = await env.FILES.get(file.r2_key);
  if (!object) throw new HttpError(404, "File not found.");

  const ascii = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(object.body, {
    headers: {
      // Always a download, never rendered in the browser, so an uploaded file can't run as a web page.
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Content-Length": String(file.size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
});

export const onRequestDelete = handle(async ({ request, env, params }) => {
  checkOrigin(request);
  const user = await requireAdmin(request, env);
  const db = await getDb(env);
  const file = await findFile(db, user, params.id);
  if (env.FILES) await env.FILES.delete(file.r2_key);
  await db.prepare("DELETE FROM files WHERE id = ?").bind(file.id).run();
  return json({ ok: true });
});
