// Shared code for the client portal and the admin dashboard.
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = cents => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
const fmtDate = ms => new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtDay = ms => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtSize = b => (b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1024 / 1024).toFixed(1) + " MB");
const HOUR = 3600000;

// Server time keeps every countdown accurate even if the visitor's clock is off.
let clockOffset = 0;
const now = () => Date.now() + clockOffset;

async function api(path, { method = "GET", body, form } = {}) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) { const err = new Error(data.error || "Something went wrong."); err.status = res.status; throw err; }
  return data;
}

function toast(message, bad = false) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = message; t.classList.toggle("bad", bad); t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3200);
}

const ACTIVE = ["booked", "design", "build", "review"];
const isActive = p => ACTIVE.includes(p.status);

// ---------- Countdown ----------
function timerHtml(p, { admin = false } = {}) {
  if (p.status === "cancelled") return "";
  const hours = p.durationHours || 36;
  if (p.status === "estimate") {
    return `<div class="timer"><div class="timer-top"><span class="label">Delivery time</span></div>
      <p class="msg"><b>${hours} hours</b> ${admin ? "once the client approves" : "from when you approve this estimate"}.</p></div>`;
  }
  if (p.status === "done") {
    return `<div class="timer finished"><div class="timer-top"><span class="label">Completed</span>
      <span class="due">${fmtDate(p.updatedAt)}</span></div><p class="msg">${esc(p.statusLabel)}. Thank you!</p>
      <div class="bar"><i style="width:100%"></i></div></div>`;
  }
  if (!p.dueAt) return "";
  return `<div class="timer" data-start="${p.startAt || p.createdAt}" data-due="${p.dueAt}">
    <div class="timer-top"><span class="label" data-t-label>Time to delivery</span><span class="due">Due ${fmtDate(p.dueAt)}</span></div>
    <div class="clock" aria-live="off" data-clock></div>
    <p class="msg" data-t-msg hidden></p>
    <div class="bar"><i data-bar></i></div></div>`;
}

function renderClock(el) {
  const start = +el.dataset.start, due = +el.dataset.due, t = now();
  const left = due - t, overdue = left < 0, ms = Math.abs(left);
  const d = Math.floor(ms / 86400000), h = Math.floor(ms / HOUR) % 24, m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  const parts = (d ? [[d, d === 1 ? "day" : "days"]] : []).concat([[h, "hrs"], [m, "min"], [s, "sec"]]);
  $("[data-clock]", el).innerHTML = parts.map(([v, u]) => `<div><b>${overdue ? "+" : ""}${String(v).padStart(2, "0")}</b><small>${u}</small></div>`).join("");
  const total = Math.max(due - start, 1);
  $("[data-bar]", el).style.width = Math.min(100, Math.max(0, ((t - start) / total) * 100)).toFixed(2) + "%";
  const soon = !overdue && left < Math.min(6 * HOUR, total * 0.5);
  el.classList.toggle("overdue", overdue);
  el.classList.toggle("soon", soon);
  $("[data-t-label]", el).textContent = overdue ? "Past due by" : "Time to delivery";
  const msg = $("[data-t-msg]", el);
  msg.hidden = !overdue && !soon;
  msg.textContent = overdue ? "Running a little late. You'll get an update shortly." : "Almost there. Delivery is coming up soon.";
  const card = el.closest(".project");
  if (card) { card.classList.toggle("overdue", overdue); card.classList.toggle("soon", soon); }
}

function tickClocks() { $$(".timer[data-due]").forEach(renderClock); }
setInterval(tickClocks, 1000);

// ---------- Pieces ----------
function stepperHtml(p) {
  if (p.status === "cancelled") return "";
  const idx = p.stages.findIndex(s => s.key === p.status);
  return `<ol class="stepper" aria-label="Project stage: ${esc(p.statusLabel)}">${p.stages.map((s, i) =>
    `<li class="${i < idx || p.status === "done" ? "done" : i === idx ? "now" : ""}"><i></i><span>${esc(s.label)}</span></li>`).join("")}</ol>`;
}

function statusPill(p) {
  const cls = p.status === "done" ? "ok" : p.status === "cancelled" ? "mute" : p.status === "estimate" ? "gold" : "gold";
  return `<span class="pill ${cls}">${esc(p.statusLabel)}</span>`;
}

