# ProofLink Workspace Architecture Map

This is the product rulebook for making ProofLink flexible and specific at the same time.

The system should not become a different app for every business. It should stay one operating backbone with profile-aware overlays and tier-aware depth.

## North Star

ProofLink should feel like:

- one backbone for every business
- one profile that changes the language, defaults, and workflow shape
- one tier that changes depth and control, not the business identity

That means a bakery, pressure washing company, HVAC shop, and property maintenance crew all use the same core record types, but they do not see the same emphasis, defaults, or workflow prompts.

## Layer Model

### 1. Core operating system

Every business can eventually rely on the same backbone:

- `CRM`
- `Leads / intake`
- `Bids / proposals`
- `Orders / jobs`
- `Payments`
- `Expenses / job costs`
- `Inventory / materials`
- `Scheduling / availability`
- `Proof / documents / photos`
- `Reporting / guidance`
- `Automation / integrations`

### 2. Business profile overlay

The business profile decides:

- which modules are priority-first
- which modules are hidden by default
- the pricing model
- the inventory model
- the proof model
- the suggested bid / job workflow
- the default language and prompts

Examples:

- `Bakery / Food`
  - priority: orders, products, inventory, payments
  - hidden by default: walkthrough bids
  - inventory model: ingredients, prep, finished goods

- `Pressure Washing`
  - priority: walkthrough bids, jobs, proof, expenses, payments
  - inventory model: truck stock, chemicals, overage return
  - proof model: walkthrough photos, before/after, scope justification

- `HVAC`
  - priority: bids, jobs, parts, payments
  - inventory model: truck stock, ordered parts, warranty returns
  - proof model: equipment findings, model details, diagnostics, completion proof

### 3. Tier overlay

The tier should change sophistication, not identity.

#### Starter

Goal:

- give a clean operating system fast
- fix memory problems
- stop customer/order/payment chaos

Unlocks:

- guided onboarding
- CRM
- orders
- scheduling
- expenses
- manual payments
- basic inventory/material tracking
- basic reporting

#### Growth

Goal:

- support a busier operator or team
- standardize selling and fulfillment
- add visibility before chaos compounds

Unlocks:

- everything in Starter
- walkthrough bids
- photo proof
- hosted checkout
- rate-sheet foundations
- stronger reporting
- multi-operator depth

#### Enterprise

Goal:

- control complexity across larger teams or locations
- preserve accountability as workflows multiply
- fit into a broader operating stack

Unlocks:

- everything in Growth
- custom fields
- advanced material tracking
- approvals
- audit log
- multi-location support
- API / integration controls
- white-glove rollout

## What “Flexible and Specific” Actually Means

Do this:

- keep the same core records across the product
- let the profile decide the workflow emphasis
- let the tier decide how advanced the workflow can become
- let custom fields cover edge cases without rewriting the app

Do not do this:

- build a separate product for each business type
- make tiers behave like different business models
- push every advanced feature into every workspace by default
- let niche needs break the shared backbone

## Workspace Blueprint Examples

### Bakery on Starter

Show first:

- orders
- products
- inventory
- payments

Hide or downplay:

- walkthrough bids
- photo-proof-heavy job workflows

Why:

- the bakery needs catalog, prep, pickup, and stock discipline before it needs field proposals

### Pressure Washing on Growth

Show first:

- walkthrough bids
- jobs
- proof photos
- payments
- expenses

Hide or downplay:

- heavy storefront product management

Why:

- the sale starts with a site visit, not a product shelf

### Contractor on Enterprise

Show first:

- bids
- job records
- costs
- materials
- approvals

Hide or downplay:

- lightweight retail assumptions

Why:

- the real risk is hidden conditions, scope drift, change control, and margin leakage

## Rules for Future Build Decisions

1. Every new feature must answer: is this core, profile-specific, or tier-specific?
2. If it is profile-specific, build it as an overlay on the shared backbone.
3. If it is tier-specific, unlock depth, limits, or control instead of changing the business model.
4. If only some businesses need a field, use custom fields or profile-required fields before inventing a new top-level system.
5. The operator should always get a teach-through default path, even when advanced options exist.

## Current Source of Truth

The shared architecture scaffold now lives in:

- [prooflink-workspace-architecture.js](/C:/Users/Chris/ProofLink/prooflink-workspace-architecture.js)

That file defines:

- tier capabilities
- business profiles
- feature gates
- bid-profile resolution
- workspace blueprint resolution

## Next Implementation Move

Use the shared architecture file to drive:

1. plan-aware operator navigation
2. profile-aware onboarding defaults
3. business-type-specific field requirements
4. module visibility and upsell states
5. future job, expense, and inventory workflows
