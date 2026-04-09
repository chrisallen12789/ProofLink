# Local 98 Compensation Extraction Notes

This is the current implementation note for driving ProofLink's union-based compensation model.

## Scope

This document captures only the compensation-relevant rules we need for product design and schema planning.

## Verified public context

- The union hall location matches the local the team identified.
- A public older agreement was discoverable for the Detroit-area Local 98 pipefitter/plumber context.
- A later 2025 ratification notice strongly suggests a newer agreement exists, but the complete successor contract was not publicly available in the repo work session.

## Business rule from operations

The operator clarified the live business rule for ProofLink:

- pay structure follows the union agreement
- there are no exceptions below the agreement
- the only flexibility is pay above minimum and how drivers are labeled
- drivers are often labeled as `metal trades`
- driver labels may differ when insurance coverage requires a different classification label

That rule is now reflected in the compensation foundation design.

## Product translation

The system must treat union logic this way:

1. The union classification sets the floor.
2. Driver or worker labels can change without erasing the floor.
3. Employee-specific pay can exceed the floor.
4. Historical changes must be effective-dated.
5. Job costing must be able to explain the difference between floor pay and actual configured pay.

## Fields the model must support

- union local number
- contract name
- contract effective dates
- classification name
- worker label
- driver label
- driver class flag
- base hourly floor
- foreman and general foreman premiums
- shift differential
- travel pay
- standby pay
- per diem
- hazard premium
- overtime multiplier
- double-time multiplier
- holiday multiplier
- fringe package

## Open contract-input requirement

To finish the real production rate cards, we still need the current signed agreement or current wage sheet for the active Local 98 terms.

Until that is uploaded and normalized:

- the foundation is ready
- the enforcement model is ready
- the exact live rate rows still need current contract data

## Recommended operator setup sequence

1. Create the active labor contract record.
2. Create classifications for each covered worker/driver type.
3. Add rate periods with effective dates from the current agreement.
4. Assign each team member to the right classification.
5. Apply above-scale employee overrides only where intended.
6. Review Team hours against contract floor output before building payroll export logic.
