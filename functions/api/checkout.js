// Creates a Stripe Checkout Session for a website package.
// Prices are always taken from catalog.json on the server, never from the browser.
import catalog from "../../catalog.json";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

// Splits a total (in cents) across the package's payment schedule.
// Each instalment is rounded to whole dollars; the last one absorbs the
// difference so the parts always add up. (Mirrored in index.html.)
export function paymentPlan(pkg, addonIds = []) {
  const addons = addonIds.map(id => catalog.addons.find(a => a.id === id));
  const totalCents = Math.round(pkg.price * 100) + addons.reduce((s, a) => s + Math.round(a.price * 100), 0);
  let allocated = 0;
  const instalments = pkg.schedule.map((step, i) => {
    const amount = i === pkg.schedule.length - 1
      ? totalCents - allocated
      : Math.round(totalCents * step.percent / 10000) * 100;
    allocated += amount;
    return { label: step.label, percent: step.percent, amountCents: amount };
  });
  return { addons, totalCents, instalments };
}

const money = cents => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0 });

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  const self = new URL(request.url).origin;

  if (origin && new URL(origin).origin !== self) {
    return json({ error: "Invalid request origin." }, 403);
  }
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    return json({ error: "Invalid request format." }, 415);
  }
  if (Number(request.headers.get("Content-Length") || 0) > 8000) {
    return json({ error: "Request too large." }, 413);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  const name = clean(data.name, 100);
  const email = clean(data.email, 150);
  const notes = clean(data.notes, 450);
  const pkg = catalog.packages.find(p => p.id === data.package);
  const addonIds = Array.isArray(data.addons) ? [...new Set(data.addons)] : [];
  const carePlan = data.carePlan === true;

  if (!pkg) return json({ error: "Please choose a package." }, 400);
  if (addonIds.length > catalog.addons.length || addonIds.some(id => !catalog.addons.some(a => a.id === id))) {
    return json({ error: "One of the selected add-ons is not available." }, 400);
  }
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please enter your name and a valid email address." }, 400);
  }
  if (data.agreeToTerms !== true || data.termsVersion !== catalog.termsVersion) {
    return json({ error: "Please review and accept the Terms of Service to continue." }, 400);
  }

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "Online payment isn't set up yet. Please request a quote and we'll send you a secure payment link." }, 503);
  }

  const { addons, totalCents, instalments } = paymentPlan(pkg, addonIds);
  const first = instalments[0];
  const scheduleText = instalments.map(i => `${i.label}: ${money(i.amountCents)} (${i.percent}%)`).join(" · ");
  const itemText = [`${pkg.name} package`, ...addons.map(a => a.name)].join(", ");
  const description = instalments.length > 1
    ? `${first.percent}% booking payment for: ${itemText}. Project total ${money(totalCents)}. Schedule: ${scheduleText}.`
    : `Full payment for: ${itemText}.`;

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("customer_email", email);
  params.set("success_url", `${self}/?checkout=success#packages`);
  params.set("cancel_url", `${self}/?checkout=cancelled#packages`);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", catalog.currency);
  params.set("line_items[0][price_data][unit_amount]", String(first.amountCents));
  params.set("line_items[0][price_data][product_data][name]",
    instalments.length > 1 ? `${pkg.name} website package (${first.percent}% booking payment)` : `${pkg.name} website package`);
  params.set("line_items[0][price_data][product_data][description]", description.slice(0, 500));

  const metadata = {
    client_name: name,
    package: pkg.id,
    addons: addonIds.join(",") || "none",
    care_plan: carePlan ? "requested (bill from launch)" : "no",
    project_total: money(totalCents),
    payment_schedule: scheduleText.slice(0, 500),
    terms_version: catalog.termsVersion,
    terms_accepted_at: new Date().toISOString(),
    notes: notes || "-"
  };
  for (const [k, v] of Object.entries(metadata)) {
    params.set(`metadata[${k}]`, v);
    params.set(`payment_intent_data[metadata][${k}]`, v);
  }
  params.set("payment_intent_data[description]", `AlphaTechForge: ${itemText}`.slice(0, 1000));

  let upstream;
  try {
    upstream = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });
  } catch {
    return json({ error: "Payment service temporarily unavailable. Please try again shortly." }, 502);
  }

  const session = await upstream.json().catch(() => ({}));
  if (!upstream.ok || !session.url) {
    console.error("Stripe checkout error", upstream.status, session.error?.message);
    return json({ error: "We couldn't start the payment. Please try again or request a quote instead." }, 502);
  }

  return json({ url: session.url });
}

export async function onRequestGet() {
  return json({ error: "Method not allowed." }, 405);
}
