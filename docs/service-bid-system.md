# Service-First Bid And Walkthrough System

## Why this needs to exist

ProofLink already has the bones of a strong operator system:

- customer records
- orders
- payments
- expenses
- products and pricing

That works for storefront-style businesses, but service operators need a different center of gravity.

For a service business, the main object is not a cart.
It is:

1. a customer
2. a property or service location
3. a walkthrough
4. a bid
5. a scheduled job
6. proof of work
7. payment and follow-up

If we nail that chain, the operator should feel like the system is thinking with them.

## Core product idea

Build a mobile-first `Walkthrough Bid` flow that lets the operator:

1. open a customer or create one on the spot
2. start a new walkthrough from the phone
3. take photos with the camera in real time
4. name each photo and add a note if needed
5. group findings by area, system, or problem
6. build a professional bid from those findings
7. send the bid to the client as a polished proposal
8. convert the approved bid into a job without retyping everything

This should feel like:

- CRM
- field notes
- estimate builder
- proposal software
- job handoff
- proof trail

all in one flow

## The operator experience

### 1. Start walkthrough

Entry points:

- from a customer record
- from a lead intake
- from a property/job record
- from a "New bid" quick action

First fields:

- customer
- service address
- walkthrough type
- service category
- assigned operator
- date/time
- urgency

### 2. Camera-first capture

On mobile, the walkthrough screen should make it stupid easy to document reality.

Each photo should support:

- photo capture from the camera
- upload from camera roll
- photo name
- short note
- category
- area or room
- before / issue / reference / after tag
- sort order
- timestamp

Recommended categories:

- exterior front
- exterior rear
- side access
- room / area
- equipment
- damage
- safety issue
- measurements
- material reference
- completion proof

Implementation note:

The first version can use `input[type="file"]` with `accept="image/*"` and `capture="environment"` for fast mobile capture.
Later we can add a richer in-app camera workflow with annotation and markup.

### 3. Guided walkthrough prompts

The system should not ask every business the same questions.

Instead, it should load prompts based on a `workflow profile`.

Examples:

- Pressure washing: surfaces, square footage, staining severity, water access, chemical sensitivity, ladder risk
- HVAC: equipment type, tonnage, model/serial, accessibility, filter size, observed failure, age, refrigerant concerns
- Plumbing: fixture type, leak source, shutoff access, drain condition, emergency status, permit risk
- Contractor / remodeling: measurements, material selections, scope boundaries, exclusions, permit needs, demo needs
- Property maintenance: unit/room, turnover status, deficiency list, access notes, urgency, tenant or owner approval
- Bakery / food: inventory, made-to-order items, pickup windows, event quantities, ingredient constraints

The goal is to make the right information feel obvious, not buried.

## The bid object

`Bid` should become a first-class record.

Suggested fields:

- id
- tenant_id
- operator_id
- customer_id
- location_id
- status (`draft`, `walkthrough`, `sent`, `viewed`, `approved`, `declined`, `expired`, `converted`)
- title
- scope_summary
- internal_notes
- client_notes
- service_category
- pricing_profile_id
- subtotal_cents
- discount_cents
- tax_cents
- total_cents
- deposit_required_cents
- expiration_date
- delivery_method
- delivery_sent_at
- approved_at
- declined_at
- created_at
- updated_at

Supporting records:

- `bid_photos`
- `bid_line_items`
- `bid_sections`
- `bid_options`
- `bid_measurements`
- `bid_signatures`
- `bid_delivery_events`

## The proposal builder

The operator should be able to assemble a bid that feels like a real professional proposal, not a plain invoice.

Proposal sections:

- cover page
- customer and property info
- problem summary
- scope of work
- option packages (`good / better / best`)
- line-item pricing
- inclusions
- exclusions
- assumptions
- photo board
- schedule window
- warranty / guarantee
- terms and conditions
- deposit and payment schedule
- acceptance signature

Delivery options:

- share link
- email PDF
- text link
- print-ready PDF

Professional touches:

- branded header and logo
- operator headshot or company signature block
- photo captions
- optional badges like `licensed`, `insured`, `warranty included`
- expiration timer
- electronic approval
- deposit CTA

