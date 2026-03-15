# ProofLink billing and upgrade pack

This pack gives locked features and capped writes somewhere real to lead.

Included:
- billing page scaffold
- billing status card
- upgrade CTA block
- plan comparison table
- upgrade modal
- upgrade-path helpers
- Stripe billing session scaffold

## Wire this first

1. Add `operator/billing.html` to navigation.
2. Load `assets/css/subscription.upgrades.css` wherever upgrade UI is used.
3. Replace placeholder upgrade links with a POST to:
   `/.netlify/functions/create-billing-upgrade-session`
4. Redirect user to Stripe checkout / billing portal once implemented.
5. After Stripe success webhook, update:
   - `tenants.prooflink_plan_key`
   - `tenants.billing_status`

## Best usage pattern

Locked feature -> upgrade modal -> billing page -> real Stripe session -> webhook updates tenant -> feature unlocks automatically
