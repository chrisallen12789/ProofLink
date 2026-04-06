# ProofLink Layout Cleanup Master Prompt

Use this prompt in the next sandbox.

---

You are working inside the ProofLink repo at `C:\Users\Chris\OneDrive\Desktop\ProofLink`.

Your job is to audit the full layout/CSS architecture and then implement upgrades that make the UI:

1. cleaner to look at
2. easier to maintain
3. easier to extend across operator, crew, admin, and public pages
4. safer across desktop, phone, and Safari/WebKit behavior

This is not a greenfield redesign. Preserve the current product direction, especially the newer command-center pattern in the operator app.

## Product Context

ProofLink is a multi-tenant SaaS for service businesses, with a strong hydrovac workflow. The operator app, crew app, and public pages all need to feel like one intentional system.

Recent work already pushed the operator experience toward a stronger command-center layout:

- customer workspace
- jobs / dispatch / money workspaces
- orders / bids / bookings workflow layer
- hydrovac closeout continuity

Do not flatten this back into generic cards and tables. Keep the current “operating system” feel, then clean up the implementation underneath it.

## Hard Constraints

- Vanilla JS only. No React, Vue, Tailwind, CSS-in-JS, bundlers, or frontend frameworks.
- Keep backend in Netlify functions.
- No database migration as part of this CSS/layout pass unless truly unavoidable.
- Preserve working flows and data contracts.
- Prefer extracting and unifying patterns over inventing new one-off layouts.
- Mobile and desktop both matter.
- Safari/WebKit safety matters. Recent WebKit smoke coverage exists and should not regress.

## Primary Files To Audit

### Operator
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator.css`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator.js`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator-workspace-shell.js`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator-ui-guide.html`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator-customer-detail.js`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator-customers-workspace.js`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator-jobs-workspace.js`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator-dispatch-workspace.js`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator-money-workspace.js`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator-orders-workspace.js`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator-bids-workspace.js`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator-bookings-workspace.js`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\operator\operator-hydrovac-ops-workspace.js`

### Crew
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\crew\index.html`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\crew\crew.js`

### Admin
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\admin\admin.css`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\admin\admin.js`

### Public / Shared
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\assets\brand\prooflink-tokens.css`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\landing-page.css`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\join-page.css`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\book.css`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\styles.css`
- `C:\Users\Chris\OneDrive\Desktop\ProofLink\portal.html`

## Known Architectural Findings

These findings already came out of prior agent exploration. Treat them as starting context:

- `operator.css` is very large and currently mixes tokens, themes, layout primitives, command-center rules, workspace-specific styling, and responsive logic in one file.
- Strong reusable operator primitives already exist and should become the foundation:
  - `workflow-shell*`
  - `record-hero*`
  - `customer-record-shell*`
  - `workspace-focus-card*`
  - `workspace-command-center*`
  - `workspace-board*`
- The operator light-theme override block is a duplication hotspot.
- `admin.css` duplicates shell primitives instead of sharing a foundation with operator.
- `crew/index.html` contains a large embedded style block and still carries maintainability debt even after recent UX fixes.
- `portal.html` still has inline CSS.
- Public pages duplicate tokens, nav, button, shell, and hero patterns across multiple CSS files.

## What Success Looks Like

### Phase 1: Audit and Plan
- Identify the real layout layers in the repo.
- Separate reusable primitives from workspace-specific styling.
- Map duplication hotspots and rank them by value.
- Explain what can be safely unified now versus what should wait.

### Phase 2: Implementation
- Extract or reorganize CSS so the layout system is easier to reason about.
- Reduce inline CSS / embedded CSS where practical.
- Unify shared tokens and structural shells.
- Keep the operator command-center pattern visually strong.
- Improve mobile behavior where layouts are still brittle or overloaded.
- Improve consistency of spacing, typography hierarchy, sticky action behavior, and grid/stack transitions.

### Phase 3: Verification
- Run targeted unit/E2E checks for affected flows.
- Include WebKit/Safari-safe verification where layout or navigation changed.
- Do not stop at code movement only. Verify that the system still behaves correctly.

## Specific Implementation Targets

1. Create a clearer CSS foundation strategy.
   - Shared tokens
   - Shared layout primitives
   - Workspace-level patterns
   - Page/module-specific overrides

2. Make operator the canonical layout system.
   - Use the current command-center direction as the source of truth.
   - Reduce duplicated component styling across operator workspaces.

3. Clean up crew styling architecture.
   - Extract embedded CSS from `crew/index.html` into maintainable stylesheet structure where practical.
   - Keep the crew app fast and resilient.

4. Unify admin and public shells.
   - Reuse shared tokens and shell primitives instead of duplicating them.
   - Preserve each surface’s purpose, but make the design language feel related.

5. Improve responsive behavior intentionally.
   - Desktop should feel like an operational console.
   - Phone should feel focused, obvious, and low-friction.
   - Different layouts for different device classes are acceptable when they improve usability.

## Agent Delegation Guidance

Use multiple agents in the next sandbox.

Recommended split:

1. Operator layout systems agent
   - Owns operator CSS decomposition and command-center primitive cleanup.

2. Crew / portal cleanup agent
   - Owns embedded style extraction, inline-style reduction, and mobile layout cleanup in crew + portal.

3. Public / admin foundation agent
   - Owns shared token adoption and shell/layout unification across public pages and admin.

4. Verification agent
   - Owns regression review, responsive checks, and WebKit/Safari smoke validation after implementation lands.

Keep write scopes distinct so agents do not step on each other.

## Deliverables

At the end of the next sandbox, deliver:

1. the implemented CSS/layout refactor
2. a short explanation of the new layout architecture
3. what files now define shared primitives versus page-specific styles
4. what was verified
5. any residual risks or follow-up work

## Important Notes

- Do not undo the newer operator UX direction.
- Do not replace bold, intentional layout with generic dashboard sludge.
- Keep hydrovac workflows obvious and operationally useful.
- Optimize for maintainability without erasing product character.

When in doubt, choose: clearer structure, less duplication, stronger shared primitives, and safer responsive behavior.
