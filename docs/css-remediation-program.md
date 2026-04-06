# ProofLink CSS Remediation Program

## Goal

Refactor the UI styling across ProofLink as a coordinated program instead of a one-pass cleanup. The objective is a consistent visual system, stronger layouts across desktop and mobile, fewer inline styles, and repeatable visual verification for every surface.

## Current State

The styling surface is large and fragmented:

- `landing-page.css`: 1,122 lines
- `styles.css`: 1,159 lines
- `join-page.css`: 584 lines
- `book.css`: 491 lines
- `docs/blog/blog.css`: 589 lines
- `operator/operator.css`: 5,443 lines
- `admin/admin.css`: 495 lines
- `crew/index.html`: large inline `<style>` block

There is also meaningful inline CSS outside the primary stylesheets:

- `portal.html`
- `quote.html`
- `onboarding.html`
- `review.html`
- `start.html`
- `temp_offline_maint.html`
- `operator/index.html`
- `operator/launch.html`
- `operator/onboarding.html`
- `operator/provisioning.html`
- `operator/tenants.html`
- `operator/analytics.html`
- `crew/index.html`

Specific maintainability hotspots:

- `admin/index.html` contains dozens of inline `style=""` attributes for spacing, layout, colors, and table controls.
- `operator/index.html` includes an inline tour modal stylesheet near the bottom of the file instead of keeping those rules in `operator/operator.css`.
- `portal.html`, `quote.html`, `onboarding.html`, `start.html`, and `crew/index.html` each define standalone visual systems inline.
- The same design decisions are repeated across files with local naming:
  - accent colors like `#c84b2f`
  - paper/cream backgrounds
  - panel borders and shadows
  - rounded-card patterns
  - button variants
  - muted text rules
- Typography is inconsistent. Some surfaces use Google Sans tokens, some use system stacks, and `quote.html` still uses `Arial, sans-serif`.

## Workstreams

Treat this as five agents with strict ownership boundaries.

### 1. Design System Architect

Owns shared tokens, primitives, and conventions.

Files:

- `assets/brand/prooflink-tokens.css`
- new shared stylesheet(s) under `assets/css/`

Responsibilities:

- Define the canonical color, spacing, radius, shadow, and typography scales.
- Introduce shared layout primitives for stack, cluster, grid, card, panel, button, field, badge, and empty-state patterns.
- Normalize naming so slice agents stop inventing one-off utilities.
- Decide which surfaces share the same foundation and which deserve isolated treatment.

Rules:

- This agent is the only one allowed to change shared tokens/utilities during the initial pass.
- Other agents consume the primitives but do not rename them midstream.

### 2. Public Experience Agent

Owns all public and customer-facing pages.

Files:

- `index.html`
- `landing-page.css`
- `styles.css`
- `join.html`
- `join-page.css`
- `book.html`
- `book.css`
- `site-home.html`
- `products.html`
- `order.html`
- `portal.html`
- `quote.html`
- `contact.html`
- `about.html`
- `how-it-works.html`
- `privacy.html`
- `terms.html`
- `refunds.html`
- `review.html`
- `onboarding.html`
- `start.html`
- `docs/blog/*`

Primary problems to fix:

- `styles.css` mixes storefront, portal, form, and generic marketing concerns into one file.
- Public pages still rely on inline spacing and presentational styles in markup, for example:
  - `site-home.html`
  - `products.html`
  - `order.html`
  - `join.html`
- Several customer pages ship full inline style blocks instead of shared CSS:
  - `portal.html`
  - `quote.html`
  - `onboarding.html`
  - `review.html`
  - `start.html`
- Some pages show mojibake in literal text when inspected from source, which indicates encoding drift that should be checked alongside visual cleanup.

Deliverables:

- Separate marketing shell patterns from storefront/account patterns.
- Remove inline style attributes from public markup where practical.
- Move inline style blocks into owned CSS files or shared public-surface CSS.
- Make mobile behavior intentional on booking, order, quote, portal, and join flows.