function itemsHtml(p) {
  const total = p.items.reduce((s, i) => s + i.amountCents, 0);
  return `<div class="lines">${p.items.map(i => `<div><span>${esc(i.name)}</span><span class="amt">${money(i.amountCents)}</span></div>`).join("")}
    <div class="total"><span>Total</span><span class="amt">${money(total)}</span></div></div>`;
}

function eventsHtml(p) {
  if (!p.events.length) return `<p class="muted small">No updates yet.</p>`;
  return `<ul class="events">${p.events.map(e => `<li><div>${esc(e.text)}<time>${fmtDate(e.at)}</time></div></li>`).join("")}</ul>`;
}

function threadHtml(p, mySide) {
  const msgs = p.messages.length ? p.messages.map(m =>
    `<div class="msg-b ${m.sender === mySide ? "me" : "them"}">${esc(m.body)}<time>${m.sender === "admin" ? "AlphaTechForge" : esc(p.clientName || "Client")} · ${fmtDate(m.at)}</time></div>`).join("")
    : `<p class="muted small">No messages yet.</p>`;
  return `<div class="thread">${msgs}</div>
    <form class="composer" data-msg-form="${p.id}"><textarea class="input" name="body" maxlength="4000" placeholder="Write a message…" required></textarea>
    <div><button class="btn small primary" type="submit">Send message</button></div></form>`;
}

function filesHtml(p, { canDelete = false } = {}) {
  const list = p.files.length ? p.files.map(f => `<div class="file-row"><span class="n">${esc(f.name)} <span class="muted small">· ${fmtSize(f.size)} · ${f.uploadedBy === "admin" ? "from AlphaTechForge" : "from client"}</span></span>
    <span style="display:flex;gap:6px;flex:none"><a class="btn small" href="/api/files/${encodeURIComponent(f.id)}">Download</a>${canDelete ? `<button class="btn small danger" type="button" data-del-file="${f.id}">Delete</button>` : ""}</span></div>`).join("")
    : `<p class="muted small">No files yet.</p>`;
  return `<div>${list}</div><form data-upload-form="${p.id}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
    <input type="file" name="file" required class="small" style="max-width:100%"><button class="btn small" type="submit">Upload</button>
    <span class="muted small">Up to 25 MB</span></form>`;
}

// Shared form handlers (messages and uploads) used by both pages.
function bindSharedForms(root, reload) {
  root.addEventListener("submit", async e => {
    const msgForm = e.target.closest("[data-msg-form]");
    const upForm = e.target.closest("[data-upload-form]");
    if (!msgForm && !upForm) return;
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      if (msgForm) {
        await api(`/api/projects/${encodeURIComponent(msgForm.dataset.msgForm)}/messages`, { method: "POST", body: { body: msgForm.body.value } });
        toast("Message sent");
      } else {
        const file = upForm.file.files[0];
        if (!file) return;
        if (file.size > 25 * 1024 * 1024) throw new Error("Files can be up to 25 MB.");
        const fd = new FormData(); fd.append("file", file);
        btn.textContent = "Uploading…";
        await api(`/api/projects/${encodeURIComponent(upForm.dataset.uploadForm)}/files`, { method: "POST", form: fd });
        toast("File uploaded");
      }
      await reload();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      if (upForm) btn.textContent = "Upload";
    }
  });
}

// Remembers which sections are open across refreshes.
function rememberOpen(root) {
  return new Set($$("details[data-key][open]", root).map(d => d.dataset.key));
}
function restoreOpen(root, keys) {
  $$("details[data-key]", root).forEach(d => { if (keys.has(d.dataset.key)) d.open = true; });
}

// True while the user is typing or has picked a file, so auto-refresh doesn't wipe their work.
function isBusy(root) {
  return $$("textarea, input, select", root).some(el =>
    el === document.activeElement || (el.tagName === "TEXTAREA" && el.value !== el.defaultValue) || (el.type === "file" && el.files.length) ||
    (el.type === "checkbox" && el.checked && el.hasAttribute("data-agree")));
}

async function signOut() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  location.href = "/portal/";
}
