# AlphaTechForge

Official website for AlphaTechForge — https://alphatechforge.com

A single-page static site (`index.html`) hosted on Cloudflare Pages, with a serverless
contact form handler at `functions/api/contact.js`.

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | The entire site: markup, styles and script |
| `functions/api/contact.js` | Cloudflare Pages Function that receives the inquiry form and emails it via Resend |
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