### 3. Operator Workbench Agent

Owns the operator dashboard and related operator surfaces.

Files:

- `operator/index.html`
- `operator/operator.css`
- `operator/operator-ui-guide.html`
- `operator/launch.html`
- `operator/onboarding.html`
- `operator/provisioning.html`
- `operator/tenants.html`
- `operator/analytics.html`

Primary problems to fix:

- `operator/operator.css` is the largest styling file in the repo and already contains multiple visual systems inside one sheet.
- `operator/index.html` still contains an inline `<style>` block for the tour modal instead of keeping the shell cohesive.
- The operator shell carries both desktop sidebar logic and mobile-bottom-nav logic, so layout regressions can easily break one mode while fixing the other.
- Theme handling exists, but token usage is not fully centralized. The same card, panel, tab, and button patterns appear in many forms.

Deliverables:

- Extract remaining inline operator styles into `operator/operator.css` or a small operator companion stylesheet.
- Split the stylesheet conceptually by shell, auth, workspace, modal, and mobile-nav zones.
- Tighten responsive behavior around sidebar collapse, panel grids, and long tab/tool labels.
- Keep the operator UI guide page aligned with the real shell so it remains a valid design reference.

### 4. Admin and Crew Agent

Owns platform admin and the crew PWA.

Files:

- `admin/index.html`
- `admin/admin.css`
- `crew/index.html`
- `crew/crew.js`

Primary problems to fix:

- `admin/index.html` has too many inline styles for filters, bars, modal sections, and utility spacing.
- Admin mixes structural classes with ad hoc inline presentation, which makes global restyling expensive.
- `crew/index.html` defines a full mobile visual system inline. That blocks reuse, review, and incremental cleanup.
- Crew is mobile-first and gesture-heavy, so layout regressions will show up as clipped content, hidden actions, or bottom-nav collisions before they show up in source review.

Deliverables:

- Extract admin inline presentation into stable classes in `admin/admin.css`.
- Extract crew inline styles into a dedicated crew stylesheet.
- Normalize admin and crew tokens against the shared design system without forcing them to look identical.
- Protect mobile-safe-area behavior and nav spacing in crew.

### 5. Visual QA Agent

Owns screenshots, layout assertions, and regression gates.

Files and commands:

- `scripts/capture-landing-shots.js`
- `tests/e2e/operator-cross-device-smoke.spec.js`
- `tests/e2e/operator-ui-guide-cross-device.spec.js`
- `tests/e2e/crew-hydrovac-handoff-cross-device.spec.js`
- `tests/e2e/owner-trust-smoke.spec.js`
- `tests/unit/site/*`
- `tests/unit/operator/*`
- `tests/unit/crew/crew-index-source.test.js`

Responsibilities:

- Capture before/after screenshots for each workstream.
- Add or expand overflow assertions on critical pages.
- Add snapshot-style checks only where the HTML is stable enough to support them.
- Keep the layout contract tied to actual surfaces, not just implementation details.

## Execution Order

### Phase 0. Baseline

- Record screenshots for:
  - landing page
  - join flow
  - booking flow
  - order flow
  - portal
  - quote
  - operator login
  - operator dashboard shell
  - operator UI guide
  - admin overview
  - crew home and job detail
- Note visible issues by surface before any refactor starts.

### Phase 1. Shared Foundation

- Design System Architect defines the canonical token layer.
- Shared CSS utilities are added once.
- No broad surface redesign happens until the token layer exists.

### Phase 2. Inline-Style Extraction

- Public Experience Agent extracts public/customer inline blocks.
- Operator Workbench Agent extracts operator inline blocks.
- Admin and Crew Agent extracts admin and crew inline rules.

This phase reduces risk before deeper redesign.

### Phase 3. Layout Repair by Slice

