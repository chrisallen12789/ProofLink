# HonestToCrust
Webpage for my wife's E-Bakery


## Spam protection (recommended)

This site uses a low-friction anti-spam stack:
- Honeypot field (`fax`)
- Time-to-submit trap (`startedAt`)
- Optional Cloudflare Turnstile (best practice)

To enable Turnstile:
1) Create a Turnstile widget in Cloudflare and copy the site key + secret key.
2) In `contact.html` and `order.html`, replace `YOUR_TURNSTILE_SITE_KEY` with your site key.
3) In Netlify environment variables, set:
   - `TURNSTILE_SECRET_KEY` = your Turnstile secret key

You can tune timing gates (optional):
- `MIN_SUBMIT_MS` (default 2500)
- `MAX_SUBMIT_MS` (default 3600000)
