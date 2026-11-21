// Admin: mark a payment as paid (e.g. received outside the portal) or back to due, or remove an unpaid one.
import { checkOrigin, handle, json, money, readJson, HttpError } from "../../../_lib/core.js";
import { requireAdmin } from "../../../_lib/auth.js";
import { addEvent, getDb } from "../../../_lib/db.js";

async function findPayment(db, id) {
  const payment = await db.prepare("SELECT * FROM payments WHERE id = ?").bind(String(id)).first();
  if (!payment) throw new HttpError(404, "Payment not found.");
  return payment;
}

export const onRequestPatch = handle(async ({ request, env, params }) => {
  await requireAdmin(request, env);
  const data = await readJson(request, 1000);
  if (!["paid", "due"].includes(data.status)) throw new HttpError(400, "Unknown payment status.");
  const db = await getDb(env);
  const payment = await findPayment(db, params.id);
  await db
    .prepare("UPDATE payments SET status = ?, paid_at = ? WHERE id = ?")
    .bind(data.status, data.status === "paid" ? Date.now() : null, payment.id)
    .run();
  await addEvent(db, payment.project_id,
    data.status === "paid" ? `Payment received: ${payment.label} (${money(payment.amount_cents)})` : `Payment reopened: ${payment.label}`);
  return json({ ok: true });
});

export const onRequestDelete = handle(async ({ request, env, params }) => {
  checkOrigin(request);
  await requireAdmin(request, env);
  const db = await getDb(env);
  const payment = await findPayment(db, params.id);
  if (payment.status === "paid") throw new HttpError(400, "Paid payments can't be removed.");
  await db.prepare("DELETE FROM payments WHERE id = ?").bind(payment.id).run();
  return json({ ok: true });
});
