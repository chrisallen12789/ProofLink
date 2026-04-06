# ProofLink UI CSS Overhaul Plan

This plan turns the repo-wide styling cleanup into an organized multi-agent program instead of one giant CSS patch.

## Goals

- Build one coherent ProofLink visual system across public, operator, admin, and crew surfaces.
- Reduce layout drift caused by inline styles, isolated theme tokens, and one-off component variants.
- Improve responsive behavior with explicit overflow and mobile checks.
- Preserve the repo constraints from `AGENTS.md`: vanilla HTML/CSS/JS only, no frontend framework, no build step.

## Current Architecture Snapshot

### Public and customer-facing pages

- `landing-page.css` and `join-page.css` are the strongest brand-led surfaces.
- `styles.css` is a broad catch-all stylesheet for storefront and legal/support pages.
- `book.css` is a separate aesthetic with its own token feel.
- Several pages still use inline `<style>` blocks:
  - `portal.html`
  - `quote.html`
  - `review.html`
  - `onboarding.html`
  - `start.html`
  - `temp_offline_maint.html`

### Operator

- `operator/operator.css` is the largest styling surface at roughly 5.4k lines.
- It mixes shell, auth, theming, legacy dashboard/workflow patterns, workspace patterns, and mobile behavior.
- Satellite pages still ship their own inline `<style>` systems:
  - `operator/analytics.html`
  - `operator/launch.html`
  - `operator/provisioning.html`
  - `operator/tenants.html`

### Admin and crew

- `admin/admin.css` exists, but `admin/index.html` still carries many inline `style=""` rules.
- `crew/index.html` currently contains its full styling system inline.

## Root Problems

1. ProofLink has multiple mini-design-systems instead of one shared contract.
2. Shared tokens in `assets/brand/prooflink-tokens.css` are underused.
3. Inline `<style>` blocks and inline `style=""` attributes are preventing CSS from being the source of truth.
4. Repeated component names such as `.btn`, `.card`, `.brand`, and `.muted` have different implementations across surfaces.
5. Visual QA exists in pockets, but not as a full cross-surface layout gate.

## Agent Structure

### Foundation agent

Owns shared tokens and primitives.

- Extend `assets/brand/prooflink-tokens.css` into a real semantic token layer.
- Define the baseline rules for:
  - typography
  - spacing
  - surface elevation
  - buttons
  - forms
  - cards
  - status pills
  - nav/footer primitives
- Establish naming rules so shared primitives stop drifting by surface.

### Public marketing agent

Owns:

- `index.html`
- `landing-page.css`
- `join.html`
- `join-page.css`
- `docs/blog/blog.css`
- related marketing content pages

Mission:

- Make acquisition pages feel like one intentional funnel.
- Align typography, spacing rhythm, buttons, and panels with the shared foundation.

### Public storefront/site-pages agent

Owns:

- `styles.css`
- `site-home.html`
- `products.html`
- `order.html`
- `contact.html`
- `about.html`
- `how-it-works.html`
- `privacy.html`
- `terms.html`
- `refunds.html`
- `thanks.html`
- `success.html`
- `cancel.html`

Mission:

- Break `styles.css` into a clear component and page structure over time.
- Remove inline spacing/layout patches from HTML and replace them with shared classes.

### Customer account surfaces agent

Owns:

- `portal.html`
- `quote.html`
- `review.html`
- `onboarding.html`
- `start.html`
- `temp_offline_maint.html`

Mission:

- Extract inline `<style>` systems into dedicated CSS files.
- Bring account/payment/proposal pages into the same visual language as the rest of the product.

### Operator foundation agent

Owns:

- `operator/operator.css`
- `operator/index.html`
- operator shell/theme/mobile structure

Mission:

- Split shell/theme/utilities from workspace-specific styling.
- Reduce light-mode duplication through semantic tokens.
- Normalize sidebar, topbar, panels, and responsive behavior.

### Operator workspace agent

Owns:

