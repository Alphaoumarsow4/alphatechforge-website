// Email (Resend) and payments (Stripe) for the client portal.
import { HttpError } from "./core.js";
import { adminEmails } from "./auth.js";

const escapeHtml = s =>
  String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Sends a simple branded email. `lines` are plain-text paragraphs; `button` is { label, url }.
export async function sendEmail(env, { to, subject, lines, button }) {
  if (!env.RESEND_API_KEY || !env.CONTACT_FROM) throw new HttpError(503, "Email isn't set up yet.");
  const text = [...lines, button ? `${button.label}: ${button.url}` : "", "", "AlphaTechForge"].join("\n\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#1b1f27">
    <p style="font-size:18px;font-weight:bold;margin:0 0 20px">Alpha<span style="color:#b8913a">Tech</span>Forge</p>
    ${lines.map(l => `<p style="font-size:15px;line-height:1.6">${escapeHtml(l)}</p>`).join("")}
    ${button ? `<p style="margin:28px 0"><a href="${escapeHtml(button.url)}" style="background:#d9b461;color:#12141a;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(button.label)}</a></p>` : ""}
    <p style="font-size:13px;color:#6b7280">AlphaTechForge &middot; alphatechforge.com</p></div>`;

  let response;
  try {
    response = await fetch(`${env.RESEND_API_URL || "https://api.resend.com"}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.CONTACT_FROM, to: Array.isArray(to) ? to : [to], subject, text, html })
    });
  } catch {
    throw new HttpError(502, "Email service unavailable.");
  }
  if (!response.ok) {
    console.error("Resend error", response.status);
    throw new HttpError(502, "Email could not be sent.");
  }
}

// Notifications are a courtesy: a failed email must never break the action that triggered it.
export async function notify(env, message) {
  try {
    await sendEmail(env, message);
  } catch (err) {
    console.error("Notification failed", err?.message);
  }
}

export const notifyAdmins = (env, message) => {
  const to = adminEmails(env);
  return to.length ? notify(env, { ...message, to }) : Promise.resolve();
};

export async function createCheckoutSession(env, params) {
  if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, "Online payment isn't set up yet.");
  let response;
  try {
    response = await fetch(`${env.STRIPE_API_URL || "https://api.stripe.com"}/v1/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params
    });
  } catch {
    throw new HttpError(502, "Payment service temporarily unavailable.");
  }
  const session = await response.json().catch(() => ({}));
  if (!response.ok || !session.url) {
    console.error("Stripe checkout error", response.status, session.error?.message);
    throw new HttpError(502, "We couldn't start the payment. Please try again.");
  }
  return session;
}

const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");

// Verifies the Stripe-Signature header (https://docs.stripe.com/webhooks#verify-manually).
export async function verifyStripeSignature(payload, header, secret, toleranceSeconds = 300) {
  if (!header || !secret) return false;
  const parts = header.split(",").map(p => p.split("="));
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`)));
  return signatures.some(sig => {
    if (sig.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}
