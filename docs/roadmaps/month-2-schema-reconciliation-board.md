# Month 2 Schema Reconciliation Board

## Goal

Reduce code and SQL drift to intentional, documented, test-backed differences only.

## Workstreams

- [ ] Compare live function assumptions against `sql/` for tenant identity fields
- [ ] Compare recurring workflow code paths against required tables and RPCs
- [ ] Compare onboarding and provisioning assumptions against the current schema scripts
- [ ] Compare service-workflow dependencies against the hosted rollout docs
- [ ] Add schema-readiness handling where workflows still fail generically
- [ ] Move unresolved drift into the schema drift register with owner and next action
