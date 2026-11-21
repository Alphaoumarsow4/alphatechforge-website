// Lists projects: a client sees their own; an admin sees everyone's.
import { handle, json } from "../../_lib/core.js";
import { requireUser } from "../../_lib/auth.js";
import { getDb, loadProjects } from "../../_lib/db.js";

export const onRequestGet = handle(async ({ request, env }) => {
  const user = await requireUser(request, env);
  const db = await getDb(env);
  const projects = user.isAdmin
    ? await loadProjects(db)
    : await loadProjects(db, "p.client_email = ? AND p.status <> 'cancelled'", [user.email]);
  return json({ projects, serverTime: Date.now() });
});
