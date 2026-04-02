# Proposal Document Engine Architecture

## Audit summary

ProofLink already has three important proposal-adjacent pieces in place:

1. `bids` is the current service-workflow proposal record.
   It already stores customer linkage, scope text, commercial terms, pricing totals, photos, send state, and order conversion state.
2. `quote.html` plus `netlify/functions/get-quote.js` is the current public estimate/proposal surface.
   It reads from `bids`, supports public acceptance, and feeds the customer portal.
3. Tenant branding and team identity already exist in adjacent systems.
   `tenant_config.site_settings` stores editable brand values like `logo_url`, `accent_color`, public email, and public phone.
   `operator_members` stores the tenant team roster and `user_id`, which gives us a durable sender selector base.

The current system is useful, but it mixes three concerns together:

- operational bid drafting
- internal pricing structure
- customer-facing document rendering

That makes it hard to support formal document templates, sender fallbacks, immutable revisions, and multi-option customer proposals without overloading the `bids` row.

## Integration direction

The proposal document engine should layer under the existing bid workflow instead of replacing it outright.

- Keep `bids` as the operational workflow shell.
  It already powers customer linkage, service-pipeline visibility, and bid-to-order conversion.
- Add document-engine tables beside it for customer-facing output, branding defaults, reusable legal text, and immutable versions.
- Link each customer-facing proposal document back to its originating `bid_id` when the proposal came from the walkthrough workflow.
- Keep public `quote.html` and `get-quote.js` as the stable customer route, but upgrade them to prefer the new proposal document data when a linked document exists.
- Keep browser HTML as the rendering source of truth.
  PDF/export should use the same HTML and print CSS rather than inventing a separate PDF layout system.

## Proposed model split

- `bids`
  Operational workflow, internal notes, estimate-like pricing inputs, conversion to booked work.
- `proposal_documents`
  Current customer-facing document head record tied to a bid, customer, and sender.
- `proposal_document_versions`
  Immutable revision snapshots with stored render state and HTML snapshot.
- `proposal_options`
  Customer-facing scoped options with their own titles, bullets, and prices.
- `document_templates` and `document_template_versions`
  Controlled layout families and versioned layout metadata.
- `tenant_branding_profiles`
  Proposal-specific tenant defaults and brand identity, with fallback to existing `tenant_config.site_settings` and `tenants`.
- `user_document_profiles`
  Sender-specific signature identity per tenant user.
- `reusable_terms_templates` and `reusable_exclusions_templates`
  Tenant or system-managed legal/default text blocks.

## Rendering approach

Use one shared renderer module for both browser preview and public document rendering.

- Shared module:
  `shared/proposal-document-engine.js`
- Responsibilities:
  normalize tenant branding
  normalize sender identity
  apply fallback chains
  build consistent view models
  render the standard operational template
  render the formal vendor/compliance template
  output print-safe full-page HTML

The templates stay controlled by layout keys.
End users edit only defined content regions and option records.

## Compatibility rules

- Existing bid save and convert flows stay intact.
- Existing public quote links keep working.
- If a bid has no linked proposal document yet, public rendering falls back to a legacy bid-to-document mapping.
- Existing setup branding remains valid input through fallback logic.
- Existing team records remain the basis for prepared-by and send-as selection.

## Minimum implementation sequence

1. Add additive SQL in a new standalone migration file instead of widening `catchup_run_this.sql`.
2. Create the shared renderer and test it in isolation.
3. Extend the operator bid workspace with:
   template selection
   prepared-by / send-as
   proposal options
   terms/exclusions selectors
   live preview
   brand setup status
4. Persist proposal documents and version snapshots alongside bids.
5. Upgrade public proposal rendering and acceptance to use the new document engine.
6. Preserve order conversion compatibility by continuing to use `bids` as the workflow anchor.
