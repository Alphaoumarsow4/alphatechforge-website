// Admin: update a project's status, deadline, title or notes, and optionally tell the client.
import { HOUR, clean, handle, json, readJson, HttpError } from "../../../_lib/core.js";
import { requireAdmin } from "../../../_lib/auth.js";
import { ALL_STATUSES, addEvent, getDb, statusLabel } from "../../../_lib/db.js";
import { notify } from "../../../_lib/services.js";

export const onRequestPatch = handle(async ({ request, env, params }) => {
  await requireAdmin(request, env);
  const data = await readJson(request, 8000);
  const db = await getDb(env);
  const project = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(String(params.id)).first();
  if (!project) throw new HttpError(404, "Project not found.");

  const now = Date.now();
  const next = { ...project };
  const changes = [];

  if (data.status !== undefined && data.status !== project.status) {
    if (!ALL_STATUSES.includes(data.status)) throw new HttpError(400, "Unknown status.");
    next.status = data.status;
    // Starting work on an estimate starts the clock.
    if (project.status === "estimate" && !project.start_at && !["estimate", "cancelled"].includes(data.status)) {
      next.start_at = now;
      next.due_at = now + (project.duration_hours || 36) * HOUR;
    }
    changes.push(`Status: ${statusLabel(project.service, data.status)}`);
  }
  if (data.dueAt !== undefined) {
    const due = Number(data.dueAt);
    if (!Number.isFinite(due) || due < now - 365 * 24 * HOUR || due > now + 3 * 365 * 24 * HOUR) {
      throw new HttpError(400, "Choose a valid delivery date.");
    }
    if (due !== project.due_at) {
      next.due_at = due;
      if (!next.start_at) next.start_at = now;
      changes.push("Delivery time updated");
    }
  }
  if (data.title !== undefined) {
    const title = clean(data.title, 120);
    if (!title) throw new HttpError(400, "Title can't be empty.");
    next.title = title;
  }
  if (data.notes !== undefined) next.notes = clean(data.notes, 2000);

  await db
    .prepare(
      `UPDATE projects SET status = ?, start_at = ?, due_at = ?, title = ?, notes = ?, updated_at = ? WHERE id = ?`
    )
    .bind(next.status, next.start_at, next.due_at, next.title, next.notes, now, project.id)
    .run();

  const update = clean(data.update, 1000);
  const eventText = [changes.join(" · "), update].filter(Boolean).join(" · ");
  if (eventText) await addEvent(db, project.id, eventText);

  if (data.notify && eventText) {
    await notify(env, {
      to: project.client_email,
      subject: `Update on ${next.title}`,
      lines: [
        `There's an update on your project "${next.title}":`,
        eventText,
        next.status === "done" ? "Your project is complete. Thank you for working with AlphaTechForge!" : ""
      ].filter(Boolean),
      button: { label: "See it in your portal", url: `${new URL(request.url).origin}/portal/` }
    });
  }
  return json({ ok: true });
});