## Convert bid to job

Once approved, the bid should create the downstream work automatically.

What should carry forward:

- customer
- service address
- scope summary
- line items
- photos
- notes
- pricing
- deposit requirement
- material expectations
- assigned operator or crew
- scheduling needs

New job-specific fields:

- scheduled window
- team assignment
- checklist
- materials pulled
- proof of completion
- follow-up due date

## Service inventory is not bakery inventory

ProofLink should stop treating all inventory as the same concept.

### Retail / food inventory

Best for:

- bakery
- food
- packaged goods

Needs:

- stock on hand
- ingredient or item depletion
- reorder points
- waste / spoilage
- batch or production planning

### Service inventory

Best for:

- HVAC
- plumbing
- contractor
- handyman
- pressure washing
- property maintenance

Needs:

- truck stock
- warehouse stock
- special-order materials
- estimated materials on bid
- allocated materials to a job
- actual used amount
- leftover returned to stock
- waste / damaged / overage
- customer-supplied materials

Service inventory should be movement-based, not just quantity-based.

Suggested objects:

- `inventory_items`
- `inventory_locations`
- `inventory_movements`
- `job_material_plans`
- `job_material_usage`

Movement types:

- received
- transferred_to_truck
- allocated_to_job
- used_on_job
- returned_to_stock
- wasted
- customer_supplied

## Vertical-aware capability model

Business type should control which modules are visible by default.

Suggested capability packs:

- `storefront_catalog`
- `custom_orders`
- `walkthrough_bids`
- `field_jobs`
- `rate_sheets`
- `truck_inventory`
- `property_records`
- `client_proposals`
- `appointments`
- `pet_profiles`
- `ingredient_inventory`

### Default profile ideas

`pressure_washing`

- walkthrough_bids
- field_jobs
- rate_sheets
- client_proposals
- completion_photos

`hvac`

- walkthrough_bids
- field_jobs
- rate_sheets
- truck_inventory
- equipment_history
- client_proposals

`plumbing`

- walkthrough_bids
- field_jobs
- rate_sheets
- truck_inventory
- emergency_dispatch

`contractor`

- walkthrough_bids
- option_packages
- client_proposals
- project_jobs
- material_allowances

`property_maintenance`

- property_records
- walkthrough_bids
- recurring_jobs
- deficiency_lists
- unit_turnover_checklists

`bakery`

- storefront_catalog
- custom_orders
- ingredient_inventory
- pickup_windows

`photography`

- appointments
- proposals
- retainers
- deliverables tracking

## Recommended data model additions

Near-term tables:

- `bid_records`
- `bid_photos`
- `bid_line_items`
- `bid_options`
- `job_records`
- `job_addresses`
- `job_material_usage`
- `tenant_workflow_profiles`

Useful JSON or metadata fields:

- custom prompts per vertical
- photo categories
- proposal section toggles
- required approval steps
- signature rules
- deposit rules

## Operator UI additions

New tabs or workspaces:

- `Bids`
- `Jobs`
- `Rate Sheets`
- `Inventory`

Key quick actions:

- `Start walkthrough`
- `Capture photo`
- `Add scope item`
- `Build proposal`
- `Send to client`
- `Convert to job`

## Build sequence

### Phase 1: foundation

- add workflow profiles by business type
- add service-first business types at intake
- create first-class bid records

### Phase 2: walkthrough capture

- mobile walkthrough screen
- camera capture
- photo naming and notes
- area/category tags

### Phase 3: proposal builder

- line items
- options and alternates
- branded proposal output
- send by email/text/link

### Phase 4: approval to execution

- client acceptance
- signature
- deposit
- convert to job

### Phase 5: service inventory and job costing

- material planning
- usage logging
- leftover return
- waste tracking
- job-linked expenses

## What to build next

If we want the highest-value next move, it is:

1. `workflow profiles by business type`
2. `bid_records + bid_photos`
3. `mobile walkthrough capture`
4. `proposal delivery and approval`

That is the shortest path to something operators will use every day and immediately miss if it disappears.
