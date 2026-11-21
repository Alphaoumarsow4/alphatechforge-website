// Receives payment confirmations from Stripe.
// - A website package booked on the site becomes a project, with its countdown started.
// - A payment made in the client portal is marked as paid (approving an estimate starts its countdown).
import catalog from "../../catalog.json";
import { HOUR, cleanEmail, clean, json, money, newId } from "../_lib/core.js";
import { addEvent, ensureUser, getDb, splitPayments } from "../_lib/db.js";
import { notify, notifyAdmins, verifyStripeSignature } from "../_lib/services.js";

export async function onRequestPost({ request, env }) {
  const payload = await request.text();
  const valid = await verifyStripeSignature(payload, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return json({ error: "Invalid signature." }, 400);

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "Invalid payload." }, 400);
  }
  const handled = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
  if (!handled.includes(event.type) || event.data?.object?.payment_status !== "paid") {
    return json({ received: true });
  }

  let db;
  try {
    db = await getDb(env);
  } catch {
    // Database not connected yet: ask Stripe to retry later (it retries for up to 3 days).
    return json({ error: "Portal database unavailable." }, 503);
  }
  // Stripe can send the same event more than once; only act on it the first time.
  const fresh = await db
    .prepare("INSERT INTO stripe_events (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING RETURNING id")
    .bind(String(event.id), Date.now())
    .first();
  if (!fresh) return json({ received: true });

  try {
    const session = event.data.object;
    const origin = new URL(request.url).origin;
    if (session.metadata?.portal_payment_id) await recordPortalPayment(db, env, session, origin);
    else if (session.metadata?.package) await createProjectFromBooking(db, env, session, origin);
  } catch (err) {
    // Let Stripe retry later.
    await db.prepare("DELETE FROM stripe_events WHERE id = ?").bind(String(event.id)).run();
    console.error("Webhook processing failed", err?.stack || err);
    return json({ error: "Processing failed." }, 500);
  }
  return json({ received: true });
}

async function recordPortalPayment(db, env, session, origin) {
  const payment = await db
    .prepare("SELECT * FROM payments WHERE id = ?")
    .bind(session.metadata.portal_payment_id)
    .first();
  if (!payment || payment.status === "paid") return;
  if (payment.amount_cents !== session.amount_total) {
    console.error("Payment amount mismatch", payment.id, payment.amount_cents, session.amount_total);
  }
  const now = Date.now();
  await db.prepare("UPDATE payments SET status = 'paid', paid_at = ?, stripe_session_id = ? WHERE id = ?")
    .bind(now, session.id, payment.id).run();

  const project = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(payment.project_id).first();
  if (project.status === "estimate") {
    await db
      .prepare("UPDATE projects SET status = 'booked', start_at = ?, due_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now + (project.duration_hours || 36) * HOUR, now, project.id)
      .run();
    await addEvent(db, project.id, `Estimate approved and ${payment.label.toLowerCase()} paid (${money(payment.amount_cents)}). The countdown has started.`);
  } else {
    await addEvent(db, project.id, `Payment received: ${payment.label} (${money(payment.amount_cents)})`);
  }
  await notifyAdmins(env, {
    subject: `Payment received: ${project.title}`,
    lines: [`${project.client_email} paid ${money(payment.amount_cents)} for "${project.title}" (${payment.label}).`,
      project.status === "estimate" ? "The estimate is approved and the countdown has started." : ""].filter(Boolean),
    button: { label: "Open admin dashboard", url: `${origin}/portal/admin.html` }
  });
}

async function createProjectFromBooking(db, env, session, origin) {
  const source = `stripe:${session.id}`;
  if (await db.prepare("SELECT 1 FROM projects WHERE source = ?").bind(source).first()) return;

  const meta = session.metadata;
  const pkg = catalog.packages.find(p => p.id === meta.package);
  if (!pkg) return;
  const email = cleanEmail(session.customer_details?.email || session.customer_email || "");
  if (!email) return;
  const name = clean(meta.client_name, 100);
  const addons = String(meta.addons || "")
    .split(",")
    .map(id => catalog.addons.find(a => a.id === id))
    .filter(Boolean);

  const items = [{ name: `${pkg.name} website package`, amountCents: Math.round(pkg.price * 100) },
    ...addons.map(a => ({ name: a.name, amountCents: Math.round(a.price * 100) }))];
  const total = items.reduce((s, i) => s + i.amountCents, 0);
  const payments = splitPayments(total, pkg.schedule);
  const hours = pkg.durationHours || 36;
  const notes = [
    meta.notes && meta.notes !== "-" ? `Client notes: ${meta.notes}` : "",
    String(meta.care_plan || "").startsWith("requested") ? `Care plan requested (${money(catalog.carePlan.price * 100)}/month from launch).` : ""
  ].filter(Boolean).join("\n");

  const now = Date.now();
  const id = newId("prj");
  await ensureUser(db, email, name);
  await db.batch([
    db.prepare(
      `INSERT INTO projects (id, client_email, title, service, status, duration_hours, start_at, due_at, notes,
       source, created_at, updated_at) VALUES (?, ?, ?, 'Web Design & Development', 'booked', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, email, `${pkg.name} website`, hours, now, now + hours * HOUR, notes, source, now, now),
    ...items.map((item, i) =>
      db.prepare("INSERT INTO items (id, project_id, name, amount_cents, position) VALUES (?, ?, ?, ?, ?)")
        .bind(newId("itm"), id, item.name, item.amountCents, i)),
    ...payments.map((p, i) =>
      db.prepare(
        `INSERT INTO payments (id, project_id, label, amount_cents, status, position, paid_at, stripe_session_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId("pay"), id, p.label, p.amountCents, i === 0 ? "paid" : "due", i,
        i === 0 ? now : null, i === 0 ? session.id : null, now))
  ]);
  await addEvent(db, id, `Booked online and ${money(payments[0].amountCents)} paid. The countdown has started.`);

  await notify(env, {
    to: email,
    subject: `Your ${pkg.name} website is booked`,
    lines: [
      name ? `Hi ${name.split(" ")[0]},` : "Hi,",
      `Thank you for booking the ${pkg.name} package. Your project is set up and your delivery countdown (${hours} hours) has started.`,
      "In your client portal you can follow progress, send us your content and files, and message us. Sign in with this email address."
    ],
    button: { label: "Open your client portal", url: `${origin}/portal/` }
  });
  await notifyAdmins(env, {
    subject: `New booking: ${pkg.name} website`,
    lines: [`${name || email} (${email}) booked the ${pkg.name} package${addons.length ? ` with ${addons.map(a => a.name).join(", ")}` : ""}.`,
      `Delivery due in ${hours} hours.`, notes].filter(Boolean),
    button: { label: "Open admin dashboard", url: `${origin}/portal/admin.html` }
  });
}