- Public Experience Agent repairs marketing and customer flows.
- Operator Workbench Agent repairs desktop/mobile dashboard behavior.
- Admin and Crew Agent repairs admin tables/forms and crew app screens.

Each slice should land independently.

### Phase 4. Regression Hardening

- Visual QA Agent expands tests for overflow, responsive breakpoints, and screenshot capture.
- High-risk pages get dedicated checks before the program is considered complete.

## Conflict Boundaries

Use these boundaries so multiple agents can work without constant rebasing:

- Design System Architect:
  - shared tokens and utilities only
- Public Experience Agent:
  - root pages, `docs/blog`, public/customer CSS
- Operator Workbench Agent:
  - `operator/` only
- Admin and Crew Agent:
  - `admin/` and `crew/` only
- Visual QA Agent:
  - tests and screenshot scripts only

If a slice agent needs a new shared primitive, it requests it instead of adding a local duplicate.

## Verification Commands

Run these during the program.

Unit and source checks:

```powershell
npx vitest run tests/unit/site tests/unit/operator tests/unit/crew
```

Key cross-device layout checks:

```powershell
npx playwright test tests/e2e/operator-cross-device-smoke.spec.js tests/e2e/operator-ui-guide-cross-device.spec.js tests/e2e/crew-hydrovac-handoff-cross-device.spec.js tests/e2e/owner-trust-smoke.spec.js --config=playwright.config.js
```

Screenshot capture:

```powershell
npm run capture:landing-shots
```

Recommended additions:

- public page overflow tests for `index.html`, `join.html`, `book.html`, `order.html`, `portal.html`, and `quote.html`
- admin shell smoke test covering sidebar, KPI grid, filter controls, and table overflow
- crew viewport checks for bottom-nav collision, safe-area padding, and job-detail actions

## Concrete Risks By Surface

### Public

- Conversion pages and customer account screens are visually inconsistent.
- Inline style blocks make system-wide changes slow and error-prone.
- Shared `styles.css` can accumulate unrelated fixes and become harder to reason about.

### Operator

- Large monolithic stylesheet increases regression risk.
- Desktop and mobile navigation patterns coexist in the same shell.
- Guide pages can drift away from the real product if not maintained together.

### Admin

- Tables, filters, bulk-action bars, and modals are partially styled inline.
- Layout consistency is hard to enforce because presentation is split across markup and CSS.

### Crew

- The inline mobile stylesheet makes the PWA harder to evolve safely.
- Safe-area, nav-height, and fixed-position interactions are fragile.

## How To Ask Codex For This Work

Do not ask for “fix all CSS” in one turn. Ask for one phase or one slice with explicit ownership.

Use prompts like:

- `Run Phase 1 of the CSS remediation program: create the shared design-system foundation and extract reusable primitives without changing page behavior.`
- `Take the Public Experience slice from docs/css-remediation-program.md and refactor the join, booking, order, portal, and quote pages to use shared classes instead of inline styles.`
- `Take the Operator Workbench slice and extract remaining inline styles from /operator/index.html, then clean up responsive layout regressions using the existing operator cross-device tests.`
- `Take the Admin and Crew slice and move inline presentation from /admin/index.html and /crew/index.html into dedicated stylesheets, then add regression checks for layout and overflow.`
- `Act as the Visual QA Agent from docs/css-remediation-program.md and add the highest-value responsive and overflow tests before we continue layout work.`

## Recommended Starting Point

Start with this order:

1. Phase 1 shared design-system foundation
2. Admin and crew inline-style extraction
3. Public customer/account inline-style extraction
4. Operator inline-style extraction
5. Layout refinement by slice
6. Expanded visual regression checks

Reason:

- extracting inline styling first reduces noise
- admin and crew have the clearest maintainability debt
- public/customer pages are the most visible conversion surfaces
- operator is the largest surface and should consume the shared primitives after they settle
