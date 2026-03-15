# ProofLink enforcement pack

This pack is the first pass for real tier enforcement.

Included:
- client-side create/write guards
- limit banner component
- operator seat guard
- server-side Netlify helper for write enforcement

## What to wire first

1. Product create/save flow
   - count current products for tenant
   - block create when Starter limit is reached

2. Customer create flow
   - count current customers for tenant
   - block create when Starter limit is reached

3. Order create flow
   - count active or total orders for tenant
   - block create when Starter limit is reached

4. Operator invite flow
   - count current operator members
   - block invite when seat cap is reached

## Important rule

UI gating is not enough.
These checks must also run inside the Netlify create endpoints.

## Suggested endpoint usage

- create-product
- save-product
- create-customer
- create-order
- invite-operator

## Example server flow

1. Resolve tenant
2. Read tenant plan
3. Count current records
4. Call `enforceLimit`
5. If false, return 403 with `plan_limit_reached`
6. If true, continue write
