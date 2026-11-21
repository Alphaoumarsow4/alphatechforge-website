# AlphaTechForge

Official website for AlphaTechForge — https://alphatechforge.com

A single-page static site (`index.html`) hosted on Cloudflare Pages, with a serverless
contact form handler at `functions/api/contact.js`.

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | The entire site: markup, styles and script |
| `catalog.json` | Website packages, add-ons, care plan, payment schedules and the current Terms version. **Edit prices here only.** |
| `terms.html`, `privacy.html` | Terms of Service and Privacy Policy |
| `functions/api/contact.js` | Cloudflare Pages Function that receives the inquiry form and emails it via Resend |
| `functions/api/checkout.js` | Cloudflare Pages Function that creates a Stripe Checkout payment for a website package |
| `portal/` | Client portal (`/portal/`) and admin dashboard (`/portal/admin.html`) |
| `functions/api/auth`, `projects`, `files`, `admin`, `me.js` | Client portal API: email-link sign-in, projects, payments, files, messages |
| `functions/api/stripe-webhook.js` | Receives Stripe payment confirmations: creates projects from bookings and marks portal payments as paid |
| `functions/_lib/` | Shared code for the portal API (not exposed as web routes) |
| `_headers` | Security headers applied by Cloudflare Pages |
| `favicon.svg`, `robots.txt`, `sitemap.xml` | Static assets |

## Changing the contact email

The address appears in three places — update all of them together:

1. `index.html` — the `EMAIL` constant in the script, the two `mailto:` links, and the JSON-LD block in `<head>`
2. `functions/api/contact.js` — the `to:` field

## Contact form setup

Email delivery won't work until the following steps are done.

1. Sign up at [Resend](https://resend.com) and verify a domain you control (e.g. `alphatechforge.com`).
2. Create a Resend API key. **Never commit it to this repository.**
3. In Cloudflare → Workers & Pages → your project → Settings → Variables and Secrets, add:
   - `RESEND_API_KEY` — your Resend API key (Secret)
   - `CONTACT_FROM` — e.g. `AlphaTechForge <contact@alphatechforge.com>` (must use the verified domain)
4. Redeploy the project.
5. Deploy using a method that supports Pages Functions: a connected Git repository (recommended) or
   `npx wrangler pages deploy . --project-name alphatechforge`. Dashboard drag-and-drop may skip `functions/`.
6. Submit a test inquiry and confirm it arrives (check spam).
7. Before a wider launch, consider adding Cloudflare Turnstile and rate limiting — the hidden honeypot field
   alone won't stop targeted spam.

If the variables are missing, the form shows a message asking visitors to use the email link instead.

## Online payments (Stripe)

Website packages can be booked and paid online. The visitor picks a package and add-ons, accepts the
Terms of Service, and is sent to Stripe's hosted checkout page to pay the **first instalment** of that
package's payment schedule. Card details never touch this site.

### Setup

1. Create an account at [Stripe](https://stripe.com) and complete account verification (business details and payout bank account).
2. In Stripe → Developers → API keys, copy the **Secret key**. Use a test key (`sk_test_…`) first. **Never commit it to this repository.**
3. In Cloudflare → Workers & Pages → your project → Settings → Variables and Secrets, add
   `STRIPE_SECRET_KEY` as a **Secret**.
4. Redeploy the project (same deployment method as the contact form, so `functions/` is included).
5. Test a booking with Stripe's test card `4242 4242 4242 4242`, any future expiry date and any CVC. Check that the payment
   appears in Stripe → Payments, with the package, add-ons, schedule and Terms acceptance in its metadata.
6. When everything works, replace the test key with your live key (`sk_live_…`) and redeploy.
7. In Stripe → Settings → Emails, turn on **successful payment** receipts for customers and payment notifications for yourself.

If `STRIPE_SECRET_KEY` is missing, the booking form shows a message asking visitors to request a quote instead.

### Changing prices or payment schedules

Edit `catalog.json`. The page and the checkout function both read it, so prices always match. Each
package's `schedule` lists its instalments (`percent` values must add up to 100). Prices are always
recalculated on the server; the browser cannot change them.

### Changing the Terms of Service

Edit `terms.html`, then set `termsVersion` in `catalog.json` to the new date. Each payment records the
version the client accepted (`terms_version` and `terms_accepted_at` in the Stripe payment metadata).
Have the terms reviewed before relying on them.

### Collecting later instalments and other services

- **Later instalments** (e.g. "Before launch"): in Stripe → Invoices, create an invoice for the client's
  email with the amount from the payment's `payment_schedule` metadata and send it. They pay by link.
- **Quoted services** (cybersecurity, IT support, documents, Excel, custom): after the client approves your
  written estimate, send a Stripe invoice the same way (in full under $300, otherwise a 50% deposit).
- **Care plan**: if the payment's `care_plan` metadata says "requested", create a monthly subscription
  for the client in Stripe → Subscriptions starting on the launch date.

## Client portal

Clients sign in at `/portal/` with a one-time link sent to their email (no passwords). They see each
project's stage, a live countdown to the delivery time, their estimate and payments, files and messages.
The admin dashboard at `/portal/admin.html` lists all active projects sorted by deadline, with overdue
and due-soon projects highlighted, and is where projects, estimates, payment requests and updates are managed.

- **Website bookings** made on the homepage become portal projects automatically (via the Stripe webhook),
  with the countdown started from the package's `durationHours` in `catalog.json`.
- **Other services**: create an estimate in the admin dashboard. The client approves it by paying the first
  payment in their portal, which starts the countdown. Default delivery time is 36 hours (editable per project).
- Updates, new files, messages and payment requests can email the client automatically.

### Setup (one time)

1. **Database:** Cloudflare → Storage & Databases → D1 → **Create database** (e.g. `alphatechforge-portal`).
   Then Workers & Pages → your project → Settings → **Bindings** → Add → **D1 database**:
   variable name `DB`, select the database. Tables are created automatically on first use.
2. **File storage:** Cloudflare → **R2** → create a bucket (e.g. `alphatechforge-files`). Then Settings →
   Bindings → Add → **R2 bucket**: variable name `FILES`, select the bucket.
3. **Admin access:** Settings → Variables and Secrets → add `ADMIN_EMAILS` (Text) with the email address(es)
   allowed into the admin dashboard, comma-separated.
4. **Stripe webhook:** Stripe → Developers → **Webhooks** → Add endpoint
   `https://alphatechforge.com/api/stripe-webhook`, events `checkout.session.completed` and
   `checkout.session.async_payment_succeeded`. Copy the **signing secret** (`whsec_…`) and add it in
   Cloudflare as `STRIPE_WEBHOOK_SECRET` (**Secret**).
5. Sign-in emails use the same `RESEND_API_KEY` and `CONTACT_FROM` as the contact form.
6. **Redeploy**, then sign in at `/portal/` with your admin email and open `/portal/admin.html`.

If `DB` is missing the portal shows "The client portal isn't set up yet", and the rest of the site keeps working.
