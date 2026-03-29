# ProofLink Pricing And Unit Economics

Date: March 29, 2026

## Current public software pricing

- Starter: `$49/month`
- Growth: `$149/month`
- Enterprise: `Custom`

## Recommended launch pricing stance

Keep the public software offer simple:

- Starter: `$49/month`
- Growth: `$149/month`
- Enterprise: keep as guided custom until support scope and payment economics are locked down

Recommended packaging:

- Starter: self-serve software
- Growth: self-serve software with optional help path, but not guided setup by default
- Enterprise: custom rollout, custom support, custom controls

That keeps the promise flat-rate without turning setup into a pile of small add-ons.

## Product-contract warning

A launch mismatch existed in the repo:

- Public pricing copy for Growth showed `100 products`, `1,000 customers`, and `500 monthly orders`
- Internal plan comparison and server-side plan enforcement treated Growth core volume as unlimited, with `5 operator seats`

The public pricing copy has been aligned to the internal contract:

- Growth now shows `Unlimited products`, `Unlimited customers`, `Unlimited orders`, `5 operator seats`

## Base platform costs

These are the main recurring platform costs visible in the repo and official vendor pricing:

- Supabase Pro: `$25/month`
- Netlify Pro: `$20/member/month`
- Resend: `$20/month` for the first meaningful paid tier used for launch planning
- Cloudflare Turnstile: treated as effectively `$0` in this launch model

Baseline operating stack for one production team member:

- `$65/month` before SMS, payment-processing, or high-usage overages

## Simple cost formula

Per-customer monthly cost can be modeled as:

`shared infra allocation + subscription processing fee + email usage + sms usage`

Using a 25-customer active base:

- Shared infra allocation: `$65 / 25 = $2.60/customer/month`

## Example unit economics

These examples exclude tenant payment-processing costs from customer-paid jobs and exclude carrier pass-through SMS fees that vary by carrier.

### Starter example

Assumptions:

- 1 active subscription at `$49/month`
- 150 emails/month
- 25 SMS segments/month

Estimated monthly cost:

- Shared infra: `$2.60`
- Stripe fee on the subscription: about `$1.72`
- Email allocation: about `$0.06`
- Twilio transport at roughly `$0.0083` per SMS segment: about `$0.21`

Estimated total:

- `~$4.60/month per Starter customer`

Gross contribution before labor:

- `~$44.40/month`

### Growth example

Assumptions:

- 1 active subscription at `$149/month`
- 750 emails/month
- 100 SMS segments/month

Estimated monthly cost:

- Shared infra: `$2.60`
- Stripe fee on the subscription: about `$4.62`
- Email allocation: about `$0.30`
- Twilio transport: about `$0.83`

Estimated total:

- `~$8.35/month per Growth customer`

Gross contribution before labor:

- `~$140.65/month`

## Payment-economics direction chosen

Business decision recorded for launch:

- Tenant/customer payment economics should be absorbed by the customer account, not by ProofLink platform margin.

That means the software subscription should stay flat-rate, while tenant transaction processing and Connect-related money movement should not silently come out of ProofLink's monthly software fee.

Important implementation note:

- The repo still needs one explicit production rule for how this is enforced in Stripe Connect, because the current code path supports platform fees but the tenant database default for `application_fee_bps` is still `0`.
- I am treating this as a business policy that still needs final technical enforcement, not as something fully guaranteed by the current code.

## Flat-rate recommendation

For launch, keep the message:

- One flat monthly fee for the software
- No extra tolls for quotes, CRM, reminders, or the normal operating workflow

But separate that from payment-processing economics. The software can stay flat-rate while transaction costs remain tied to payment usage.

## Recommended decision set before launch

1. Keep Starter at `$49/month`.
2. Keep Growth at `$149/month`.
3. Keep Enterprise off public self-serve pricing.
4. Keep Growth self-serve by default.
5. Enforce the chosen payment-cost policy technically before promoting online checkout as a flagship benefit.

## Practical cost view after your decisions

If ProofLink does not absorb tenant payment-processing economics, the software-side cost stays very healthy.

Estimated platform-side monthly cost per active customer at a 25-customer base:

- Starter: about `~$4.60`
- Growth: about `~$8.35`

That means approximate software gross contribution before labor is:

- Starter at `$49/month`: about `~$44.40`
- Growth at `$149/month`: about `~$140.65`

Enterprise should stay custom because the real cost driver there will be support time, rollout labor, and custom handling rather than raw infrastructure.