- workspace visual migration inside `operator/operator.css`
- `operator/operator-ui-guide.html` as the canonical reference

Mission:

- Move the live UI toward the `workspace-*` system.
- Retire or isolate older `dashboard-*`, `workflow-*`, and generic panel patterns.

### Operator satellite-pages agent

Owns:

- `operator/analytics.html`
- `operator/launch.html`
- `operator/provisioning.html`
- `operator/tenants.html`

Mission:

- Remove inline style islands.
- Either share the operator shell primitives or explicitly define a backoffice sub-system.

### Admin agent

Owns:

- `admin/index.html`
- `admin/admin.css`

Mission:

- Move inline layout/presentation into `admin/admin.css`.
- Normalize table wrappers, bulk bars, filters, modal layouts, and overflow handling.

### Crew agent

Owns:

- `crew/index.html`
- eventual extracted crew stylesheet

Mission:

- Extract the inline style system into a dedicated CSS file.
- Stabilize safe-area behavior, fixed nav spacing, screen transitions, and scroll containers.

### Visual QA agent

Owns layout validation and screenshots across all slices.

- Add or extend Playwright checks for no horizontal overflow.
- Capture baseline screenshots for key pages.
- Run page-specific smoke coverage after each slice lands.

## Recommended Execution Order

1. Build the shared foundation.
2. Establish the visual QA baseline.
3. Clean the public marketing funnel.
4. Clean the public storefront and customer account pages.
5. Refactor operator foundation and mobile behavior.
6. Migrate operator workspace patterns toward the UI guide.
7. Clean operator satellite pages.
8. Clean admin.
9. Clean crew.

This order keeps the shared system ahead of the slice work and avoids repainting the same components repeatedly.

## Verification Gates

### Existing useful tests

- Public:
  - `tests/unit/site/book-html.test.js`
  - `tests/unit/site/order-html.test.js`
  - `tests/unit/site/portal-html.test.js`
  - `tests/unit/site/quote-html.test.js`
  - `tests/e2e/portal-payment-return-smoke.spec.js`
- Operator:
  - `tests/e2e/operator-cross-device-smoke.spec.js`
  - `tests/e2e/operator-authenticated-cross-device.spec.js`
  - `tests/e2e/operator-customer-workspace-cross-device.spec.js`
  - `tests/e2e/operator-workspace-command-centers-cross-device.spec.js`
  - `tests/e2e/operator-ui-guide-cross-device.spec.js`
  - `tests/unit/operator/operator-shell-html.test.js`
  - `tests/unit/operator/operator-mobile-nav-source.test.js`
  - `tests/unit/operator/analytics-html.test.js`
  - `tests/unit/operator/launch-html.test.js`
- Crew:
  - `tests/unit/crew/crew-index-source.test.js`
  - `tests/e2e/crew-hydrovac-handoff-cross-device.spec.js`

### Gaps to close

- Add admin-specific layout smoke coverage.
- Add a reusable screenshot workflow for public pages, not just operator-focused captures.
- Add explicit overflow checks for the public marketing and storefront paths.

## Non-Negotiable Cleanup Rules

- No new inline layout styles.
- New shared components must use the token layer first.
- If a page needs a custom visual treatment, it should still inherit the same spacing, type, and surface language.
- Do not land a CSS slice without a matching verification pass.

## First Implementation Targets

1. Expand `assets/brand/prooflink-tokens.css` into the shared semantic foundation.
2. Extract inline styles from the smallest high-value public pages first:
   - `portal.html`
   - `quote.html`
   - `review.html`
3. Add a baseline layout smoke test for admin and public overflow.
4. Start splitting `operator/operator.css` into logical ownership zones without changing behavior yet.

## Definition Of Done

- Public, operator, admin, and crew all feel like the same product.
- Shared tokens and primitives are the default path, not the exception.
- Inline style islands are removed or deliberately isolated.
- Key pages pass responsive and overflow checks across desktop and mobile widths.
- Future UI work can be assigned by surface without reopening the entire CSS stack.
