// Admin: add a payment request to a project (the client pays it in their portal).
import { clean, handle, json, money, newId, readJson, HttpError } from "../../../../_lib/core.js";
import { requireAdmin } from "../../../../_lib/auth.js";
import { addEvent, getDb } from "../../../../_lib/db.js";
import { notify } from "../../../../_lib/services.js";

export const onRequestPost = handle(async ({ request, env, params }) => {
  await requireAdmin(request, env);
  const data = await readJson(request, 2000);
  const label = clean(data.label, 60);
  const amountCents = Math.round(Number(data.amount) * 100);
  if (!label) throw new HttpError(400, "Describe the payment.");
  if (!Number.isFinite(amountCents) || amountCents < 50 || amountCents > 100000000) {
    throw new HttpError(400, "Enter an amount of at least $0.50.");
  }

  const db = await getDb(env);
  const project = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(String(params.id)).first();
  if (!project) throw new HttpError(404, "Project not found.");
  const last = await db.prepare("SELECT MAX(position) AS p FROM payments WHERE project_id = ?").bind(project.id).first();
  await db
    .prepare(
      `INSERT INTO payments (id, project_id, label, amount_cents, status, position, created_at)
       VALUES (?, ?, ?, ?, 'due', ?, ?)`
    )
    .bind(newId("pay"), project.id, label, amountCents, (last?.p ?? -1) + 1, Date.now())
    .run();
  await addEvent(db, project.id, `Payment requested: ${label} (${money(amountCents)})`);

  if (data.notify !== false) {
    await notify(env, {
      to: project.client_email,
      subject: `Payment due: ${project.title}`,
      lines: [`A payment of ${money(amountCents)} (${label}) is due for "${project.title}". You can pay securely in your client portal.`],
      button: { label: "Pay in your portal", url: `${new URL(request.url).origin}/portal/` }
    });
  }
  return json({ ok: true });
});
