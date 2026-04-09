'use strict';

const path = require('path');

describe('netlify/functions/utils/compensation', () => {
  const subjectPath = path.resolve(process.cwd(), 'netlify/functions/utils/compensation.js');

  beforeEach(() => {
    vi.resetModules();
    delete require.cache[subjectPath];
  });

  test('enforces the contract floor above a lower configured rate', () => {
    const { resolveMemberCompensation } = require(subjectPath);

    const result = resolveMemberCompensation({
      member: { id: 'member_1', hourly_rate_cents: 3200, role: 'driver' },
      assignments: [{
        id: 'assignment_1',
        member_id: 'member_1',
        compensation_type: 'hourly',
        base_hourly_rate_cents: 3200,
        union_classification_id: 'class_1',
        is_union_member: true,
        effective_start_date: '2026-01-01',
      }],
      classifications: [{
        id: 'class_1',
        union_local_name: 'UA Local 98',
        union_local_number: '98',
        classification_name: 'Metal Trades',
      }],
      ratePeriods: [{
        id: 'period_1',
        classification_id: 'class_1',
        base_hourly_rate_cents: 4100,
        effective_start_date: '2026-01-01',
      }],
      asOfDate: '2026-04-09',
    });

    expect(result.resolved_hourly_rate_cents).toBe(4100);
    expect(result.contract_floor_cents).toBe(4100);
    expect(result.source).toBe('contract_floor');
    expect(result.union_classification_name).toBe('Metal Trades');
  });

  test('allows employee override above the contract floor', () => {
    const { resolveMemberCompensation } = require(subjectPath);

    const result = resolveMemberCompensation({
      member: { id: 'member_1', hourly_rate_cents: 3200, role: 'driver' },
      assignments: [{
        id: 'assignment_1',
        member_id: 'member_1',
        compensation_type: 'hourly',
        base_hourly_rate_cents: 3200,
        union_classification_id: 'class_1',
        is_union_member: true,
        effective_start_date: '2026-01-01',
      }],
      overrides: [{
        id: 'override_1',
        member_id: 'member_1',
        hourly_rate_cents: 4700,
        effective_start_date: '2026-03-01',
      }],
      classifications: [{
        id: 'class_1',
        union_local_name: 'UA Local 98',
        union_local_number: '98',
        classification_name: 'Metal Trades',
      }],
      ratePeriods: [{
        id: 'period_1',
        classification_id: 'class_1',
        base_hourly_rate_cents: 4100,
        effective_start_date: '2026-01-01',
      }],
      asOfDate: '2026-04-09',
    });

    expect(result.resolved_hourly_rate_cents).toBe(4700);
    expect(result.contract_floor_cents).toBe(4100);
    expect(result.source).toBe('member_override');
  });
});
