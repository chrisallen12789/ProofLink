"use strict";

function normalizeCompensationType(value) {
  return String(value || "hourly").trim().toLowerCase();
}

function normalizeWorkerLabel(value) {
  return String(value || "").trim();
}

function isoDateOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function isEffectiveOnDate(record, asOfDate) {
  if (!record) return false;
  const asOf = isoDateOnly(asOfDate || new Date().toISOString());
  const start = isoDateOnly(record.effective_start_date || record.starts_on || record.start_date);
  const end = isoDateOnly(record.effective_end_date || record.ends_on || record.end_date);
  if (start && start > asOf) return false;
  if (end && end < asOf) return false;
  return true;
}

function mostRecentRecord(records = []) {
  return [...records].sort((a, b) => {
    const aDate = new Date(a?.effective_start_date || a?.created_at || 0).getTime();
    const bDate = new Date(b?.effective_start_date || b?.created_at || 0).getTime();
    return bDate - aDate;
  })[0] || null;
}

function resolveContractFloorCents({ assignment, ratePeriods = [], classifications = [], asOfDate }) {
  const classificationId = assignment?.union_classification_id || assignment?.labor_classification_id || null;
  if (!classificationId) {
    return { floor_cents: 0, source: null, classification: null, rate_period: null };
  }

  const classification = classifications.find((row) => row.id === classificationId) || null;
  const period = mostRecentRecord(
    ratePeriods.filter((row) => (
      String(row.classification_id || row.union_classification_id || "") === String(classificationId)
      && isEffectiveOnDate(row, asOfDate)
    ))
  );

  return {
    floor_cents: Math.max(0, Number(period?.base_hourly_rate_cents || 0)),
    source: period ? "contract_floor" : null,
    classification,
    rate_period: period,
  };
}

function resolveMemberCompensation({
  member,
  assignments = [],
  overrides = [],
  classifications = [],
  ratePeriods = [],
  asOfDate = new Date().toISOString(),
}) {
  const memberId = String(member?.id || "").trim();
  const activeAssignments = assignments.filter((row) => (
    String(row.member_id || "") === memberId && isEffectiveOnDate(row, asOfDate)
  ));
  const activeOverrides = overrides.filter((row) => (
    String(row.member_id || "") === memberId && isEffectiveOnDate(row, asOfDate)
  ));

  const assignment = mostRecentRecord(activeAssignments);
  const override = mostRecentRecord(activeOverrides);
  const contractFloor = resolveContractFloorCents({
    assignment,
    ratePeriods,
    classifications,
    asOfDate,
  });

  const fallbackHourly = Math.max(0, Number(member?.hourly_rate_cents || 0));
  const assignmentHourly = Math.max(0, Number(
    assignment?.base_hourly_rate_cents
      ?? assignment?.hourly_rate_cents
      ?? 0
  ));
  const overrideHourly = Math.max(0, Number(
    override?.hourly_rate_cents
      ?? override?.base_hourly_rate_cents
      ?? 0
  ));

  const configuredHourly = overrideHourly || assignmentHourly || fallbackHourly;
  const resolvedHourly = Math.max(contractFloor.floor_cents, configuredHourly);
  let source = "member_fallback";
  if (overrideHourly) source = "member_override";
  else if (assignmentHourly) source = "assignment";
  if (resolvedHourly === contractFloor.floor_cents && contractFloor.floor_cents > configuredHourly) {
    source = "contract_floor";
  }

  return {
    compensation_type: normalizeCompensationType(
      override?.compensation_type
        || assignment?.compensation_type
        || (fallbackHourly > 0 ? "hourly" : "")
    ) || "hourly",
    worker_label: normalizeWorkerLabel(
      override?.worker_label
        || assignment?.worker_label
        || member?.role
        || ""
    ),
    driver_label: normalizeWorkerLabel(
      override?.driver_label
        || assignment?.driver_label
        || ""
    ),
    is_union_member: override?.is_union_member ?? assignment?.is_union_member ?? false,
    resolved_hourly_rate_cents: resolvedHourly,
    configured_hourly_rate_cents: configuredHourly,
    contract_floor_cents: contractFloor.floor_cents,
    source,
    assignment_id: assignment?.id || null,
    override_id: override?.id || null,
    union_classification_id: assignment?.union_classification_id || assignment?.labor_classification_id || null,
    union_classification_name: contractFloor.classification?.classification_name || null,
    union_local_name: contractFloor.classification?.union_local_name || null,
    union_local_number: contractFloor.classification?.union_local_number || null,
    trace: {
      fallback_hourly_cents: fallbackHourly,
      assignment_hourly_cents: assignmentHourly,
      override_hourly_cents: overrideHourly,
      contract_floor_cents: contractFloor.floor_cents,
      source,
    },
  };
}

module.exports = {
  isEffectiveOnDate,
  normalizeCompensationType,
  resolveContractFloorCents,
  resolveMemberCompensation,
};
