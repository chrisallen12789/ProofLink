# ProofLink V1 integration notes

This package wires the first real productization layer into the existing repo.

Included in this pass:
- plan rules and plan checks attached to `window`
- operator payment readiness component
- operator feature-lock and upgrade panels
- admin tenant control tower renderer
- fixed walkthrough login detection for Supabase-backed operator sessions

What is integrated now:
- `operator/payments.html`
- `admin` tenant section summary block
- `operator/walkthrough.js`

What still needs manual wiring next:
- product/customer/order create limits
- dashboard analytics cards inside operator shell
- upgrade prompts on locked operator tabs
- checklist engine mounted into first-session dashboard flow
