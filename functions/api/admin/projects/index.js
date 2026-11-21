// Admin: create a project or an estimate for a client.
import { HOUR, clean, cleanEmail, handle, json, newId, readJson, validEmail, money, HttpError } from "../../../_lib/core.js";
import { requireAdmin } from "../../../_lib/auth.js";
import { DEFAULT_HOURS, SERVICES, addEvent, ensureUser, getDb, splitPayments } from "../../../_lib/db.js";
import { notify } from "../../../_lib/services.js";

export const onRequestPost = handle(async ({ request, env }) => {
  await requireAdmin(request, env);
  const data = await readJson(request, 20000);

  const clientEmail = cleanEmail(data.clientEmail);
  const clientName = clean(data.clientName, 100);
  const title = clean(data.title, 120);
  const service = SERVICES.includes(data.service) ? data.service : null;
  const status = data.status === "estimate" ? "estimate" : "booked";
  const hours = Math.round(Number(data.durationHours) || DEFAULT_HOURS);
  const notes = clean(data.notes, 2000);

  if (!validEmail(clientEmail)) throw new HttpError(400, "Enter the client's email address.");
  if (!title) throw new HttpError(400, "Give the project a title.");
  if (!service) throw new HttpError(400, "Choose a service.");
  if (hours < 1 || hours > 24 * 365) throw new HttpError(400, "Delivery time must be between 1 hour and 1 year.");

  const items = (Array.isArray(data.items) ? data.items : [])
    .map(i => ({ name: clean(i?.name, 150), amountCents: Math.round(Number(i?.amount) * 100) }))
    .filter(i => i.name);
  if (!items.length || items.length > 30) throw new HttpError(400, "Add at least one line item.");
  if (items.some(i => !Number.isFinite(i.amountCents) || i.amountCents < 0 || i.amountCents > 100000000)) {
    throw new HttpError(400, "Check the item prices.");
  }
  const total = items.reduce((s, i) => s + i.amountCents, 0);

  const schedule = (Array.isArray(data.schedule) ? data.schedule : [])
    .map(s => ({ label: clean(s?.label, 60), percent: Number(s?.percent) }))
    .filter(s => s.label);
  if (total > 0) {
    if (!schedule.length || schedule.some(s => !(s.percent > 0)) || schedule.reduce((s, x) => s + x.percent, 0) !== 100) {
      throw new HttpError(400, "Payment percentages must add up to 100.");
    }
  }
  if (total > 0 && total < 50) throw new HttpError(400, "The total must be at least $0.50 for online payment.");

  const db = await getDb(env);
  const now = Date.now();
  const id = newId("prj");
  await ensureUser(db, clientEmail, clientName);
  const statements = [
    db
      .prepare(
        `INSERT INTO projects (id, client_email, title, service, status, duration_hours, start_at, due_at, notes,
         source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?)`
      )
      .bind(id, clientEmail, title, service, status, hours,
        status === "booked" ? now : null, status === "booked" ? now + hours * HOUR : null, notes, now, now),
    ...items.map((item, i) =>
      db.prepare("INSERT INTO items (id, project_id, name, amount_cents, position) VALUES (?, ?, ?, ?, ?)")
        .bind(newId("itm"), id, item.name, item.amountCents, i)
    ),
    ...(total > 0 ? splitPayments(total, schedule) : []).map((p, i) =>
      db.prepare(
        `INSERT INTO payments (id, project_id, label, amount_cents, status, position, created_at)
         VALUES (?, ?, ?, ?, 'due', ?, ?)`
      ).bind(newId("pay"), id, p.label, p.amountCents, i, now)
    )
  ];
  await db.batch(statements);
  await addEvent(db, id, status === "estimate" ? `Estimate sent (${money(total)})` : "Project booked. The countdown has started.");

  if (data.notify !== false) {
    await notify(env, {
      to: clientEmail,
      subject: status === "estimate" ? `Your estimate from AlphaTechForge: ${title}` : `Your project is set up: ${title}`,
      lines: [
        clientName ? `Hi ${clientName.split(" ")[0]},` : "Hi,",
        status === "estimate"
          ? `Your written estimate for "${title}" is ready (${money(total)}). You can review it, ask questions and approve it in your client portal.`
          : `Your project "${title}" is set up. You can follow its progress, countdown and files in your client portal.`,
        "Sign in with this email address; we'll send you a one-time sign-in link."
      ],
      button: { label: "Open your client portal", url: `${new URL(request.url).origin}/portal/` }
    });
  }
  return json({ ok: true, id });
});
