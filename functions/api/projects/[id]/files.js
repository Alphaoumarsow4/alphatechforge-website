// Uploads a file to a project (clients send content; AlphaTechForge sends deliverables).
import { checkOrigin, clean, handle, json, newId, HttpError } from "../../../_lib/core.js";
import { projectForUser, requireUser } from "../../../_lib/auth.js";
import { addEvent, getDb } from "../../../_lib/db.js";
import { notify, notifyAdmins } from "../../../_lib/services.js";

const MAX_BYTES = 25 * 1024 * 1024;

export const onRequestPost = handle(async ({ request, env, params }) => {
  checkOrigin(request);
  const user = await requireUser(request, env);
  if (!env.FILES) throw new HttpError(503, "File storage isn't set up yet.");
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BYTES + 100000) {
    throw new HttpError(413, "Files can be up to 25 MB.");
  }

  const db = await getDb(env);
  const project = await projectForUser(db, user, params.id);

  let form;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Invalid upload.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw new HttpError(400, "Please choose a file.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Files can be up to 25 MB.");
  if (file.size === 0) throw new HttpError(400, "That file is empty.");

  const name = clean(file.name, 150).replace(/[\\/\r\n"]/g, "_") || "file";
  const id = newId("file");
  const key = `projects/${project.id}/${id}`;
  await env.FILES.put(key, file.stream(), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { filename: name, project: project.id }
  });
  const by = user.isAdmin ? "admin" : "client";
  await db
    .prepare(
      `INSERT INTO files (id, project_id, r2_key, filename, content_type, size, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, project.id, key, name, clean(file.type, 100), file.size, by, Date.now())
    .run();
  await addEvent(db, project.id, by === "admin" ? `New file shared: ${name}` : `Client uploaded: ${name}`);

  const portal = `${new URL(request.url).origin}/portal/`;
  if (by === "admin") {
    await notify(env, {
      to: project.client_email,
      subject: `New file for ${project.title}`,
      lines: [`AlphaTechForge shared a new file with you: ${name}.`],
      button: { label: "Download it in your portal", url: portal }
    });
  } else {
    await notifyAdmins(env, {
      subject: `Client uploaded a file: ${project.title}`,
      lines: [`${user.name || user.email} uploaded "${name}" to "${project.title}".`],
      button: { label: "Open admin dashboard", url: `${portal}admin.html` }
    });
  }
  return json({ ok: true, id });
});
