// Messages on a project between the client and AlphaTechForge.
import { clean, handle, json, newId, readJson, HttpError } from "../../../_lib/core.js";
import { projectForUser, requireUser } from "../../../_lib/auth.js";
import { getDb } from "../../../_lib/db.js";
import { notify, notifyAdmins } from "../../../_lib/services.js";

export const onRequestPost = handle(async ({ request, env, params }) => {
  const user = await requireUser(request, env);
  const data = await readJson(request, 8000);
  const body = clean(data.body, 4000);
  if (!body) throw new HttpError(400, "Please write a message.");

  const db = await getDb(env);
  const project = await projectForUser(db, user, params.id);
  const sender = user.isAdmin ? "admin" : "client";
  await db
    .prepare("INSERT INTO messages (id, project_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(newId("msg"), project.id, sender, body, Date.now())
    .run();

  const portal = `${new URL(request.url).origin}/portal/`;
  const preview = body.length > 300 ? body.slice(0, 300) + "…" : body;
  if (sender === "client") {
    await notifyAdmins(env, {
      subject: `New message: ${project.title}`,
      lines: [`${user.name || user.email} wrote about "${project.title}":`, preview],
      button: { label: "Open admin dashboard", url: `${portal}admin.html` }
    });
  } else {
    await notify(env, {
      to: project.client_email,
      subject: `New message about ${project.title}`,
      lines: ["You have a new message from AlphaTechForge:", preview],
      button: { label: "Open your portal", url: portal }
    });
  }
  return json({ ok: true });
});
