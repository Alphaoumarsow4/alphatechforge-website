// Shared helpers for the client portal API.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });

// Wraps a handler so thrown HttpErrors become JSON error responses.
export const handle = fn => async context => {
  try {
    return await fn(context);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("Portal error", err?.stack || err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};

// Blocks requests sent from other websites (protects the login cookie).
export function checkOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    throw new HttpError(403, "Invalid request origin.");
  }
}

export async function readJson(request, maxBytes = 20000) {
  checkOrigin(request);
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Invalid request format.");
  }
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid request.");
  }
}

export const clean = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
export const cleanEmail = value => clean(value, 150).toLowerCase();
export const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 150;

const toBase64Url = bytes =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const randomToken = (bytes = 32) => toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
export const newId = prefix => `${prefix}_${randomToken(9)}`;

export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export const HOUR = 60 * 60 * 1000;
export const money = cents =>
  "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
