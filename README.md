# ProofLink

**Multi-tenant SaaS platform for service and trade businesses.**

ProofLink gives field service operators a unified storefront, order management system, customer CRM, job documentation tools, and Stripe-powered payments — all under one roof. Each business gets their own isolated tenant environment with a public storefront and a private operator dashboard.

---

## What it does

- **Storefront** — Public-facing product/service catalog with cart, checkout, and order submission
- **Operator Dashboard** — Full back-office for managing products, orders, customers, expenses, and availability
- **CRM** — Customer records with lifetime value tracking and a timestamped interaction log per customer
- **Job Documentation** — Per-job note logging, before/after records, and proof trails via the interaction system
- **Stripe Payments** — Platform billing (subscriptions) + tenant customer payments via Stripe Connect Express
- **Onboarding Pipeline** — Automated rule-engine evaluation, admin approval, and full tenant provisioning
- **Admin Panel** — Platform-level oversight of tenants, onboarding requests, billing, and conduct

---

## Tech stack

| Layer | Technology |
|---|---|
| Hosting & functions | Netlify (serverless) |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth |
| Payments | Stripe (Subscriptions + Connect Express) |
| Email | Resend |
| Spam protection | Cloudflare Turnstile + honeypot + timing gates |

---

## Repository structure

```
/admin              Platform admin panel (HTML + JS)
/operator           Tenant operator dashboard (HTML + JS)
/public             Public storefront pages
/netlify/functions  All serverless backend functions
/sql                Database migrations (see sql/README.md)
/assets             Static assets
```

---

## Environment variables

Copy `.env.example` and set all values in your Netlify dashboard under **Site → Environment variables**.

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_CONNECT_WEBHOOK_SECRET
STRIPE_PRICE_STARTER_MONTHLY
STRIPE_PRICE_GROWTH_MONTHLY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
RESEND_API_KEY
FROM_EMAIL
SITE_URL
INTERNAL_SECRET
MAX_TESTER_SLOTS         (default: 3)
OPERATOR_ALERT_EMAIL
TURNSTILE_SECRET_KEY     (optional — enables Cloudflare Turnstile on forms)
```

---

## Database setup

Run `sql/CATCHUP_RUN_THIS.sql` in your Supabase SQL editor. This is the single source of truth for the full schema. Safe to run on a fresh project — every statement uses `IF NOT EXISTS`.

See `sql/README.md` for full details.

---

## Spam protection

All public forms use a layered anti-spam stack:

- **Honeypot field** (`fax`) — bots fill it, humans don't
- **Time-to-submit trap** (`startedAt`) — submissions too fast or too slow are rejected
- **Cloudflare Turnstile** — optional CAPTCHA replacement

To enable Turnstile:
1. Create a Turnstile widget at dash.cloudflare.com and copy the site key and secret key
2. Replace `YOUR_TURNSTILE_SITE_KEY` in `contact.html` and `order.html`
3. Set `TURNSTILE_SECRET_KEY` in your Netlify environment variables

Timing gate defaults (tunable via env vars):
- `MIN_SUBMIT_MS` — default `2500`
- `MAX_SUBMIT_MS` — default `3600000`

---

## Stripe webhook setup

Point two webhook endpoints in your Stripe dashboard to:

```
/.netlify/functions/stripe-webhook
```

One for platform events (subscriptions, checkout), one for Connect account events. Set the respective signing secrets as `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`.

---

## Deployment

1. Fork or clone this repo
2. Connect to Netlify and set all environment variables
3. Run `sql/CATCHUP_RUN_THIS.sql` in Supabase
4. Configure Stripe webhook endpoints
5. Deploy

---

## License

Private — all rights reserved.
