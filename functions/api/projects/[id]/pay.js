// Starts a Stripe Checkout for one payment on a project (approving an estimate pays its first payment).
import catalog from "../../../../catalog.json";
import { handle, json, readJson, HttpError } from "../../../_lib/core.js";
import { projectForUser, requireUser } from "../../../_lib/auth.js";
import { getDb } from "../../../_lib/db.js";
import { createCheckoutSession } from "../../../_lib/services.js";

export const onRequestPost = handle(async ({ request, env, params }) => {
  const user = await requireUser(request, env);
  if (user.isAdmin) throw new HttpError(403, "Payments are made by the client.");
  const data = await readJson(request, 2000);
  if (data.agreeToTerms !== true || data.termsVersion !== catalog.termsVersion) {
    throw new HttpError(400, "Please review and accept the Terms of Service to continue.");
  }

  const db = await getDb(env);
  const project = await projectForUser(db, user, params.id);
  if (project.status === "cancelled") throw new HttpError(400, "This project is closed.");

  const { results: due } = await db
    .prepare("SELECT * FROM payments WHERE project_id = ? AND status = 'due' ORDER BY position, created_at")
    .bind(project.id)
    .all();
  const payment = due.find(p => p.id === data.paymentId);
  if (!payment) throw new HttpError(400, "This payment isn't due.");
  // An estimate is approved by paying its first payment; later ones open up after that.
  if (project.status === "estimate" && payment.id !== due[0].id) {
    throw new HttpError(400, "Please approve the estimate with the first payment.");
  }

  const origin = new URL(request.url).origin;
  const params2 = new URLSearchParams();
  params2.set("mode", "payment");
  params2.set("customer_email", user.email);
  params2.set("success_url", `${origin}/portal/?paid=1#${project.id}`);
  params2.set("cancel_url", `${origin}/portal/#${project.id}`);
  params2.set("line_items[0][quantity]", "1");
  params2.set("line_items[0][price_data][currency]", catalog.currency);
  params2.set("line_items[0][price_data][unit_amount]", String(payment.amount_cents));
  params2.set("line_items[0][price_data][product_data][name]", `${project.title}: ${payment.label}`.slice(0, 250));
  const metadata = {
    portal_payment_id: payment.id,
    project_id: project.id,
    terms_version: catalog.termsVersion,
    terms_accepted_at: new Date().toISOString()
  };
  for (const [k, v] of Object.entries(metadata)) {
    params2.set(`metadata[${k}]`, v);
    params2.set(`payment_intent_data[metadata][${k}]`, v);
  }
  params2.set("payment_intent_data[description]", `AlphaTechForge: ${project.title} (${payment.label})`.slice(0, 1000));

  const session = await createCheckoutSession(env, params2);
  await db.prepare("UPDATE payments SET stripe_session_id = ? WHERE id = ?").bind(session.id || null, payment.id).run();
  return json({ url: session.url });
});
