# ProofLink V1 launch pack integration notes

This pack adds scaffolding for the next real productization phase.

Included:
- plan rules
- plan enforcement middleware
- feature lock UI
- upgrade panel UI
- checklist engine
- analytics widgets
- Stripe readiness indicators
- admin tenant control tower

## Recommended wiring order

1. Wire `platform/plan-check.js` and `platform/plan-middleware.js` into:
   - product create/save
   - customer create
   - order create
   - operator invite
   - payments page
   - analytics page

2. Render `operator/components/feature-lock.js` on locked pages.

3. Render `operator/components/upgrade-panel.js` when a page is partially available but gated.

4. Put `operator/components/checklist-engine.js` on the default operator dashboard.

5. Put `operator/components/stripe-readiness.js` on the payments page.

6. Put `operator/components/analytics-widgets.js` on the operator dashboard and analytics page.

7. Put `admin/tenant-control-tower.js` on the admin dashboard.

## First enforcement targets

- products
- customers
- orders
- operator seats
- online checkout
- advanced analytics
- exports
- domains / custom domain controls
