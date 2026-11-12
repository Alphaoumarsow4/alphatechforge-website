
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");

  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return json({ error: "Invalid request origin." }, 403);
  }

  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    return json({ error: "Invalid request format." }, 415);
  }

  if (Number(request.headers.get("Content-Length") || 0) > 12000) {
    return json({ error: "Message too large." }, 413);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Invalid form data." }, 400);
  }

  const clean = (value, max) =>
    typeof value === "string" ? value.trim().slice(0, max + 1) : "";

  const name = clean(data.name, 100);
  const email = clean(data.email, 150);
  const service = clean(data.service, 100);
  const message = clean(data.message, 2500);

  if (data.website) return json({ ok: true });

  const allowed = [
    "Web Design & Development",
    "Cybersecurity Solutions",
    "IT Support & Troubleshooting",
    "Presentations & Documents",
    "Excel & Data Solutions",
    "Tailored Digital Project"
  ];

  if (
    !name || name.length > 100 ||
    !email || email.length > 150 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !allowed.includes(service) ||
    message.length < 10 || message.length > 2500
  ) {
    return json({
      error: "Please complete the form with valid details (at least 10 characters for the message)."
    }, 400);
  }

  if (!env.RESEND_API_KEY || !env.CONTACT_FROM) {
    return json({
      error: "Contact form is not configured yet. Please use the email link."
    }, 503);
  }

  const content = `New AlphaTechForge inquiry

Name: ${name}
Email: ${email}
Service: ${service}

Project details:
${message}`;

  let upstream;

  try {
    upstream = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM,
        to: ["sow.al@northeastern.edu"],
        reply_to: email,
        subject: `AlphaTechForge inquiry: ${service}`,
        text: content
      })
    });
  } catch {
    return json({ error: "Email service temporarily unavailable." }, 502);
  }

  if (!upstream.ok) {
    console.error("Resend delivery error", upstream.status);
    return json({
      error: "Email delivery failed. Please try again or email us directly."
    }, 502);
  }

  return json({ ok: true });
}

export async function onRequestGet() {
  return json({ error: "Method not allowed." }, 405);
}
