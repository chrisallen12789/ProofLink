// Team roster and hours workflows extracted from operator.js
// so crew management is isolated from the main shell.
async function getTeamWorkspaceAuthHeaders(extraHeaders = {}) {
  if (typeof authHeaders === "function") {
    return { ...authHeaders(), ...extraHeaders };
  }
  const token = await getOperatorAccessToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };
}

async function fetchTeamMembers() {
  const response = await fetch("/.netlify/functions/manage-operator-members", {
    headers: await getTeamWorkspaceAuthHeaders(),
  });
  const data = await response.json().catch(() => ({}));
  TEAM_MEMBERS_CACHE = data.members || [];
  renderTeamPanel();
}

function teamWorkspaceJobs() {
  const jobs = typeof JOBS_CACHE !== "undefined" ? JOBS_CACHE : [];
  return Array.isArray(jobs) ? jobs : [];
}

function teamMemberAssignmentKeys(member = {}) {
  return [
    member?.id,
    member?.user_id,
    member?.operator_id,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function teamJobEstimatedMinutes(job = {}) {
  const billableHours = Number(job?.billable_hours || 0);
  const minimumHours = Number(job?.minimum_hours || 0);
  const travelHours = Number(job?.travel_hours || 0);
  const workingHours = billableHours > 0 ? billableHours : Math.max(minimumHours, 0);
  return Math.max(0, Math.round((workingHours + Math.max(travelHours, 0)) * 60));
}

function teamMinutesLabel(totalMinutes = 0) {
  const minutes = Math.max(0, Number(totalMinutes || 0));
  const hours = minutes / 60;
  return `${Number(hours.toFixed(hours >= 10 ? 0 : 1))}h`;
}

function teamDateLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "").trim();
  return date.toLocaleDateString();
}

function teamMemberDisplayedRateCents(member = {}) {
  return Number(
    member?.effective_rate_cents
      || member?.compensation?.resolved_hourly_rate_cents
      || member?.hourly_rate_cents
      || 0
  );
}

function teamMemberCompensationNote(member = {}) {
  const compensation = member?.compensation || {};
  const floor = Number(compensation.contract_floor_cents || 0);
  const classification = String(compensation.union_classification_name || "").trim();
  const driverLabel = String(compensation.driver_label || "").trim();
  const source = String(compensation.source || "").trim();

  if (source === "contract_floor" && floor) {
    return `${classification || "Union floor"} minimum is driving this rate.`;
  }
  if (source === "member_override" && floor) {
    return `${classification || "Union floor"} minimum is ${formatUsd(floor)}/hr; member is above scale.`;
  }
  if (driverLabel && floor) {
    return `${driverLabel} label with ${formatUsd(floor)}/hr contract floor.`;
  }
  if (classification && floor) {
    return `${classification} floor tracked at ${formatUsd(floor)}/hr.`;
  }
  return "";
}

function teamMemberCompensationTimelineEntry(member = {}) {
  const rateCents = teamMemberDisplayedRateCents(member);
  if (!rateCents) return null;

  const compensation = member?.compensation || {};
  const effectiveAt = String(
    compensation.effective_at
      || compensation.updated_at
      || member?.effective_rate_updated_at
      || member?.updated_at
      || ""
  ).trim();
  if (!effectiveAt) return null;

  const floorCents = Number(compensation.contract_floor_cents || 0);
  const classification = String(compensation.union_classification_name || "").trim();
  const source = String(compensation.source || "").trim();
  const noteParts = [
    `Rate ${formatUsd(rateCents)}/hr`,
    teamMemberCompensationNote(member),
  ].filter(Boolean);

  if (!noteParts.length) return null;

  return {
    sortAt: effectiveAt,
    tone: source === "contract_floor" ? "pill-warn" : "pill-good",
    label: "Compensation",
    title: classification ? `${classification} pay context` : "Compensation updated",
    note: noteParts.join(" | ") + (floorCents && !teamMemberCompensationNote(member)
      ? ` | Contract floor ${formatUsd(floorCents)}/hr`
      : ""),
  };
}

function teamQualificationTimelineEntries(member = {}) {
  const qualification = teamMemberDriverQualification(member);
  if (!qualification) return [];

  const entries = [];
  const pushEntry = (sortAt, title, note, tone = 'pill') => {
    if (!sortAt || !title) return;
    entries.push({
      sortAt,
      tone,
      label: 'Qualification update',
      title,
      note: note || 'Employee qualification record updated.',
    });
  };

  if (qualification?.hos_last_synced_at) {
    pushEntry(
      qualification.hos_last_synced_at,
      'Driver hours sync',
      qualification?.hos_available_driving_minutes != null
        ? `HOS available ${teamMinutesLabel(qualification.hos_available_driving_minutes || 0)}`
        : 'Driver hours-of-service record refreshed.'
    );
  }
  if (qualification?.first_aid_certified && qualification?.first_aid_cert_expiry_date) {
    pushEntry(
      qualification.first_aid_cert_expiry_date,
      'First aid current',
      `Current through ${teamDateLabel(qualification.first_aid_cert_expiry_date)}`
    );
  }
  if (qualification?.confined_space_certified && qualification?.confined_space_cert_expiry_date) {
    pushEntry(
      qualification.confined_space_cert_expiry_date,
      'Confined space current',
      `Current through ${teamDateLabel(qualification.confined_space_cert_expiry_date)}`
    );
  }
  if (qualification?.h2s_alive_certified && qualification?.h2s_cert_expiry_date) {
    pushEntry(
      qualification.h2s_cert_expiry_date,
      'H2S current',
      `Current through ${teamDateLabel(qualification.h2s_cert_expiry_date)}`
    );
  }

  return entries;
}

function teamMemberDriverQualification(member = {}) {
  const rows = typeof HYDROVAC_DRIVER_COMPLIANCE_CACHE !== "undefined" && Array.isArray(HYDROVAC_DRIVER_COMPLIANCE_CACHE)
    ? HYDROVAC_DRIVER_COMPLIANCE_CACHE
    : [];
  return rows.find((row) => String(row?.member_id || "").trim() === String(member?.id || "").trim()) || null;
}

function teamMemberRolloutTrack(member = {}) {
  const hasDriverLabel = !!String(member?.driver_label || "").trim();
  const hasWorkerLabel = !!String(member?.worker_label || "").trim();
  if (hasDriverLabel && hasWorkerLabel) {
    return {
      key: "mixed",
      label: "Mixed role",
      note: "This worker can cover both driver and labor responsibilities.",
    };
  }
  if (hasDriverLabel) {
    return {
      key: "driver",
      label: "Driver track",
      note: "This worker is expected to drive, handle vactor responsibilities, or both.",
    };
  }
  if (hasWorkerLabel) {
    return {
      key: "labor",
      label: "Labor track",
      note: "This worker is being rolled out for field labor and site support work.",
    };
  }
  return {
    key: "crew",
    label: "Crew track",
    note: "This worker still needs a clearer role label before rollout is fully dialed in.",
  };
}

function teamDaysUntil(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((timestamp - startOfToday) / 86400000);
}

function teamQualificationRefreshPressure(member = {}) {
  const track = teamMemberRolloutTrack(member);
  const qualification = teamMemberDriverQualification(member);
  const driverTrack = track.key === "driver" || track.key === "mixed";
  if (!driverTrack || !qualification) {
    return {
      label: "No refresh pressure",
      tone: "pill-good",
      note: driverTrack ? "Driver qualification refresh tracking will appear once the qualification record is in place." : "This track does not need driver qualification refresh tracking right now.",
      needsAttention: false,
      blocked: false,
      items: [],
    };
  }

  const checks = [
    { key: "cdl", label: "CDL", date: qualification?.cdl_expiry_date, staleDays: null },
    { key: "med_card", label: "Med card", date: qualification?.medical_certificate_expiry, staleDays: null },
    { key: "first_aid", label: "First aid", date: qualification?.first_aid_cert_expiry_date, staleDays: null },
    { key: "confined_space", label: "Confined space", date: qualification?.confined_space_cert_expiry_date, staleDays: null },
    { key: "h2s", label: "H2S", date: qualification?.h2s_cert_expiry_date, staleDays: null },
    { key: "mvr", label: "MVR review", date: qualification?.last_mvr_check_date, staleDays: 180 },
  ];

  const items = checks.flatMap((check) => {
    const daysUntil = teamDaysUntil(check.date);
    if (daysUntil == null) return [];
    if (check.staleDays != null) {
      if (daysUntil <= -365) {
        return [{
          key: check.key,
          label: check.label,
          severity: "expired",
          note: `${check.label} is more than a year old.`,
          daysUntil,
        }];
      }
      if (daysUntil <= -check.staleDays) {
        return [{
          key: check.key,
          label: check.label,
          severity: "soon",
          note: `${check.label} should be refreshed soon.`,
          daysUntil,
        }];
      }
      return [];
    }
    if (daysUntil < 0) {
      return [{
        key: check.key,
        label: check.label,
        severity: "expired",
        note: `${check.label} expired ${teamDateLabel(check.date)}.`,
        daysUntil,
      }];
    }
    if (daysUntil <= 30) {
      return [{
        key: check.key,
        label: check.label,
        severity: "soon",
        note: `${check.label} is due by ${teamDateLabel(check.date)}.`,
        daysUntil,
      }];
    }
    return [];
  });

  const expiredItems = items.filter((item) => item.severity === "expired");
  const soonItems = items.filter((item) => item.severity === "soon");
  if (expiredItems.length) {
    return {
      label: "Qualification refresh overdue",
      tone: "pill-bad",
      note: expiredItems[0]?.note || "One or more driver qualifications have expired.",
      needsAttention: true,
      blocked: true,
      items,
    };
  }
  if (soonItems.length) {
    return {
      label: "Refresh due soon",
      tone: "pill-warn",
      note: soonItems[0]?.note || "A driver qualification is coming due soon.",
      needsAttention: true,
      blocked: false,
      items,
    };
  }
  return {
    label: "No refresh pressure",
    tone: "pill-good",
    note: "Current qualification dates are not showing near-term refresh pressure.",
    needsAttention: false,
    blocked: false,
    items: [],
  };
}

function teamMemberDriverReadiness(member = {}) {
  const track = teamMemberRolloutTrack(member);
  const qualification = teamMemberDriverQualification(member);
  const warnings = Array.isArray(qualification?.warnings) ? qualification.warnings : [];
  const criticalWarnings = warnings.filter((warning) => ["critical", "expired"].includes(String(warning?.severity || "").toLowerCase()));
  const warningCount = warnings.length;
  const isDriverTrack = track.key === "driver" || track.key === "mixed";
  if (isDriverTrack && !qualification) {
    return {
      label: "Driver setup needed",
      tone: "pill-warn",
      note: "CDL, med card, HOS, and safety notes still need a qualification record.",
      needsAttention: true,
    };
  }
  if (criticalWarnings.length) {
    return {
      label: "Driver record blocked",
      tone: "pill-bad",
      note: `${criticalWarnings.length} critical driver compliance item${criticalWarnings.length === 1 ? "" : "s"} need attention before rollout.`,
      needsAttention: true,
    };
  }
  if (warningCount) {
    return {
      label: "Driver follow-up",
      tone: "pill-warn",
      note: `${warningCount} driver qualification warning${warningCount === 1 ? "" : "s"} still need follow-up.`,
      needsAttention: true,
    };
  }
  if (qualification && isDriverTrack) {
    return {
      label: "Driver-ready",
      tone: "pill-good",
      note: "Driver qualification record is in place with no active expiry pressure.",
      needsAttention: false,
    };
  }
  return {
    label: "Crew setup",
    tone: "pill",
    note: "Crew member is ready for assignment details, training, and job handoff.",
    needsAttention: false,
  };
}

function teamTrainingProfiles() {
  const setupState = typeof SETUP_STATE !== "undefined" ? SETUP_STATE : {};
  const profiles = setupState?.config?.team_training_profiles;
  return profiles && typeof profiles === "object" && !Array.isArray(profiles) ? profiles : {};
}

function teamTrainingTemplate(member = {}) {
  const track = teamMemberRolloutTrack(member);
  if (track.key === "driver") {
    return [
      { key: "crew_app", label: "Crew app sign-in", note: "They can sign in, open the job, and see office handoff notes." },
      { key: "yard_route", label: "Yard and route review", note: "Truck location, keys, fueling, dump workflow, and dispatch expectations reviewed." },
      { key: "driving", label: "Driving orientation", note: "Road rules, backing expectations, spotter use, and incident reporting reviewed." },
      { key: "worksite", label: "Worksite safety", note: "Traffic control, utility exposure, exclusion zones, PPE, and stop-work expectations reviewed." },
      { key: "vactor", label: "Vactor operator walkthrough", note: "Controls, startup/shutdown, boom use, spoil handling, and daily checks reviewed." },
      { key: "ride_along", label: "Ride-along signoff", note: "A supervised field run or shadow day has been completed." },
    ];
  }
  if (track.key === "mixed") {
    return [
      { key: "crew_app", label: "Crew app sign-in", note: "They can sign in, open the job, and see office handoff notes." },
      { key: "yard_route", label: "Yard and route review", note: "Truck location, crew meet-up, fueling, dump workflow, and dispatch expectations reviewed." },
      { key: "driving", label: "Driving orientation", note: "Road rules, backing expectations, spotter use, and incident reporting reviewed." },
      { key: "ppe", label: "PPE and site safety", note: "Required PPE, hazard awareness, stop-work expectations, and customer-site conduct reviewed." },
      { key: "worksite", label: "Driver and labor worksite flow", note: "Traffic control, hose handling, spotting, spoil setup, and excavation awareness reviewed." },
      { key: "vactor", label: "Vactor operator walkthrough", note: "Controls, startup/shutdown, boom use, spoil handling, and daily checks reviewed." },
      { key: "handoff", label: "Photo and closeout handoff", note: "Photos, notes, blocker reporting, and completion expectations reviewed." },
      { key: "ride_along", label: "Ride-along signoff", note: "A supervised field run or shadow day has been completed." },
    ];
  }
  return [
    { key: "crew_app", label: "Crew app sign-in", note: "They can sign in, open the job, and see office handoff notes." },
    { key: "yard_route", label: "Crew day flow", note: "Reporting time, truck meet-up, dispatch expectations, and closeout flow reviewed." },
    { key: "ppe", label: "PPE and site safety", note: "Required PPE, hazard awareness, stop-work expectations, and customer-site conduct reviewed." },
    { key: "worksite", label: "Worksite labor orientation", note: "Spotting, hose handling, spoil setup, excavation awareness, and cleanup workflow reviewed." },
    { key: "handoff", label: "Photo and closeout handoff", note: "Photos, notes, blocker reporting, and completion expectations reviewed." },
    { key: "ride_along", label: "Ride-along signoff", note: "A supervised field run or shadow day has been completed." },
  ];
}

function teamTrainingRefreshPolicy(step = {}, member = {}) {
  const track = teamMemberRolloutTrack(member);
  const key = String(step?.key || "").trim();
  const driverPolicies = {
    yard_route: { refreshDays: 180, label: "Yard and route review" },
    driving: { refreshDays: 180, label: "Driving orientation" },
    worksite: { refreshDays: 90, label: "Worksite safety" },
    vactor: { refreshDays: 180, label: "Vactor operator walkthrough" },
    ride_along: { refreshDays: 30, label: "Ride-along signoff" },
  };
  const mixedPolicies = {
    yard_route: { refreshDays: 180, label: "Yard and route review" },
    driving: { refreshDays: 180, label: "Driving orientation" },
    ppe: { refreshDays: 90, label: "PPE and site safety" },
    worksite: { refreshDays: 90, label: "Driver and labor worksite flow" },
    vactor: { refreshDays: 180, label: "Vactor operator walkthrough" },
    handoff: { refreshDays: 180, label: "Photo and closeout handoff" },
    ride_along: { refreshDays: 30, label: "Ride-along signoff" },
  };
  const laborPolicies = {
    ppe: { refreshDays: 90, label: "PPE and site safety" },
    worksite: { refreshDays: 90, label: "Worksite labor orientation" },
    handoff: { refreshDays: 180, label: "Photo and closeout handoff" },
    ride_along: { refreshDays: 30, label: "Ride-along signoff" },
  };
  const policies = track.key === "driver"
    ? driverPolicies
    : track.key === "mixed"
      ? mixedPolicies
      : laborPolicies;
  const policy = policies[key];
  if (!policy) return null;
  return {
    ...policy,
    dueSoonDays: Math.min(14, policy.refreshDays),
  };
}

function teamTrainingStepRefreshStatus(step = {}, member = {}) {
  const policy = teamTrainingRefreshPolicy(step, member);
  const completedAt = String(step?.completedAt || "").trim();
  if (!policy || !completedAt) {
    return {
      policy,
      needsAttention: false,
      blocked: false,
      severity: "",
      label: "",
      note: "",
      dueAt: "",
      daysUntil: null,
    };
  }
  const completedTime = Date.parse(completedAt);
  if (!Number.isFinite(completedTime)) {
    return {
      policy,
      needsAttention: false,
      blocked: false,
      severity: "",
      label: "",
      note: "",
      dueAt: "",
      daysUntil: null,
    };
  }
  const dueDate = new Date(completedTime);
  dueDate.setUTCDate(dueDate.getUTCDate() + Number(policy.refreshDays || 0));
  const dueAt = dueDate.toISOString();
  const daysUntil = teamDaysUntil(dueAt);
  if (daysUntil == null) {
    return {
      policy,
      needsAttention: false,
      blocked: false,
      severity: "",
      label: "",
      note: "",
      dueAt,
      daysUntil,
    };
  }
  if (daysUntil < 0) {
    return {
      policy,
      needsAttention: true,
      blocked: true,
      severity: "expired",
      label: "Refresh overdue",
      note: `${policy.label} should have been refreshed by ${teamDateLabel(dueAt)}.`,
      dueAt,
      daysUntil,
    };
  }
  if (daysUntil <= Number(policy.dueSoonDays || 14)) {
    return {
      policy,
      needsAttention: true,
      blocked: false,
      severity: "soon",
      label: "Refresh due soon",
      note: `${policy.label} should be refreshed by ${teamDateLabel(dueAt)}.`,
      dueAt,
      daysUntil,
    };
  }
  return {
    policy,
    needsAttention: false,
    blocked: false,
    severity: "",
    label: "",
    note: "",
    dueAt,
    daysUntil,
  };
}

function teamTrainingProfile(member = {}) {
  const profiles = teamTrainingProfiles();
  const existing = profiles[String(member?.id || "").trim()] || {};
  const itemMeta = existing?.item_meta && typeof existing.item_meta === "object" ? existing.item_meta : {};
  const items = teamTrainingTemplate(member).map((item) => {
    const nextItem = {
      ...item,
      complete: existing?.items?.[item.key] === true,
      completedAt: String(itemMeta?.[item.key]?.completed_at || "").trim(),
      completedBy: String(itemMeta?.[item.key]?.completed_by || "").trim(),
      completionNote: String(itemMeta?.[item.key]?.completion_note || "").trim(),
    };
    const refresh = teamTrainingStepRefreshStatus(nextItem, member);
    return {
      ...nextItem,
      refreshDays: refresh.policy?.refreshDays || null,
      refreshDueAt: refresh.dueAt || "",
      refreshStatus: refresh.severity || "",
      refreshLabel: refresh.label || "",
      refreshNote: refresh.note || "",
    };
  });
  const completedCount = items.filter((item) => item.complete).length;
  const expiredRefreshes = items.filter((item) => item.refreshStatus === "expired");
  const soonRefreshes = items.filter((item) => item.refreshStatus === "soon");
  return {
    items,
    itemMeta,
    completedCount,
    totalCount: items.length,
    notes: String(existing?.notes || "").trim(),
    completedAt: String(existing?.completed_at || "").trim(),
    refreshAttention: expiredRefreshes.length
      ? {
          label: "Training refresh overdue",
          tone: "pill-bad",
          note: expiredRefreshes[0]?.refreshNote || "One or more rollout steps need to be refreshed.",
          needsAttention: true,
          blocked: true,
          items: expiredRefreshes,
        }
      : soonRefreshes.length
        ? {
            label: "Training refresh due soon",
            tone: "pill-warn",
            note: soonRefreshes[0]?.refreshNote || "A rollout step is due for refresh soon.",
            needsAttention: true,
            blocked: false,
            items: soonRefreshes,
          }
        : {
            label: "Training current",
            tone: "pill-good",
            note: "Recent onboarding and rollout signoffs are still current.",
            needsAttention: false,
            blocked: false,
            items: [],
          },
    status: completedCount === items.length && items.length
      ? "ready"
      : completedCount > 0
        ? "in_progress"
        : "not_started",
  };
}

function teamTrainingSummary(member = {}) {
  const profile = teamTrainingProfile(member);
  if (profile.refreshAttention?.blocked) {
    return {
      label: "Training refresh overdue",
      tone: "pill-bad",
      note: profile.refreshAttention.note,
      needsAttention: true,
      blocked: true,
    };
  }
  if (profile.refreshAttention?.needsAttention && profile.status === "ready") {
    return {
      label: "Training refresh due soon",
      tone: "pill-warn",
      note: profile.refreshAttention.note,
      needsAttention: true,
      blocked: false,
    };
  }
  if (profile.status === "ready") {
    return {
      label: "Training ready",
      tone: "pill-good",
      note: profile.completedAt ? `Training checklist finished ${profile.completedAt}.` : "Training checklist is complete for Monday rollout.",
      needsAttention: false,
      blocked: false,
    };
  }
  if (profile.status === "in_progress") {
    return {
      label: "Training in progress",
      tone: "pill-warn",
      note: `${profile.completedCount}/${profile.totalCount} onboarding steps are checked off.`,
      needsAttention: true,
      blocked: false,
    };
  }
  return {
    label: "Training not started",
    tone: "pill-warn",
    note: "Training checklist still needs to be walked through before rollout.",
    needsAttention: true,
    blocked: false,
  };
}

function teamRecordEvidenceTemplate(member = {}) {
  const track = teamMemberRolloutTrack(member);
  const shared = [
    { key: "onboarding_ack", label: "Onboarding acknowledgment", note: "Signed office onboarding acknowledgment is on file." },
    { key: "safety_ack", label: "Safety acknowledgment", note: "Signed safety or toolbox acknowledgment is on file." },
  ];
  if (track.key === "driver") {
    return [
      { key: "cdl_copy", label: "CDL copy", note: "Driver license copy has been reviewed and retained." },
      { key: "med_card_copy", label: "Med card copy", note: "Medical card copy has been reviewed and retained." },
      ...shared,
    ];
  }
  if (track.key === "mixed") {
    return [
      { key: "cdl_copy", label: "CDL copy", note: "Driver license copy has been reviewed and retained." },
      { key: "med_card_copy", label: "Med card copy", note: "Medical card copy has been reviewed and retained." },
      ...shared,
      { key: "role_ack", label: "Mixed-role expectations", note: "Driver and labor expectations were acknowledged." },
    ];
  }
  return [
    ...shared,
    { key: "role_ack", label: "Field expectations acknowledgment", note: "Crew expectations and field conduct acknowledgment is on file." },
  ];
}

function teamRecordEvidenceProfile(member = {}) {
  const profiles = teamTrainingProfiles();
  const existing = profiles[String(member?.id || "").trim()] || {};
  const recordEvidence = existing?.record_evidence && typeof existing.record_evidence === "object"
    ? existing.record_evidence
    : {};
  const items = teamRecordEvidenceTemplate(member).map((item) => {
    const meta = recordEvidence?.[item.key] && typeof recordEvidence[item.key] === "object" ? recordEvidence[item.key] : {};
    return {
      ...item,
      present: meta.present === true,
      recordedAt: String(meta.recorded_at || "").trim(),
      recordedBy: String(meta.recorded_by || "").trim(),
      noteValue: String(meta.note || "").trim(),
    };
  });
  const presentCount = items.filter((item) => item.present).length;
  return {
    items,
    presentCount,
    totalCount: items.length,
    missingItems: items.filter((item) => !item.present),
    status: presentCount === items.length && items.length
      ? "ready"
      : presentCount > 0
        ? "partial"
        : "missing",
  };
}

function teamRecordEvidenceSummary(member = {}) {
  const profile = teamRecordEvidenceProfile(member);
  if (profile.status === "ready") {
    return {
      label: "Records on file",
      tone: "pill-good",
      note: "Core office records are marked as retained for this worker.",
      needsAttention: false,
      blocked: false,
    };
  }
  if (profile.status === "partial") {
    return {
      label: "Records missing",
      tone: "pill-warn",
      note: `${profile.presentCount}/${profile.totalCount} office records are marked on file.`,
      needsAttention: true,
      blocked: false,
    };
  }
  return {
    label: "Records not started",
    tone: "pill-warn",
    note: "Core office records still need to be marked on file.",
    needsAttention: true,
    blocked: false,
  };
}

function getTeamCurrentOperatorLabel() {
  const runtime = window?.PROOFLINK_OPERATOR_RUNTIME;
  const current = runtime?.getCurrentOperator?.() || {};
  return String(current?.operator_name || current?.role || "Office").trim() || "Office";
}

function renderTrainingChecklistHistory(profile = {}) {
  const items = Array.isArray(profile?.items) ? profile.items.filter((item) => item.complete) : [];
  if (!items.length) {
    return '<div class="muted">No checklist steps have been signed off yet.</div>';
  }
  return items.map((item) => `
    <div class="list-item" style="padding:6px 0;">
      <div class="li-main">
        <div class="li-title">${escapeHtml(item.label)}</div>
        <div class="li-sub muted" style="font-size:.75rem;">
          ${escapeHtml(item.completedAt ? `Completed ${item.completedAt}` : "Completed")}
          ${item.completedBy ? ` • ${escapeHtml(item.completedBy)}` : ""}
        </div>
      </div>
    </div>
  `).join("");
}

function teamChecklistEvidenceMatchers(stepKey = "", member = {}) {
  const track = teamMemberRolloutTrack(member);
  const driverTrack = track.key === "driver" || track.key === "mixed";
  const sharedTrainingTypes = {
    crew_app: ["onboarding"],
    yard_route: ["onboarding"],
    worksite: ["worksite_safety", "hydrovac_field", "onboarding"],
    ride_along: ["ride_along"],
  };
  const driverTrainingTypes = {
    driving: ["cdl", "driver_safety", "onboarding"],
    vactor: ["vactor_operator", "hydrovac_field", "onboarding"],
  };
  const laborTrainingTypes = {
    ppe: ["worksite_safety", "onboarding"],
    handoff: ["onboarding", "hydrovac_field"],
  };
  return {
    workTypes: ["driver_training", "trade_training", "safety_meeting"],
    trainingTypes: [
      ...(sharedTrainingTypes[stepKey] || []),
      ...(driverTrack ? (driverTrainingTypes[stepKey] || []) : (laborTrainingTypes[stepKey] || [])),
    ],
  };
}

function teamChecklistEvidenceForStep(step = {}, history = null, member = {}) {
  const entries = Array.isArray(history?.entries) ? history.entries : [];
  const matchers = teamChecklistEvidenceMatchers(step.key, member);
  return entries.filter((entry) => {
    const workType = String(entry?.work_type || "").trim();
    const trainingType = String(entry?.training_type || "").trim();
    return matchers.workTypes.includes(workType) && (!matchers.trainingTypes.length || matchers.trainingTypes.includes(trainingType));
  }).slice(0, 3);
}

function renderTrainingEvidenceList(step = {}, history = null, member = {}) {
  const evidence = teamChecklistEvidenceForStep(step, history, member);
  if (!evidence.length) {
    return '<div class="muted" style="font-size:.72rem;margin-top:4px;">No linked training time found yet.</div>';
  }
  return evidence.map((entry) => `
    <div class="muted" style="font-size:.72rem;margin-top:4px;">
      ${escapeHtml(entry.started_at ? new Date(entry.started_at).toLocaleDateString() : "Recent")}
      • ${escapeHtml(entry.description || teamTimePurposeLabel(entry.work_type))}
      • ${escapeHtml(teamMinutesLabel(entry.duration_minutes || 0))}
    </div>
  `).join("");
}

function teamTrainingQuickPreset(member = {}) {
  const track = teamMemberRolloutTrack(member);
  return {
    purpose: track.key === "driver" || track.key === "mixed" ? "driver_training" : "trade_training",
    training_type: "onboarding",
    description: track.key === "driver"
      ? "Driver onboarding, route review, and field rollout training"
      : track.key === "mixed"
        ? "Mixed-role onboarding covering driver and labor rollout expectations"
        : "Crew onboarding, worksite flow, and field rollout training",
    duration_minutes: 60,
  };
}

function teamMaintenanceQuickPreset() {
  return {
    purpose: "maintenance",
    maintenance_type: "routine_service",
    asset_category: "vehicle",
    description: "Routine truck or equipment maintenance",
    duration_minutes: 60,
    cost_bucket: "maintenance_overhead",
    billable: false,
  };
}

function teamMaintenanceCapitalPreset() {
  return {
    purpose: "maintenance",
    maintenance_type: "capital_improvement",
    asset_category: "vehicle",
    description: "Capital maintenance or upgrade work",
    duration_minutes: 120,
    cost_bucket: "asset_basis_candidate",
    billable: false,
  };
}

function teamMembersNeedingRollout() {
  return (Array.isArray(TEAM_MEMBERS_CACHE) ? TEAM_MEMBERS_CACHE : [])
    .filter((member) => {
      const driver = teamMemberDriverReadiness(member);
      const training = teamTrainingSummary(member);
      return driver.needsAttention || training.needsAttention;
    })
    .sort((left, right) => {
      const leftRestriction = teamMemberRolloutRestriction(left);
      const rightRestriction = teamMemberRolloutRestriction(right);
      const rank = (restriction) => {
        const label = String(restriction?.label || "").trim();
        if (label === "Restricted from solo dispatch") return 0;
        if (label === "Training refresh overdue" || label === "Qualification refresh overdue") return 1;
        if (label === "Labor-only until driver setup clears") return 1;
        if (label === "Supervised mixed-role rollout") return 2;
        if (label === "Ride-along required") return 3;
        if (label === "Training refresh due soon" || label === "Refresh due soon") return 4;
        if (label === "Training hold" || label === "Mixed-role training in progress" || label === "Needs supervised field day") return 5;
        return 5;
      };
      const rankDiff = rank(leftRestriction) - rank(rightRestriction);
      if (rankDiff) return rankDiff;
      return teamMemberLabel(left).localeCompare(teamMemberLabel(right));
    });
}

function openPresetTrainingTimeModal(id) {
  const member = findTeamMemberById(id);
  if (!member) {
    showToast("Team member not found.");
    return;
  }
  openTeamTimeModal(member.id, teamTrainingQuickPreset(member));
}

function openMaintenanceTimeModal() {
  const defaultMember = (Array.isArray(TEAM_MEMBERS_CACHE) ? TEAM_MEMBERS_CACHE : [])[0] || null;
  if (!defaultMember) {
    showToast("Add a team member before logging maintenance time.");
    return;
  }
  openTeamTimeModal(defaultMember.id, teamMaintenanceQuickPreset());
}

function teamProfileDateRange(daysBack = 30) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(1, Number(daysBack || 30)));
  const iso = (value) => value.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

async function fetchTeamMemberHistory(member = {}, daysBack = 30) {
  const token = await getOperatorAccessToken();
  const { start, end } = teamProfileDateRange(daysBack);
  const response = await fetch(`/.netlify/functions/get-team-hours?start=${start}&end=${end}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Failed to load team history.");
  const members = Array.isArray(data?.members) ? data.members : [];
  return members.find((row) => String(row?.member_id || row?.id || "").trim() === String(member?.id || "").trim()) || null;
}

function teamProfileSummaryChips(member = {}) {
  const chips = [];
  const compensation = member?.compensation || {};
  const track = teamMemberRolloutTrack(member);
  chips.push(`Track: ${track.label}`);
  if (member?.driver_label) chips.push(`Driver label: ${member.driver_label}`);
  if (member?.worker_label) chips.push(`Worker label: ${member.worker_label}`);
  if (compensation?.union_classification_name) chips.push(`Union class: ${compensation.union_classification_name}`);
  if (member?.union_local_number) chips.push(`Local ${member.union_local_number}`);
  return chips;
}

function teamReadinessGates(member = {}, history = null, profile = null) {
  const resolvedProfile = profile || teamTrainingProfile(member);
  const track = teamMemberRolloutTrack(member);
  const driver = teamMemberDriverReadiness(member);
  const training = teamTrainingSummary(member);
  const records = teamRecordEvidenceSummary(member);
  const qualificationRefresh = teamQualificationRefreshPressure(member);
  const restriction = teamMemberRolloutRestriction(member);
  const items = [];

  const pushGate = (severity, label, note, action) => {
    items.push({
      severity,
      label,
      note,
      action: action || "",
      tone: severity === "blocked" ? "pill-bad" : severity === "warn" ? "pill-warn" : "pill-good",
    });
  };

  if (driver.label === "Driver setup needed" || driver.label === "Driver record blocked") {
    pushGate("blocked", "Driver setup", driver.note, "Finish driver setup");
  } else if (driver.label === "Driver follow-up") {
    pushGate("warn", "Driver follow-up", driver.note, "Review qualification notes");
  } else if (track.key === "driver" || track.key === "mixed") {
    pushGate("good", "Driver record", driver.note, "Ready");
  }

  if (qualificationRefresh.blocked) {
    pushGate("blocked", qualificationRefresh.label, qualificationRefresh.note, "Refresh qualification");
  } else if (qualificationRefresh.needsAttention) {
    pushGate("warn", qualificationRefresh.label, qualificationRefresh.note, "Schedule qualification refresh");
  }

  if (training.blocked) {
    pushGate("blocked", training.label, training.note, "Refresh stale training");
  } else if (training.label === "Training not started") {
    pushGate("blocked", training.label, training.note, "Start onboarding walkthrough");
  } else if (training.needsAttention) {
    pushGate("warn", training.label, training.note, training.label === "Training in progress" ? "Finish checklist steps" : "Schedule training refresh");
  } else {
    pushGate("good", training.label, training.note, "Current");
  }

  if (records.needsAttention) {
    pushGate("warn", records.label, records.note, "Mark office records");
  } else {
    pushGate("good", records.label, records.note, "Current");
  }

  const incompleteSteps = (Array.isArray(resolvedProfile?.items) ? resolvedProfile.items : [])
    .filter((item) => !item.complete)
    .slice(0, 3)
    .map((item) => item.label);
  if (incompleteSteps.length) {
    pushGate(
      "warn",
      "Checklist still open",
      `${incompleteSteps.join(", ")}${resolvedProfile.items.length - incompleteSteps.length > 0 ? ", and more still need signoff." : " still need signoff."}`,
      "Finish walkthrough"
    );
  }

  const nextAction = teamMemberNextAction(member);
  pushGate(
    restriction.tone === "pill-bad" ? "blocked" : restriction.tone === "pill-warn" ? "warn" : "good",
    "Dispatch status",
    restriction.note,
    nextAction.label
  );

  const blockedCount = items.filter((item) => item.severity === "blocked").length;
  const warningCount = items.filter((item) => item.severity === "warn").length;
  return {
    items,
    blockedCount,
    warningCount,
    readyCount: items.filter((item) => item.severity === "good").length,
    headline: blockedCount
      ? "Blocked rollout items need attention first."
      : warningCount
        ? "This worker is usable, but follow-through is still due."
        : "Records look clear for the current rollout path.",
  };
}

function renderTeamReadinessGates(member = {}, history = null, profile = null) {
  const readiness = teamReadinessGates(member, history, profile);
  return `
    <div class="row row-tight" style="margin-bottom:10px;flex-wrap:wrap;">
      <span class="pill ${readiness.blockedCount ? "pill-bad" : "pill-good"}">${escapeHtml(`${readiness.blockedCount} blocked`)}</span>
      <span class="pill ${readiness.warningCount ? "pill-warn" : "pill-good"}">${escapeHtml(`${readiness.warningCount} follow-up`)}</span>
      <span class="pill pill-good">${escapeHtml(`${readiness.readyCount} clear`)}</span>
    </div>
    <div class="muted" style="margin-bottom:10px;">${escapeHtml(readiness.headline)}</div>
    ${readiness.items.map((item) => `
      <div class="list-item" style="padding:8px 0;">
        <div class="li-main">
          <div class="li-title">${escapeHtml(item.label)}</div>
          <div class="li-sub muted" style="font-size:.75rem;">${escapeHtml(item.note || "")}</div>
        </div>
        <div class="li-meta" style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
          <span class="pill ${item.tone}">${escapeHtml(item.action || (item.severity === "good" ? "Ready" : "Review"))}</span>
        </div>
      </div>
    `).join("")}
  `;
}

function renderTeamRecordEvidence(member = {}) {
  const profile = teamRecordEvidenceProfile(member);
  if (!profile.items.length) {
    return '<div class="muted">No office record requirements are configured for this worker yet.</div>';
  }
  return profile.items.map((item) => `
    <div class="list-item" style="padding:8px 0;">
      <div class="li-main">
        <div class="li-title">${escapeHtml(item.label)}</div>
        <div class="li-sub muted" style="font-size:.75rem;">${escapeHtml(item.note)}</div>
        ${item.noteValue ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(item.noteValue)}</div>` : ""}
      </div>
      <div class="li-meta" style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
        <span class="pill ${item.present ? "pill-good" : "pill-warn"}">${escapeHtml(item.present ? "On file" : "Missing")}</span>
        ${item.recordedAt ? `<span class="muted" style="font-size:.72rem;">${escapeHtml(teamDateLabel(item.recordedAt))}</span>` : ""}
      </div>
    </div>
  `).join("");
}

function teamMemberRolloutRestriction(member = {}) {
  const track = teamMemberRolloutTrack(member);
  const driver = teamMemberDriverReadiness(member);
  const training = teamTrainingSummary(member);
  const refresh = teamQualificationRefreshPressure(member);
  const profile = teamTrainingProfile(member);
  const completedKeys = new Set(
    (Array.isArray(profile?.items) ? profile.items : [])
      .filter((item) => item.complete)
      .map((item) => String(item.key || "").trim())
  );

  if (track.key === "driver") {
    if (driver.needsAttention) {
      return {
        label: "Restricted from solo dispatch",
        tone: "pill-bad",
        note: "Keep this worker off solo driving until driver setup is fully cleared.",
      };
    }
    if (refresh.blocked) {
      return {
        label: "Qualification refresh overdue",
        tone: "pill-bad",
        note: refresh.note,
      };
    }
    if (!completedKeys.has("ride_along")) {
      return {
        label: "Ride-along required",
        tone: "pill-warn",
        note: "A supervised field run still needs to be signed off before solo dispatch.",
      };
    }
    if (training.blocked) {
      return {
        label: "Training refresh overdue",
        tone: "pill-bad",
        note: training.note,
      };
    }
    if (training.needsAttention) {
      return {
        label: training.label === "Training refresh due soon" ? "Training refresh due soon" : "Training hold",
        tone: "pill-warn",
        note: training.label === "Training refresh due soon"
          ? training.note
          : "Finish the remaining driver rollout steps before solo dispatch.",
      };
    }
    if (refresh.needsAttention) {
      return {
        label: "Refresh due soon",
        tone: "pill-warn",
        note: refresh.note,
      };
    }
    return {
      label: "Solo-ready",
      tone: "pill-good",
      note: "Driver setup and rollout records support solo dispatch.",
    };
  }

  if (track.key === "mixed") {
    if (driver.needsAttention) {
      return {
        label: "Labor-only until driver setup clears",
        tone: "pill-warn",
        note: "This worker can still support labor, but should not take driver responsibility yet.",
      };
    }
    if (refresh.blocked) {
      return {
        label: "Qualification refresh overdue",
        tone: "pill-bad",
        note: refresh.note,
      };
    }
    if (!completedKeys.has("ride_along")) {
      return {
        label: "Supervised mixed-role rollout",
        tone: "pill-warn",
        note: "Keep this worker on a supervised route until the ride-along is signed off.",
      };
    }
    if (training.blocked) {
      return {
        label: "Training refresh overdue",
        tone: "pill-bad",
        note: training.note,
      };
    }
    if (training.needsAttention) {
      return {
        label: training.label === "Training refresh due soon" ? "Training refresh due soon" : "Mixed-role training in progress",
        tone: "pill-warn",
        note: training.label === "Training refresh due soon"
          ? training.note
          : "The worker can support the crew, but mixed-role rollout still needs follow-through.",
      };
    }
    if (refresh.needsAttention) {
      return {
        label: "Refresh due soon",
        tone: "pill-warn",
        note: refresh.note,
      };
    }
    return {
      label: "Ready for driver or labor dispatch",
      tone: "pill-good",
      note: "The worker is cleared to swing between driver and labor assignments from the saved records.",
    };
  }

  if (training.blocked) {
    return {
      label: "Training refresh overdue",
      tone: "pill-bad",
      note: training.note,
    };
  }
  if (training.needsAttention) {
    return {
      label: training.label === "Training refresh due soon" ? "Training refresh due soon" : "Needs supervised field day",
      tone: "pill-warn",
      note: training.label === "Training refresh due soon"
        ? training.note
        : "Keep this worker with a lead until the field onboarding steps are fully signed off.",
    };
  }
  return {
    label: "Ready for field support",
    tone: "pill-good",
    note: "Labor rollout records look complete for supported field work.",
  };
}

function renderTeamHistorySnapshot(member = {}, history = null) {
  if (!history) {
    return '<div class="muted">No recent time or job history loaded yet.</div>';
  }
  const entries = Array.isArray(history.entries) ? history.entries.slice(0, 6) : [];
  const jobs = Array.isArray(history.jobs) ? history.jobs.slice(0, 4) : [];
  return `
    <div class="modal-grid-2">
      <div class="card">
        <div class="card-hd"><strong>Recent time</strong></div>
        <div class="card-bd">
          <div class="muted" style="font-size:.8rem;margin-bottom:8px;">
            ${escapeHtml(`${Number((Number(history.total_minutes || 0) / 60).toFixed(1))}h in the last 30 days`)}
            ${history.training_minutes ? ` • ${escapeHtml(`${Number((Number(history.training_minutes || 0) / 60).toFixed(1))}h training`)}` : ""}
            ${history.maintenance_minutes ? ` • ${escapeHtml(`${Number((Number(history.maintenance_minutes || 0) / 60).toFixed(1))}h maintenance`)}` : ""}
          </div>
          ${entries.length ? entries.map((entry) => `
            <div class="list-item" style="padding:6px 0;">
              <div class="li-main">
                <div class="li-title">${escapeHtml(entry.description || "Time entry")}</div>
                <div class="li-sub muted" style="font-size:.75rem;">${escapeHtml(entry.work_type_label || teamTimePurposeLabel(entry.work_type))}</div>
              </div>
              <div class="li-meta"><span class="pill">${escapeHtml(teamMinutesLabel(entry.duration_minutes || 0))}</span></div>
            </div>
          `).join("") : '<div class="muted">No recent time entries.</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><strong>Recent jobs</strong></div>
        <div class="card-bd">
          <div class="muted" style="font-size:.8rem;margin-bottom:8px;">${escapeHtml(`${history.job_count || 0} jobs in the selected history window`)}</div>
          ${jobs.length ? jobs.map((job) => `
            <div class="list-item" style="padding:6px 0;">
              <div class="li-main">
                <div class="li-title">${escapeHtml(job.title || "Untitled job")}</div>
                <div class="li-sub muted" style="font-size:.75rem;">${escapeHtml(job.customer_name || "")}</div>
              </div>
              <div class="li-meta"><span class="pill">${escapeHtml(job.status || "scheduled")}</span></div>
            </div>
          `).join("") : '<div class="muted">No recent assigned jobs.</div>'}
        </div>
      </div>
    </div>
  `;
}

function buildTeamMemberTimeline(member = {}, history = null, profile = {}) {
  const timeline = [];
  const qualification = teamMemberDriverQualification(member);
  const refresh = teamQualificationRefreshPressure(member);
  const completedItems = Array.isArray(profile?.items) ? profile.items.filter((item) => item.complete) : [];
  const recordEvidence = teamRecordEvidenceProfile(member);
  const entries = Array.isArray(history?.entries) ? history.entries : [];
  const jobs = Array.isArray(history?.jobs) ? history.jobs : [];

  const compensationEntry = teamMemberCompensationTimelineEntry(member);
  if (compensationEntry) {
    timeline.push(compensationEntry);
  }
  timeline.push(...teamQualificationTimelineEntries(member));

  completedItems.forEach((item) => {
    if (!item.completedAt) return;
    timeline.push({
      sortAt: item.completedAt,
      tone: 'pill-good',
      label: 'Training signoff',
      title: item.label,
      note: item.completionNote || item.completedBy || 'Office signoff recorded.',
    });
    if (item.refreshDueAt && item.refreshLabel) {
      timeline.push({
        sortAt: item.refreshDueAt,
        tone: item.refreshStatus === 'expired' ? 'pill-bad' : 'pill-warn',
        label: item.refreshLabel,
        title: item.label,
        note: item.refreshNote,
      });
    }
  });

  recordEvidence.items
    .filter((item) => item.present && item.recordedAt)
    .forEach((item) => {
      timeline.push({
        sortAt: item.recordedAt,
        tone: "pill",
        label: "Office record",
        title: item.label,
        note: [item.recordedBy, item.noteValue || item.note].filter(Boolean).join(" | ") || "Retained in the employee file.",
      });
    });

  entries.slice(0, 8).forEach((entry) => {
    timeline.push({
      sortAt: entry?.started_at || entry?.created_at || '',
      tone: String(entry?.work_type || '').trim().toLowerCase() === 'maintenance' ? 'pill-warn' : 'pill',
      label: entry?.work_type_label || teamTimePurposeLabel(entry?.work_type),
      title: entry?.description || 'Time entry',
      note: `${teamMinutesLabel(entry?.duration_minutes || 0)}${entry?.cost_bucket ? ` | ${teamCostBucketLabel(entry.cost_bucket)}` : ''}`,
    });
  });

  jobs.slice(0, 6).forEach((job) => {
    timeline.push({
      sortAt: job?.actual_end_at || job?.actual_start_at || '',
      tone: ['completed', 'done'].includes(String(job?.status || '').trim().toLowerCase()) ? 'pill-good' : 'pill-on',
      label: 'Assigned job',
      title: job?.title || 'Untitled job',
      note: [job?.customer_name, job?.status].filter(Boolean).join(' | ') || 'Assigned work',
    });
  });

  if (qualification?.cdl_expiry_date) {
    timeline.push({
      sortAt: qualification.cdl_expiry_date,
      tone: 'pill',
      label: 'CDL expiry',
      title: `CDL expires ${teamDateLabel(qualification.cdl_expiry_date)}`,
      note: [qualification?.cdl_class, qualification?.cdl_state].filter(Boolean).join(' ') || 'Driver qualification',
    });
  }
  if (qualification?.medical_certificate_expiry) {
    timeline.push({
      sortAt: qualification.medical_certificate_expiry,
      tone: 'pill',
      label: 'Med card expiry',
      title: `Med card expires ${teamDateLabel(qualification.medical_certificate_expiry)}`,
      note: qualification?.medical_examiner_name || 'Driver qualification',
    });
  }
  if (qualification?.last_mvr_check_date) {
    timeline.push({
      sortAt: qualification.last_mvr_check_date,
      tone: 'pill',
      label: 'MVR check',
      title: `MVR checked ${teamDateLabel(qualification.last_mvr_check_date)}`,
      note: qualification?.mvr_status || 'Driver qualification',
    });
  }
  refresh.items.slice(0, 4).forEach((item) => {
    timeline.push({
      sortAt: item?.key === 'mvr' ? qualification?.last_mvr_check_date : (
        item?.key === 'cdl' ? qualification?.cdl_expiry_date
          : item?.key === 'med_card' ? qualification?.medical_certificate_expiry
            : item?.key === 'first_aid' ? qualification?.first_aid_cert_expiry_date
              : item?.key === 'confined_space' ? qualification?.confined_space_cert_expiry_date
                : qualification?.h2s_cert_expiry_date
      ),
      tone: item.severity === 'expired' ? 'pill-bad' : 'pill-warn',
      label: item.severity === 'expired' ? 'Refresh overdue' : 'Refresh due soon',
      title: item.label,
      note: item.note,
    });
  });

  return timeline
    .filter((item) => item.sortAt)
    .sort((a, b) => {
      const aTime = Date.parse(a.sortAt) || 0;
      const bTime = Date.parse(b.sortAt) || 0;
      return bTime - aTime;
    })
    .slice(0, 12);
}

function renderTeamTimeline(member = {}, history = null, profile = {}) {
  const items = buildTeamMemberTimeline(member, history, profile);
  if (!items.length) {
    return '<div class="muted">Timeline entries will appear here once training, jobs, or tracked time start landing.</div>';
  }
  return items.map((item) => `
    <div class="list-item" style="padding:8px 0;">
      <div class="li-main">
        <div class="li-title">${escapeHtml(item.title || item.label || 'Timeline event')}</div>
        <div class="li-sub muted" style="font-size:.75rem;">${escapeHtml(item.note || '')}</div>
      </div>
      <div class="li-meta" style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
        <span class="pill ${escapeAttr(item.tone || 'pill')}">${escapeHtml(item.label || 'Update')}</span>
        <span class="muted" style="font-size:.72rem;">${escapeHtml(teamDateLabel(item.sortAt))}</span>
      </div>
    </div>
  `).join('');
}

function buildTeamMemberProfileRows(member = {}, history = null, profile = null) {
  const resolvedProfile = profile || teamTrainingProfile(member);
  const readiness = teamReadinessGates(member, history, resolvedProfile);
  const records = teamRecordEvidenceProfile(member);
  const timeline = buildTeamMemberTimeline(member, history, resolvedProfile);
  const qualification = teamMemberDriverQualification(member) || {};
  const rows = [
    ["EMPLOYEE PROFILE"],
    ["Member", teamMemberLabel(member)],
    ["Role", member?.role || ""],
    ["Track", teamMemberRolloutTrack(member).label],
    ["Displayed Rate", teamMemberDisplayedRateCents(member) ? `${formatUsd(teamMemberDisplayedRateCents(member))}/hr` : ""],
    ["Pay Context", teamMemberCompensationNote(member)],
    ["Driver Readiness", teamMemberDriverReadiness(member).label],
    ["Training Readiness", teamTrainingSummary(member).label],
    ["Restriction", teamMemberRolloutRestriction(member).label],
    ["Next Action", teamMemberNextAction(member).label],
    [],
    ["READINESS GATES"],
    ["Headline", readiness.headline],
    ["Blocked", readiness.blockedCount],
    ["Follow-up", readiness.warningCount],
    ["Clear", readiness.readyCount],
  ];

  readiness.items.forEach((item) => {
    rows.push([item.label, item.severity, item.action || "", item.note || ""]);
  });

  rows.push(
    [],
    ["OFFICE RECORDS"],
    ["Status", teamRecordEvidenceSummary(member).label],
    ["Qualification Refresh", teamQualificationRefreshPressure(member).label],
  );

  records.items.forEach((item) => {
    rows.push([
      item.label,
      item.present ? "On file" : "Missing",
      item.recordedAt ? teamDateLabel(item.recordedAt) : "",
      item.recordedBy || "",
      item.note || "",
    ]);
  });

  if (qualification?.cdl_class || qualification?.medical_certificate_expiry || qualification?.last_mvr_check_date) {
    rows.push(
      [],
      ["QUALIFICATIONS"],
      ["CDL", [qualification?.cdl_class, qualification?.cdl_state].filter(Boolean).join(" ")],
      ["CDL Expiry", qualification?.cdl_expiry_date ? teamDateLabel(qualification.cdl_expiry_date) : ""],
      ["Med Card Expiry", qualification?.medical_certificate_expiry ? teamDateLabel(qualification.medical_certificate_expiry) : ""],
      ["MVR Check", qualification?.last_mvr_check_date ? teamDateLabel(qualification.last_mvr_check_date) : ""],
      ["First Aid Expiry", qualification?.first_aid_cert_expiry_date ? teamDateLabel(qualification.first_aid_cert_expiry_date) : ""],
      ["Confined Space Expiry", qualification?.confined_space_cert_expiry_date ? teamDateLabel(qualification.confined_space_cert_expiry_date) : ""],
      ["H2S Expiry", qualification?.h2s_cert_expiry_date ? teamDateLabel(qualification.h2s_cert_expiry_date) : ""],
    );
  }

  rows.push([], ["CHECKLIST HISTORY"]);
  resolvedProfile.items.filter((item) => item.complete).forEach((item) => {
    rows.push([
      item.label,
      item.completedAt ? teamDateLabel(item.completedAt) : "Completed",
      item.completedBy || "",
      item.completionNote || "",
      item.refreshLabel || "",
    ]);
  });

  rows.push([], ["RECENT TIME"]);
  (Array.isArray(history?.entries) ? history.entries : []).slice(0, 12).forEach((entry) => {
    rows.push([
      entry.started_at ? teamDateLabel(entry.started_at) : "",
      entry.description || "Time entry",
      entry.work_type_label || teamTimePurposeLabel(entry.work_type),
      entry.training_type ? teamTrainingTypeLabel(entry.training_type) : "",
      entry.maintenance_type ? teamMaintenanceTypeLabel(entry.maintenance_type) : "",
      entry.asset_label || entry.asset_category ? [entry.asset_label, teamAssetCategoryLabel(entry.asset_category)].filter(Boolean).join(" | ") : "",
      teamCostBucketLabel(entry.cost_bucket),
      teamMinutesLabel(entry.duration_minutes || 0),
    ]);
  });

  rows.push([], ["TIMELINE"]);
  timeline.forEach((item) => {
    rows.push([
      item.sortAt ? teamDateLabel(item.sortAt) : "",
      item.label || "",
      item.title || "",
      item.note || "",
    ]);
  });

  return rows;
}

function exportTeamMemberProfileCsv(member = {}, history = null, profile = null) {
  const filenameBase = String(teamMemberLabel(member) || "team-member")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "team-member";
  downloadTeamCsv(
    `${filenameBase}-profile-${new Date().toISOString().slice(0, 10)}.csv`,
    buildTeamMemberProfileRows(member, history, profile)
  );
}

function renderTrainingEvidenceSnapshot(profile = {}, history = null, member = {}) {
  const items = Array.isArray(profile?.items) ? profile.items.filter((item) => item.complete) : [];
  if (!items.length) {
    return '<div class="muted">Complete a checklist step to start linking training evidence here.</div>';
  }
  return items.map((item) => `
    <div class="list-item" style="padding:8px 0;">
      <div class="li-main">
        <div class="li-title">${escapeHtml(item.label)}</div>
        <div class="li-sub muted" style="font-size:.75rem;">
          ${escapeHtml(item.completedAt ? `Signed off ${item.completedAt}` : "Signed off")}
          ${item.completedBy ? ` • ${escapeHtml(item.completedBy)}` : ""}
        </div>
        ${renderTrainingEvidenceList(item, history, member)}
      </div>
    </div>
  `).join("");
}

function renderTrainingChecklistHistory(profile = {}) {
  const items = Array.isArray(profile?.items) ? profile.items.filter((item) => item.complete) : [];
  if (!items.length) {
    return '<div class="muted">No checklist steps have been signed off yet.</div>';
  }
  return items.map((item) => `
    <div class="list-item" style="padding:6px 0;">
      <div class="li-main">
        <div class="li-title">${escapeHtml(item.label)}</div>
        <div class="li-sub muted" style="font-size:.75rem;">
          ${escapeHtml(item.completedAt ? `Completed ${item.completedAt}` : "Completed")}
          ${item.completedBy ? ` | ${escapeHtml(item.completedBy)}` : ""}
        </div>
        ${item.refreshLabel ? `<div style="margin-top:4px;"><span class="pill ${item.refreshStatus === "expired" ? "pill-bad" : "pill-warn"}" style="font-size:.68rem;">${escapeHtml(item.refreshLabel)}</span></div>` : ""}
        ${item.refreshNote ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(item.refreshNote)}</div>` : ""}
        ${item.completionNote ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(item.completionNote)}</div>` : ""}
      </div>
    </div>
  `).join("");
}

function teamQualificationEvidenceForStep(step = {}, member = {}) {
  const qualification = teamMemberDriverQualification(member);
  if (!qualification) return [];
  const stepKey = String(step?.key || "").trim();
  const track = teamMemberRolloutTrack(member);
  const driverTrack = track.key === "driver" || track.key === "mixed";
  const evidence = [];
  const cdlLabel = [qualification?.cdl_class, qualification?.cdl_state].filter(Boolean).join(" ");
  const pushEvidence = (condition, label) => {
    if (!condition || !label) return;
    evidence.push(label);
  };

  if (stepKey === "driving") {
    pushEvidence(cdlLabel, `CDL on file: ${cdlLabel}`);
    pushEvidence(qualification?.cdl_expiry_date, `CDL expires ${teamDateLabel(qualification.cdl_expiry_date)}`);
    pushEvidence(qualification?.defensive_driving_completed, "Defensive driving marked complete");
  }
  if (stepKey === "yard_route" && driverTrack) {
    pushEvidence(
      qualification?.hos_available_driving_minutes != null,
      `HOS available: ${teamMinutesLabel(qualification.hos_available_driving_minutes || 0)}`
    );
    pushEvidence(qualification?.last_mvr_check_date, `MVR checked ${teamDateLabel(qualification.last_mvr_check_date)}`);
  }
  if (["worksite", "ppe"].includes(stepKey)) {
    pushEvidence(
      qualification?.first_aid_certified,
      qualification?.first_aid_cert_expiry_date
        ? `First aid current through ${teamDateLabel(qualification.first_aid_cert_expiry_date)}`
        : "First aid marked complete"
    );
    pushEvidence(
      qualification?.confined_space_certified,
      qualification?.confined_space_cert_expiry_date
        ? `Confined space current through ${teamDateLabel(qualification.confined_space_cert_expiry_date)}`
        : "Confined space marked complete"
    );
    pushEvidence(
      qualification?.h2s_alive_certified,
      qualification?.h2s_cert_expiry_date
        ? `H2S current through ${teamDateLabel(qualification.h2s_cert_expiry_date)}`
        : "H2S marked complete"
    );
  }
  if (stepKey === "vactor") {
    pushEvidence(qualification?.hos_last_synced_at, `HOS last updated ${teamDateLabel(qualification.hos_last_synced_at)}`);
    pushEvidence(qualification?.confined_space_certified, "Confined space record is on file");
    pushEvidence(qualification?.h2s_alive_certified, "H2S record is on file");
  }

  return evidence.slice(0, 3);
}

function renderTrainingEvidenceList(step = {}, history = null, member = {}) {
  const evidence = teamChecklistEvidenceForStep(step, history, member);
  const qualificationEvidence = teamQualificationEvidenceForStep(step, member);
  if (!evidence.length && !qualificationEvidence.length) {
    return '<div class="muted" style="font-size:.72rem;margin-top:4px;">No linked training or readiness evidence found yet.</div>';
  }
  return `
    ${evidence.length ? `
      <div class="muted" style="font-size:.72rem;margin-top:4px;">Time evidence</div>
      ${evidence.map((entry) => `
        <div class="muted" style="font-size:.72rem;margin-top:4px;">
          ${escapeHtml(entry.started_at ? teamDateLabel(entry.started_at) : "Recent")}
          | ${escapeHtml(entry.description || teamTimePurposeLabel(entry.work_type))}
          | ${escapeHtml(teamMinutesLabel(entry.duration_minutes || 0))}
        </div>
      `).join("")}
    ` : ""}
    ${qualificationEvidence.length ? `
      <div class="muted" style="font-size:.72rem;margin-top:${evidence.length ? "6px" : "4px"};">Readiness evidence</div>
      ${qualificationEvidence.map((item) => `
        <div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(item)}</div>
      `).join("")}
    ` : ""}
  `;
}

function renderTrainingEvidenceSnapshot(profile = {}, history = null, member = {}) {
  const items = Array.isArray(profile?.items) ? profile.items.filter((item) => item.complete) : [];
  if (!items.length) {
    return '<div class="muted">Complete a checklist step to start linking training evidence here.</div>';
  }
  return items.map((item) => `
    <div class="list-item" style="padding:8px 0;">
      <div class="li-main">
        <div class="li-title">${escapeHtml(item.label)}</div>
        <div class="li-sub muted" style="font-size:.75rem;">
          ${escapeHtml(item.completedAt ? `Signed off ${item.completedAt}` : "Signed off")}
          ${item.completedBy ? ` | ${escapeHtml(item.completedBy)}` : ""}
        </div>
        ${item.refreshLabel ? `<div style="margin-top:4px;"><span class="pill ${item.refreshStatus === "expired" ? "pill-bad" : "pill-warn"}" style="font-size:.68rem;">${escapeHtml(item.refreshLabel)}</span></div>` : ""}
        ${item.refreshNote ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(item.refreshNote)}</div>` : ""}
        ${item.completionNote ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(item.completionNote)}</div>` : ""}
        ${renderTrainingEvidenceList(item, history, member)}
      </div>
    </div>
  `).join("");
}

function renderDriverQualificationSnapshot(member = {}) {
  const qualification = teamMemberDriverQualification(member);
  const track = teamMemberRolloutTrack(member);
  const refresh = teamQualificationRefreshPressure(member);
  const driverTrack = track.key === "driver" || track.key === "mixed";
  if (!qualification) {
    return driverTrack
      ? '<div class="muted">No driver qualification record is on file yet.</div>'
      : '<div class="muted">No driver record is required for this team member right now.</div>';
  }
  const rows = [
    qualification?.cdl_class || qualification?.cdl_state
      ? `CDL: ${[qualification.cdl_class, qualification.cdl_state].filter(Boolean).join(" ")}${qualification?.cdl_expiry_date ? ` | expires ${teamDateLabel(qualification.cdl_expiry_date)}` : ""}`
      : "",
    qualification?.medical_certificate_expiry
      ? `Med card: expires ${teamDateLabel(qualification.medical_certificate_expiry)}`
      : "",
    qualification?.last_mvr_check_date || qualification?.mvr_status
      ? `MVR: ${qualification.mvr_status || "on file"}${qualification?.last_mvr_check_date ? ` | checked ${teamDateLabel(qualification.last_mvr_check_date)}` : ""}`
      : "",
    qualification?.hos_available_driving_minutes != null
      ? `HOS available: ${teamMinutesLabel(qualification.hos_available_driving_minutes || 0)}`
      : "",
    qualification?.first_aid_certified ? "First aid: on file" : "",
    qualification?.confined_space_certified ? "Confined space: on file" : "",
    qualification?.h2s_alive_certified ? "H2S: on file" : "",
  ].filter(Boolean);
  if (!rows.length) {
    return '<div class="muted">Qualification record exists, but it still needs more detail.</div>';
  }
  const refreshBlock = refresh.needsAttention
    ? `
      <div class="detail-copy" style="margin-top:8px;">
        <span class="pill ${escapeAttr(refresh.tone)}">${escapeHtml(refresh.label)}</span>
      </div>
      <div class="detail-copy">${escapeHtml(refresh.note)}</div>
    `
    : "";
  return rows.map((row) => `<div class="detail-copy">${escapeHtml(row)}</div>`).join("") + refreshBlock;
}

function teamStepRequiresEvidence(step = {}, member = {}) {
  const key = String(step?.key || "").trim();
  const track = teamMemberRolloutTrack(member);
  const requiredKeys = track.key === "driver"
    ? ["driving", "worksite", "vactor", "ride_along"]
    : track.key === "mixed"
      ? ["driving", "ppe", "worksite", "vactor", "ride_along"]
      : ["ppe", "worksite", "ride_along"];
  return requiredKeys.includes(key);
}

function teamStepEvidenceStatus(step = {}, history = null, member = {}) {
  const timeEvidence = teamChecklistEvidenceForStep(step, history, member);
  const readinessEvidence = teamQualificationEvidenceForStep(step, member);
  const requiresEvidence = teamStepRequiresEvidence(step, member);
  const hasEvidence = !!(timeEvidence.length || readinessEvidence.length);
  const tone = requiresEvidence
    ? (hasEvidence ? "pill-good" : "pill-warn")
    : (hasEvidence ? "pill" : "pill");
  const label = requiresEvidence
    ? (hasEvidence ? "Evidence ready" : "Needs evidence")
    : (hasEvidence ? "Evidence linked" : "Office signoff");
  const note = requiresEvidence
    ? (hasEvidence
      ? "Training time or readiness records back up this signoff."
      : "Log training time or complete the matching readiness record before signing this step off.")
    : (hasEvidence
      ? "Supporting evidence is already linked."
      : "This step can be signed off from the office walkthrough.");
  return {
    timeEvidence,
    readinessEvidence,
    requiresEvidence,
    hasEvidence,
    tone,
    label,
    note,
  };
}

function renderTeamTrainingChecklistItems(profile = {}, member = {}, history = null) {
  const items = Array.isArray(profile?.items) ? profile.items : [];
  return items.map((item) => {
    const status = teamStepEvidenceStatus(item, history, member);
    const evidenceSummary = history === null
      ? '<div class="muted" style="font-size:.72rem;margin-top:4px;">Checking recent evidence...</div>'
      : `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(status.note)}</div>`;
    return `
      <label class="memory-checklist__item ${item.complete ? "memory-checklist__item--ready" : "memory-checklist__item--warn"}" style="display:block;">
        <div class="memory-checklist__title">
          <input type="checkbox" data-training-key="${escapeAttr(item.key)}"${item.complete ? " checked" : ""} style="margin-right:8px;" />
          ${escapeHtml(item.label)}
        </div>
        <div class="detail-copy memory-checklist__note">${escapeHtml(item.note)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
          <span class="pill ${status.tone}" style="font-size:.68rem;">${escapeHtml(status.label)}</span>
        </div>
        ${evidenceSummary}
        <label style="display:block;margin-top:8px;">
          <span class="muted" style="display:block;font-size:.72rem;margin-bottom:4px;">Office note</span>
          <input
            class="input"
            type="text"
            data-training-note="${escapeAttr(item.key)}"
            maxlength="160"
            placeholder="Short signoff note, observer, or context"
            value="${escapeAttr(item.completionNote || "")}"
            style="width:100%;"
          />
        </label>
        ${item.complete ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(item.completedAt ? `Signed off ${item.completedAt}` : "Signed off")}${item.completedBy ? ` | ${escapeHtml(item.completedBy)}` : ""}</div>` : ""}
      </label>
    `;
  }).join("");
}

function teamTrainingSaveValidation(profile = {}, items = {}, history = null, member = {}) {
  const previousItems = Array.isArray(profile?.items) ? profile.items : [];
  return previousItems
    .filter((item) => !item.complete && items[item.key])
    .map((item) => ({ item, status: teamStepEvidenceStatus(item, history, member) }))
    .filter(({ status }) => status.requiresEvidence && !status.hasEvidence)
    .map(({ item }) => `${item.label} still needs linked training or readiness evidence.`);
}

function teamMemberNextAction(member = {}) {
  const track = teamMemberRolloutTrack(member);
  const driver = teamMemberDriverReadiness(member);
  const training = teamTrainingSummary(member);
  const restriction = teamMemberRolloutRestriction(member);
  if (driver.label === "Driver setup needed" || driver.label === "Driver record blocked" || driver.label === "Driver follow-up") {
    return {
      label: "Finish driver setup",
      note: driver.note,
      action: "driver",
    };
  }
  if (training.label === "Training not started") {
    return {
      label: "Start onboarding walkthrough",
      note: training.note,
      action: "training",
    };
  }
  if (training.label === "Training in progress") {
    return {
      label: "Finish remaining checklist steps",
      note: training.note,
      action: "training",
    };
  }
  if (training.label === "Training refresh overdue" || training.label === "Training refresh due soon") {
    return {
      label: training.label === "Training refresh overdue" ? "Refresh stale training steps" : "Schedule the training refresh",
      note: training.note,
      action: "training",
    };
  }
  if (restriction.label === "Ride-along required" || restriction.label === "Supervised mixed-role rollout") {
    return {
      label: "Book the supervised field run",
      note: restriction.note,
      action: "training",
    };
  }
  return {
    label: track.key === "driver" ? "Ready for solo dispatch" : "Ready for dispatch",
    note: restriction.note,
    action: "crew",
  };
}

function teamTimePresetOptions(member = {}) {
  return [
    {
      key: "onboarding",
      label: "Onboarding hour",
      note: "Quick start for first-day training time.",
      defaults: teamTrainingQuickPreset(member),
    },
    {
      key: "ride_along",
      label: "Ride-along",
      note: "Use for shadowing or supervised field runs.",
      defaults: {
        ...teamTrainingQuickPreset(member),
        training_type: "ride_along",
        description: "Ride-along training and field shadow time",
        duration_minutes: 240,
      },
    },
    {
      key: "safety",
      label: "Safety meeting",
      note: "Toolbox talks, yard safety, or worksite briefings.",
      defaults: {
        purpose: "safety_meeting",
        description: "Safety meeting or worksite briefing",
        duration_minutes: 30,
        cost_bucket: "pricing_overhead",
        billable: false,
      },
    },
    {
      key: "maintenance",
      label: "Routine maintenance",
      note: "Truck service, inspection, cleanup, or prep.",
      defaults: teamMaintenanceQuickPreset(),
    },
    {
      key: "capital",
      label: "Capital work",
      note: "Use when the maintenance may affect asset basis.",
      defaults: teamMaintenanceCapitalPreset(),
    },
  ];
}

function teamTimePurposeOptions() {
  return [
    { value: "job_work", label: "Job work", note: "Direct labor tied to a customer job or order." },
    { value: "driver_training", label: "Driver training", note: "CDL, road, safety, or ride-along time that pricing needs to absorb." },
    { value: "trade_training", label: "Trade training", note: "Plumbing, hydrovac, worksite, or onboarding skill-building time." },
    { value: "maintenance", label: "Maintenance", note: "Vehicle, vactor, trailer, tool, or facility upkeep." },
    { value: "yard_shop", label: "Yard / shop", note: "Setup, cleanup, staging, fueling, and prep time." },
    { value: "safety_meeting", label: "Safety / meeting", note: "Toolbox talks, safety meetings, and compliance reviews." },
    { value: "admin_support", label: "Admin support", note: "Paperwork, support work, and internal follow-through." },
    { value: "other_paid_time", label: "Other paid time", note: "Use only when the work does not fit the categories above." },
  ];
}

function teamTimePurposeLabel(value) {
  return teamTimePurposeOptions().find((option) => option.value === value)?.label || "Time entry";
}

function teamTrainingTypeOptions() {
  return [
    { value: "cdl", label: "CDL / license" },
    { value: "driver_safety", label: "Driver safety" },
    { value: "worksite_safety", label: "Worksite safety" },
    { value: "vactor_operator", label: "Vactor operator" },
    { value: "plumbing_trade", label: "Plumber / trade skill" },
    { value: "hydrovac_field", label: "Hydrovac field work" },
    { value: "ride_along", label: "Ride-along" },
    { value: "onboarding", label: "Onboarding" },
    { value: "other", label: "Other training" },
  ];
}

function teamMaintenanceTypeOptions() {
  return [
    { value: "routine_service", label: "Routine service" },
    { value: "repair", label: "Repair" },
    { value: "tire_brake", label: "Tires / brakes" },
    { value: "fluid_filter", label: "Fluids / filters" },
    { value: "inspection", label: "Inspection" },
    { value: "cleanup", label: "Cleanup / detailing" },
    { value: "capital_improvement", label: "Capital improvement" },
    { value: "other", label: "Other maintenance" },
  ];
}

function teamAssetCategoryOptions() {
  return [
    { value: "vehicle", label: "Vehicle" },
    { value: "vactor", label: "Vactor / vac truck" },
    { value: "trailer", label: "Trailer" },
    { value: "tool", label: "Tool / equipment" },
    { value: "facility", label: "Facility / yard" },
    { value: "other", label: "Other asset" },
  ];
}

function teamCostBucketOptions() {
  return [
    { value: "pricing_overhead", label: "Covered by job pricing" },
    { value: "direct_job", label: "Direct job labor" },
    { value: "maintenance_overhead", label: "Maintenance overhead" },
    { value: "asset_basis_candidate", label: "Asset basis candidate" },
    { value: "general_overhead", label: "General overhead" },
  ];
}

function teamCostBucketLabel(value) {
  return teamCostBucketOptions().find((option) => option.value === value)?.label || "General overhead";
}

function teamDefaultCostBucket(workType = "", maintenanceType = "") {
  if (workType === "job_work") return "direct_job";
  if (workType === "maintenance") return maintenanceType === "capital_improvement" ? "asset_basis_candidate" : "maintenance_overhead";
  if (workType === "driver_training" || workType === "trade_training" || workType === "yard_shop") return "pricing_overhead";
  return "general_overhead";
}

function teamMemberLabel(member = {}) {
  return member.display_name || member.name || member.email || member.id || "Team member";
}

function teamMemberJobSummary(member = {}) {
  const keys = new Set(teamMemberAssignmentKeys(member));
  const jobs = teamWorkspaceJobs().filter((job) => (
    keys.has(String(job?.assigned_member_id || "").trim())
    || keys.has(String(job?.assigned_operator_id || "").trim())
  ));
  const active = jobs.filter((job) => ["dispatched", "in_progress"].includes(String(job?.status || "").trim().toLowerCase()));
  const blocked = jobs.filter((job) => String(job?.status || "").trim().toLowerCase() === "blocked");
  const scheduled = jobs.filter((job) => String(job?.status || "").trim().toLowerCase() === "scheduled");
  const totalEstimatedMinutes = jobs.reduce((sum, job) => sum + teamJobEstimatedMinutes(job), 0);
  const minimumBlockMinutes = Math.max(240, ...jobs.map((job) => Math.round(Number(job?.minimum_hours || 0) * 60) || 0), 240);
  const remainingMinutes = Math.max(0, minimumBlockMinutes - totalEstimatedMinutes);
  const lastFieldUpdate = jobs
    .map((job) => job?.actual_end_at || job?.actual_start_at || job?.updated_at || '')
    .filter(Boolean)
    .sort()
    .at(-1) || '';
  const blockerNotes = blocked
    .map((job) => String(job?.blocker_note || '').trim())
    .filter(Boolean);
  const hardConflict = jobs.length > 1 && totalEstimatedMinutes > minimumBlockMinutes;
  return {
    jobs,
    active,
    blocked,
    scheduled,
    totalEstimatedMinutes,
    minimumBlockMinutes,
    remainingMinutes,
    lastFieldUpdate,
    blockerNotes,
    hardConflict,
    overloaded: hardConflict || jobs.length >= 3 || active.length >= 2,
  };
}

function renderTeamRosterSummary() {
  const members = Array.isArray(TEAM_MEMBERS_CACHE) ? TEAM_MEMBERS_CACHE : [];
  const jobs = teamWorkspaceJobs();
  const activeField = jobs.filter((job) => ["dispatched", "in_progress"].includes(String(job?.status || "").trim().toLowerCase())).length;
  const unassigned = jobs.filter((job) => !String(job?.assigned_member_id || job?.assigned_operator_id || "").trim()).length;
  const overloaded = members.filter((member) => teamMemberJobSummary(member).overloaded).length;
  const remainingCapacity = members.reduce((sum, member) => sum + teamMemberJobSummary(member).remainingMinutes, 0);
  const driverSetupNeeded = members.filter((member) => teamMemberDriverReadiness(member).needsAttention).length;
  const trainingAttentionNeeded = members.filter((member) => teamTrainingSummary(member).needsAttention).length;
  const refreshAttentionNeeded = members.filter((member) => teamQualificationRefreshPressure(member).needsAttention).length;
  return `
    <div class="workspace-signal-band" style="margin-bottom:12px;">
      <div class="workspace-signal-band__item ${activeField ? "workspace-signal-band__item--good" : ""}">
        <span>In the field</span>
        <strong>${escapeHtml(String(activeField))}</strong>
        <small>${escapeHtml(activeField ? "Crew members are actively moving work right now." : "No one is marked as rolling yet.")}</small>
      </div>
      <div class="workspace-signal-band__item ${unassigned ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Unassigned jobs</span>
        <strong>${escapeHtml(String(unassigned))}</strong>
        <small>${escapeHtml(unassigned ? "These jobs still need a crew owner." : "Every visible job already has a crew owner.")}</small>
      </div>
      <div class="workspace-signal-band__item ${overloaded ? "workspace-signal-band__item--danger" : "workspace-signal-band__item--good"}">
        <span>Roster pressure</span>
        <strong>${escapeHtml(String(overloaded))}</strong>
        <small>${escapeHtml(overloaded ? "One or more crew members are carrying multiple live assignments." : "No team member currently looks overloaded from the visible jobs.")}</small>
      </div>
      <div class="workspace-signal-band__item ${remainingCapacity ? "workspace-signal-band__item--good" : "workspace-signal-band__item--warn"}">
        <span>Block capacity</span>
        <strong>${escapeHtml(teamMinutesLabel(remainingCapacity))}</strong>
        <small>${escapeHtml(remainingCapacity ? "Visible crew block time that still appears open for another compounded stop." : "No visible same-day capacity is left inside the current crew blocks.")}</small>
      </div>
      <div class="workspace-signal-band__item ${driverSetupNeeded ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Driver setup</span>
        <strong>${escapeHtml(String(driverSetupNeeded))}</strong>
        <small>${escapeHtml(driverSetupNeeded ? "Crew members still need driver docs, follow-up, or Monday rollout prep." : "Visible drivers look ready for Monday rollout from the current records.")}</small>
      </div>
      <div class="workspace-signal-band__item ${trainingAttentionNeeded ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Training</span>
        <strong>${escapeHtml(String(trainingAttentionNeeded))}</strong>
        <small>${escapeHtml(trainingAttentionNeeded ? "One or more workers still need onboarding, ride-along, or worksite walkthrough steps checked off." : "Visible workers all show a complete onboarding checklist.")}</small>
      </div>
      <div class="workspace-signal-band__item ${refreshAttentionNeeded ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Refresh</span>
        <strong>${escapeHtml(String(refreshAttentionNeeded))}</strong>
        <small>${escapeHtml(refreshAttentionNeeded ? "Qualification dates or stale reviews need follow-up before they turn into dispatch problems." : "Visible qualification records are not showing near-term refresh pressure.")}</small>
      </div>
    </div>
  `;
}

function teamReadinessRollup() {
  const members = Array.isArray(TEAM_MEMBERS_CACHE) ? TEAM_MEMBERS_CACHE : [];
  const blocked = members.filter((member) => {
    const label = teamMemberRolloutRestriction(member).label;
    return ["Restricted from solo dispatch", "Labor-only until driver setup clears", "Qualification refresh overdue", "Training refresh overdue"].includes(label);
  }).length;
  const supervised = members.filter((member) => {
    const label = teamMemberRolloutRestriction(member).label;
    return ["Ride-along required", "Supervised mixed-role rollout", "Needs supervised field day", "Refresh due soon", "Training refresh due soon"].includes(label);
  }).length;
  const recordsMissing = members.filter((member) => teamRecordEvidenceSummary(member).needsAttention).length;
  return {
    blocked,
    supervised,
    recordsMissing,
    ready: Math.max(0, members.length - blocked - supervised),
    total: members.length,
  };
}

function renderTeamReadinessSummaryCard() {
  const summary = teamReadinessRollup();
  if (!summary.total) {
    return "";
  }
  return `
    <div class="card" style="margin:0 0 12px;">
      <div class="card-hd">
        <div>
          <strong>Readiness summary</strong>
          <div class="muted">A quick office rollup of who is clear, who still needs supervised follow-through, and where records are missing.</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" type="button" onclick="exportMondayReadinessCsv()">Export Monday</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="exportTeamReadinessCsv()">Export readiness</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="exportTeamAuditCsv()">Export audit</button>
        </div>
      </div>
      <div class="card-bd">
        <div class="row row-tight" style="flex-wrap:wrap;">
          <span class="pill pill-good">${escapeHtml(`${summary.ready} ready`)}</span>
          <span class="pill pill-warn">${escapeHtml(`${summary.supervised} supervised`)}</span>
          <span class="pill pill-bad">${escapeHtml(`${summary.blocked} blocked`)}</span>
          <span class="pill">${escapeHtml(`${summary.recordsMissing} records follow-up`)}</span>
        </div>
      </div>
    </div>
  `;
}

function renderTeamRolloutBoard() {
  const members = teamMembersNeedingRollout();
  if (!members.length) {
    return `
      <div class="card" style="margin:0 0 12px;">
        <div class="card-hd">
          <div>
            <strong>Monday rollout</strong>
            <div class="muted">Drivers and crew currently look ready from the saved setup and training records.</div>
          </div>
          <span class="pill pill-good">Ready</span>
        </div>
      </div>
    `;
  }
  const blockedCount = members.filter((member) => {
    const label = teamMemberRolloutRestriction(member).label;
    return ["Restricted from solo dispatch", "Labor-only until driver setup clears", "Qualification refresh overdue", "Training refresh overdue"].includes(label);
  }).length;
  const supervisedCount = members.filter((member) => {
    const label = teamMemberRolloutRestriction(member).label;
    return ["Ride-along required", "Supervised mixed-role rollout", "Needs supervised field day", "Refresh due soon", "Training refresh due soon"].includes(label);
  }).length;
  const followThroughCount = Math.max(0, members.length - blockedCount - supervisedCount);
  return `
    <div class="card" style="margin:0 0 12px;">
      <div class="card-hd">
        <div>
          <strong>Monday rollout</strong>
          <div class="muted">Use this board to finish driver setup, onboarding, and paid training time without hunting across tabs.</div>
        </div>
        <span class="pill pill-warn">${escapeHtml(`${members.length} needing follow-up`)}</span>
      </div>
      <div class="card-bd">
        <div class="row row-tight" style="margin-bottom:10px;flex-wrap:wrap;">
          <span class="pill pill-bad">${escapeHtml(`${blockedCount} blocked`)}</span>
          <span class="pill pill-warn">${escapeHtml(`${supervisedCount} supervised`)}</span>
          <span class="pill">${escapeHtml(`${followThroughCount} follow-through`)}</span>
        </div>
        ${members.map((member) => {
          const track = teamMemberRolloutTrack(member);
          const driver = teamMemberDriverReadiness(member);
          const training = teamTrainingSummary(member);
          const restriction = teamMemberRolloutRestriction(member);
          const nextAction = teamMemberNextAction(member);
          return `
            <div class="list-item" style="padding:10px 0;">
              <div class="li-main">
                <div class="li-title">${escapeHtml(teamMemberLabel(member))}</div>
                <div class="li-sub muted" style="font-size:.78rem;">
                  <strong>${escapeHtml(nextAction.label)}</strong>
                  ${nextAction.note ? ` • ${escapeHtml(nextAction.note)}` : ""}
                </div>
              </div>
              <div class="li-meta" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
                <span class="pill">${escapeHtml(track.label)}</span>
                <span class="pill ${driver.tone}">${escapeHtml(driver.label)}</span>
                <span class="pill ${training.tone}">${escapeHtml(training.label)}</span>
                <span class="pill ${restriction.tone}">${escapeHtml(restriction.label)}</span>
                <button class="btn btn-ghost btn-sm" onclick="openTeamMemberProfileModal('${escapeAttr(member.id)}')">Profile</button>
                <button class="btn btn-ghost btn-sm" onclick="openTeamTrainingModal('${escapeAttr(member.id)}')">Training</button>
                <button class="btn btn-ghost btn-sm" onclick="openPresetTrainingTimeModal('${escapeAttr(member.id)}')">Log training time</button>
                <button class="btn btn-ghost btn-sm" onclick="openDriverSetupForTeamMember('${escapeAttr(member.id)}')">Driver setup</button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderTeamPanel() {
  const element = $("teamMembersList");
  if (!element) return;
  if (!TEAM_MEMBERS_CACHE.length) {
    element.innerHTML = '<div class="muted" style="font-size:.85rem;">No team members yet. Invite your first crew member.</div><div style="margin-top:10px;"><button class="btn btn-primary btn-sm" onclick="openInviteTeamMemberModal()">+ Invite first member</button></div>';
    renderHydrovacDriverWorkspace();
    return;
  }
  element.innerHTML = `${renderTeamRosterSummary()}${renderTeamReadinessSummaryCard()}${renderTeamRolloutBoard()}<table style="width:100%;border-collapse:collapse;font-size:.85rem;">
    <thead><tr>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Name</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Role</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Field load</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Hourly Rate</th>
      <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08);"></th>
    </tr></thead>
    <tbody>
      ${TEAM_MEMBERS_CACHE.map((member) => {
        const track = teamMemberRolloutTrack(member);
        const summary = teamMemberJobSummary(member);
        const driverReadiness = teamMemberDriverReadiness(member);
        const training = teamTrainingSummary(member);
        const restriction = teamMemberRolloutRestriction(member);
        const nextAction = teamMemberNextAction(member);
        const fieldLoad = summary.active.length
          ? `${summary.active.length} active`
          : summary.blocked.length
            ? `${summary.blocked.length} blocked`
            : summary.scheduled.length
              ? `${summary.scheduled.length} queued`
              : "Open";
        const tone = summary.overloaded
          ? "pill-bad"
          : summary.active.length
            ? "pill-on"
            : summary.blocked.length
              ? "pill-bad"
              : summary.scheduled.length
                ? "pill"
                : "pill-good";
        const note = summary.jobs.length
          ? `${summary.jobs.length} assigned job${summary.jobs.length === 1 ? "" : "s"} · ${teamMinutesLabel(summary.remainingMinutes)} left in block`
          : "No assigned jobs";
        const conflictChip = summary.hardConflict
          ? `<span class="pill pill-bad">${escapeHtml("Double-booked")}</span>`
          : summary.jobs.length > 1 && summary.remainingMinutes > 0
            ? `<span class="pill pill-warn">${escapeHtml("Can compound")}</span>`
            : "";
        const capacityTone = summary.remainingMinutes <= 0
          ? "pill-bad"
          : summary.remainingMinutes <= 60
            ? "pill-warn"
            : "pill-good";
        return `
        <tr>
          <td style="padding:8px;color:#e8e9eb;">${escapeHtml(member.display_name || member.name || member.email || member.id)}</td>
          <td style="padding:8px;color:rgba(255,255,255,.55);">${escapeHtml(member.role || "-")}</td>
          <td style="padding:8px;color:rgba(255,255,255,.55);">
            <span class="pill ${tone}">${escapeHtml(fieldLoad)}</span>
            <div class="muted" style="font-size:.72rem;margin-top:4px;"><span class="pill">${escapeHtml(track.label)}</span></div>
            <div class="muted" style="font-size:.72rem;margin-top:4px;"><span class="pill ${driverReadiness.tone}">${escapeHtml(driverReadiness.label)}</span></div>
            <div class="muted" style="font-size:.72rem;margin-top:4px;"><span class="pill ${training.tone}">${escapeHtml(training.label)}</span></div>
            <div class="muted" style="font-size:.72rem;margin-top:4px;"><span class="pill ${restriction.tone}">${escapeHtml(restriction.label)}</span></div>
            ${conflictChip ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${conflictChip}</div>` : ""}
            <div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(note)}</div>
            <div class="muted" style="font-size:.72rem;margin-top:4px;"><strong>${escapeHtml(`Next: ${nextAction.label}`)}</strong></div>
            <div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(driverReadiness.note)}</div>
            <div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(training.note)}</div>
            <div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(restriction.note)}</div>
            ${summary.jobs.length ? `<div class="muted" style="font-size:.72rem;margin-top:4px;"><span class="pill ${capacityTone}">${escapeHtml(`${teamMinutesLabel(summary.totalEstimatedMinutes)} planned / ${teamMinutesLabel(summary.minimumBlockMinutes)} block`)}</span></div>` : ""}
            ${summary.lastFieldUpdate ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(`Last field update ${summary.lastFieldUpdate}`)}</div>` : ""}
            ${summary.blockerNotes[0] ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(`Blocker: ${summary.blockerNotes[0]}`)}</div>` : ""}
          </td>
          <td style="padding:8px;color:rgba(255,255,255,.55);">
            ${teamMemberDisplayedRateCents(member) ? `${formatUsd(teamMemberDisplayedRateCents(member))}/hr` : "-"}
            ${teamMemberCompensationNote(member) ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(teamMemberCompensationNote(member))}</div>` : ""}
          </td>
          <td style="padding:8px;text-align:right;display:flex;gap:6px;justify-content:flex-end;">
            <button class="btn btn-ghost" style="font-size:.72rem;" onclick="openTeamMemberProfileModal('${escapeAttr(member.id)}')">Profile</button>
            <button class="btn btn-ghost" style="font-size:.72rem;" onclick="openTeamTimeModal('${escapeAttr(member.id)}')">Log time</button>
            <button class="btn btn-ghost" style="font-size:.72rem;" onclick="openTeamTrainingModal('${escapeAttr(member.id)}')">Training</button>
            <button class="btn btn-ghost" style="font-size:.72rem;" onclick="openDriverSetupForTeamMember('${escapeAttr(member.id)}')">Driver setup</button>
            <button class="btn btn-ghost" style="font-size:.72rem;" onclick="openCrewPortalForTeamMember('${escapeAttr(member.id)}')">Crew portal</button>
            <button class="btn btn-ghost" style="font-size:.72rem;" onclick="openEditTeamMemberModal('${escapeAttr(member.id)}')">Edit</button>
            <button class="btn btn-ghost" style="font-size:.72rem;" onclick="removeTeamMember('${escapeAttr(member.id)}')">Remove</button>
          </td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
  <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07);">
    <a href="/crew/" target="_blank" rel="noopener" style="font-size:.8rem;color:rgba(255,255,255,.45);text-decoration:none;display:inline-flex;align-items:center;gap:5px;transition:color .15s;" onmouseover="this.style.color='rgba(255,255,255,.75)'" onmouseout="this.style.color='rgba(255,255,255,.45)'">Open crew app &#8599;</a>
  </div>`;
  renderHydrovacDriverWorkspace();
}

function findTeamMemberById(memberId) {
  return (Array.isArray(TEAM_MEMBERS_CACHE) ? TEAM_MEMBERS_CACHE : []).find((member) => String(member?.id || '') === String(memberId || '')) || null;
}

function openInviteTeamMemberModal() {
  const existing = document.getElementById("inviteTeamModal");
  if (existing) {
    existing.remove();
    return;
  }
  const modal = document.createElement("div");
  modal.id = "inviteTeamModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;";
  modal.innerHTML = `
    <div style="background:#1e2029;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <h3 style="margin:0 0 18px;font-size:1rem;color:#e8e9eb;">Invite team member</h3>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px;">
        <input id="tmEmail" class="input" placeholder="Email *" type="email" style="width:100%;" />
        <input id="tmName" class="input" placeholder="Display name" style="width:100%;" />
        <select id="tmRole" class="input" style="width:100%;">
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="member" selected>Member</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="document.getElementById('inviteTeamModal').remove()" class="btn btn-ghost">Cancel</button>
        <button id="tmSave" class="btn btn-primary">Send invite</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById("tmSave").onclick = async () => {
    const email = String(document.getElementById("tmEmail")?.value || "").trim();
    if (!email) {
      notifyOperator("Add an email address first.");
      return;
    }
    const button = document.getElementById("tmSave");
    button.disabled = true;
    button.textContent = "Sending...";
    try {
      const response = await fetch("/.netlify/functions/manage-operator-members", {
        method: "POST",
        headers: await getTeamWorkspaceAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          email,
          name: document.getElementById("tmName")?.value || undefined,
          role: document.getElementById("tmRole")?.value || "member",
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Failed");
      showToast("Invite sent.");
      modal.remove();
      await fetchTeamMembers();
    } catch (error) {
      showToast(`Error: ${error.message}`);
      button.disabled = false;
      button.textContent = "Send invite";
    }
  };
}

function openDriverSetupForTeamMember(id) {
  ACTIVE_DRIVER_QUAL_MEMBER_ID = id || null;
  renderHydrovacDriverWorkspace();
  switchTab("compliance");
}

function openCrewPortalForTeamMember(id) {
  const member = findTeamMemberById(id);
  const targetId = String(member?.id || member?.operator_id || member?.user_id || "").trim();
  const target = targetId
    ? `/crew/?member=${encodeURIComponent(targetId)}&source=operator`
    : "/crew/?source=operator";
  if (window?.open) {
    window.open(target, "_blank", "noopener");
    return;
  }
  window.location.href = target;
}

function openTeamMemberProfileModal(id) {
  const member = findTeamMemberById(id);
  if (!member) {
    showToast("Team member not found.");
    return;
  }
  const existing = document.getElementById("teamMemberProfileModal");
  if (existing) existing.remove();
  const track = teamMemberRolloutTrack(member);
  const driver = teamMemberDriverReadiness(member);
  const training = teamTrainingSummary(member);
  const restriction = teamMemberRolloutRestriction(member);
  const trainingProfile = teamTrainingProfile(member);
  const modal = document.createElement("div");
  modal.id = "teamMemberProfileModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal-box" style="max-width:760px;">
    <h3 style="margin:0 0 6px;font-size:1rem;">${escapeHtml(teamMemberLabel(member))}</h3>
    <div class="muted" style="margin-bottom:12px;">One place to review role, pay, readiness, onboarding, and recent tracked time.</div>
    <div class="row row-tight" style="margin-bottom:12px;flex-wrap:wrap;">
      <span class="pill">${escapeHtml(member.role || "member")}</span>
      <span class="pill ${driver.tone}">${escapeHtml(driver.label)}</span>
      <span class="pill ${training.tone}">${escapeHtml(training.label)}</span>
      ${teamProfileSummaryChips(member).map((chip) => `<span class="pill">${escapeHtml(chip)}</span>`).join("")}
    </div>
      <div class="modal-grid-2">
        <div class="card">
          <div class="card-hd"><strong>Role and compensation</strong></div>
          <div class="card-bd">
          <div class="detail-copy"><strong>Rate:</strong> ${escapeHtml(teamMemberDisplayedRateCents(member) ? `${formatUsd(teamMemberDisplayedRateCents(member))}/hr` : "Not set")}</div>
          <div class="detail-copy"><strong>Rollout track:</strong> ${escapeHtml(track.label)}</div>
          <div class="detail-copy"><strong>Next move:</strong> ${escapeHtml(teamMemberNextAction(member).label)}</div>
          <div class="detail-copy"><strong>Restriction:</strong> ${escapeHtml(restriction.label)}</div>
          <div class="detail-copy"><strong>Pay context:</strong> ${escapeHtml(teamMemberCompensationNote(member) || "No union-floor note is attached yet.")}</div>
          <div class="detail-copy"><strong>Track context:</strong> ${escapeHtml(track.note)}</div>
          <div class="detail-copy"><strong>Driver readiness:</strong> ${escapeHtml(driver.note)}</div>
          <div class="detail-copy"><strong>Training readiness:</strong> ${escapeHtml(training.note)}</div>
          <div class="detail-copy"><strong>Dispatch note:</strong> ${escapeHtml(restriction.note)}</div>
        </div>
      </div>
        <div class="card">
          <div class="card-hd"><strong>Quick actions</strong></div>
          <div class="card-bd" style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-ghost btn-sm" type="button" id="btnProfileExport">Export profile</button>
            <button class="btn btn-ghost btn-sm" type="button" id="btnProfileTraining">Training</button>
            <button class="btn btn-ghost btn-sm" type="button" id="btnProfileRecords">Records</button>
            <button class="btn btn-ghost btn-sm" type="button" id="btnProfileTrainingTime">Log training time</button>
            <button class="btn btn-ghost btn-sm" type="button" id="btnProfileMaintenance">Log maintenance</button>
            <button class="btn btn-ghost btn-sm" type="button" id="btnProfileDriver">Driver setup</button>
            <button class="btn btn-ghost btn-sm" type="button" id="btnProfileCrew">Crew portal</button>
            <button class="btn btn-ghost btn-sm" type="button" id="btnProfileEdit">Edit member</button>
        </div>
      </div>
    </div>
      <div class="card" style="margin-top:12px;">
        <div class="card-hd"><strong>Driver qualification snapshot</strong></div>
        <div class="card-bd">
          ${renderDriverQualificationSnapshot(member)}
        </div>
      </div>
        <div class="card" style="margin-top:12px;">
          <div class="card-hd"><strong>Readiness gates</strong></div>
          <div class="card-bd" id="teamProfileReadiness">
            ${renderTeamReadinessGates(member, null, trainingProfile)}
          </div>
        </div>
      <div class="card" style="margin-top:12px;">
        <div class="card-hd"><strong>Office records</strong></div>
        <div class="card-bd" id="teamProfileRecords">
          ${renderTeamRecordEvidence(member)}
        </div>
      </div>
      <div class="card" style="margin-top:12px;">
        <div class="card-hd"><strong>Checklist history</strong></div>
        <div class="card-bd">
          ${renderTrainingChecklistHistory(trainingProfile)}
        </div>
    </div>
    <div class="card" style="margin-top:12px;">
      <div class="card-hd"><strong>Training evidence</strong></div>
      <div class="card-bd" id="teamProfileEvidence">
        <div class="muted">Matching recent training time to completed checklist steps...</div>
      </div>
    </div>
    <div class="card" style="margin-top:12px;">
      <div class="card-hd"><strong>Timeline</strong></div>
      <div class="card-bd" id="teamProfileTimeline">
        <div class="muted">Building timeline from onboarding, readiness, and recent activity...</div>
      </div>
    </div>
    <div class="card" style="margin-top:12px;">
      <div class="card-hd"><strong>Recent activity</strong></div>
      <div class="card-bd" id="teamProfileHistory">
        <div class="muted">Loading recent time and job history...</div>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
      <button class="btn btn-ghost" type="button" onclick="document.getElementById('teamMemberProfileModal')?.remove()">Close</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const historyState = {
    loaded: false,
    value: null,
    request: null,
  };
  const ensureHistoryLoaded = async () => {
    if (historyState.loaded) return historyState.value;
    if (!historyState.request) {
      historyState.request = fetchTeamMemberHistory(member)
        .then((history) => {
          historyState.loaded = true;
          historyState.value = history;
          return history;
        })
        .catch((error) => {
          historyState.loaded = true;
          historyState.value = null;
          throw error;
        });
    }
    return historyState.request;
  };
  modal.querySelector("#btnProfileExport").onclick = async () => {
    try {
      const history = await ensureHistoryLoaded();
      exportTeamMemberProfileCsv(member, history, trainingProfile);
    } catch (error) {
      showToast(error.message || "Profile export could not be prepared.");
    }
  };
  modal.querySelector("#btnProfileTraining").onclick = () => {
    modal.remove();
    openTeamTrainingModal(member.id);
  };
  modal.querySelector("#btnProfileRecords").onclick = () => {
    modal.remove();
    openTeamRecordEvidenceModal(member.id);
  };
  modal.querySelector("#btnProfileTrainingTime").onclick = () => {
    modal.remove();
    openPresetTrainingTimeModal(member.id);
  };
  modal.querySelector("#btnProfileMaintenance").onclick = () => {
    modal.remove();
    openTeamTimeModal(member.id, teamMaintenanceQuickPreset());
  };
  modal.querySelector("#btnProfileDriver").onclick = () => {
    modal.remove();
    openDriverSetupForTeamMember(member.id);
  };
  modal.querySelector("#btnProfileCrew").onclick = () => {
    openCrewPortalForTeamMember(member.id);
  };
  modal.querySelector("#btnProfileEdit").onclick = () => {
    modal.remove();
    openEditTeamMemberModal(member.id);
  };
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
  ensureHistoryLoaded()
      .then((history) => {
        const historyEl = modal.querySelector("#teamProfileHistory");
        if (historyEl) historyEl.innerHTML = renderTeamHistorySnapshot(member, history);
        const readinessEl = modal.querySelector("#teamProfileReadiness");
        if (readinessEl) readinessEl.innerHTML = renderTeamReadinessGates(member, history, trainingProfile);
        const evidenceEl = modal.querySelector("#teamProfileEvidence");
        if (evidenceEl) evidenceEl.innerHTML = renderTrainingEvidenceSnapshot(trainingProfile, history, member);
        const timelineEl = modal.querySelector("#teamProfileTimeline");
        if (timelineEl) timelineEl.innerHTML = renderTeamTimeline(member, history, trainingProfile);
      })
    .catch((error) => {
      const historyEl = modal.querySelector("#teamProfileHistory");
      if (historyEl) historyEl.innerHTML = `<div class="msg error">${escapeHtml(error.message || String(error))}</div>`;
      const evidenceEl = modal.querySelector("#teamProfileEvidence");
      if (evidenceEl) evidenceEl.innerHTML = `<div class="msg error">${escapeHtml(error.message || String(error))}</div>`;
      const timelineEl = modal.querySelector("#teamProfileTimeline");
      if (timelineEl) timelineEl.innerHTML = `<div class="msg error">${escapeHtml(error.message || String(error))}</div>`;
    });
}

function openEditTeamMemberModal(id) {
  const member = findTeamMemberById(id) || {};
  const currentRole = member.role || 'member';
  const currentRateCents = Number(member.hourly_rate_cents || 0);
  const existing = document.getElementById("editTeamModal");
  if (existing) existing.remove();
  const modal = document.createElement("div");
  modal.id = "editTeamModal";
  modal.className = "modal-overlay";
  const roles = ["owner", "admin", "member", "viewer"];
  modal.innerHTML = `<div class="modal-box" style="max-width:340px;">
    <h3 style="margin:0 0 16px;font-size:1rem;">Edit Team Member</h3>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Role</label>
    <select id="tmEditRole" class="input" style="margin-bottom:12px;width:100%;">
      ${roles.map((role) => `<option value="${role}"${role === currentRole ? " selected" : ""}>${role}</option>`).join("")}
    </select>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Hourly Rate ($/hr)</label>
    <input id="tmEditRate" class="input" type="number" min="0" step="0.01" style="margin-bottom:16px;width:100%;" value="${currentRateCents ? (currentRateCents / 100).toFixed(2) : ""}">
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Worker label</label>
    <input id="tmEditWorkerLabel" class="input" style="margin-bottom:12px;width:100%;" value="${escapeAttr(member.worker_label || "")}">
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Driver label</label>
    <input id="tmEditDriverLabel" class="input" style="margin-bottom:12px;width:100%;" value="${escapeAttr(member.driver_label || "")}">
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Union local</label>
    <input id="tmEditUnionLocal" class="input" style="margin-bottom:12px;width:100%;" value="${escapeAttr(member.union_local_number || "")}">
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Union classification</label>
    <input id="tmEditUnionClassification" class="input" style="margin-bottom:12px;width:100%;" value="${escapeAttr(member.union_classification_label || "")}">
    <label style="display:flex;align-items:center;gap:8px;font-size:.8rem;color:rgba(255,255,255,.55);margin-bottom:16px;">
      <input id="tmEditUnionMember" type="checkbox"${member.is_union_member ? " checked" : ""}>
      <span>Union member</span>
    </label>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-ghost" onclick="document.getElementById('editTeamModal')?.remove()">Cancel</button>
      <button class="btn btn-primary" id="tmEditSave">Save</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#tmEditSave").onclick = async () => {
    const role = document.getElementById("tmEditRole")?.value;
    const rate = parseFloat(document.getElementById("tmEditRate")?.value || "0");
    const workerLabel = String(document.getElementById("tmEditWorkerLabel")?.value || "").trim();
    const driverLabel = String(document.getElementById("tmEditDriverLabel")?.value || "").trim();
    const unionLocalNumber = String(document.getElementById("tmEditUnionLocal")?.value || "").trim();
    const unionClassificationLabel = String(document.getElementById("tmEditUnionClassification")?.value || "").trim();
    const isUnionMember = !!document.getElementById("tmEditUnionMember")?.checked;
    try {
      const response = await fetch("/.netlify/functions/manage-operator-members", {
        method: "PATCH",
        headers: await getTeamWorkspaceAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          id,
          role,
          hourly_rate_cents: Math.round(rate * 100),
          worker_label: workerLabel || null,
          driver_label: driverLabel || null,
          union_local_number: unionLocalNumber || null,
          union_classification_label: unionClassificationLabel || null,
          is_union_member: isUnionMember,
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Failed");
      modal.remove();
      await fetchTeamMembers();
      showToast("Member updated.");
    } catch (error) {
      showToast(`Error: ${error.message}`);
    }
  };
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
}

async function removeTeamMember(id) {
  if (!(await showConfirmModal("Remove this team member?", "Remove", "Cancel"))) return;
  try {
    const response = await fetch(`/.netlify/functions/manage-operator-members?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: await getTeamWorkspaceAuthHeaders(),
    });
    if (!response.ok) throw new Error((await response.json()).error || "Failed");
    TEAM_MEMBERS_CACHE = TEAM_MEMBERS_CACHE.filter((member) => member.id !== id);
    renderTeamPanel();
    showToast("Team member removed.");
  } catch (error) {
    showToast(`Error: ${error.message}`);
  }
}

async function saveTeamTrainingProfile(member = {}, nextProfile = {}) {
  const response = await fetch('/.netlify/functions/update-tenant-config', {
    method: 'POST',
    headers: await getTeamWorkspaceAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      tenant_id: TENANT_ID,
      config: {
        team_training_profiles: {
          ...teamTrainingProfiles(),
          [String(member?.id || "").trim()]: nextProfile,
        },
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to save training checklist.');
  const setupState = typeof SETUP_STATE !== "undefined" ? SETUP_STATE : {};
  SETUP_STATE = {
    ...setupState,
    config: {
      ...(setupState?.config || {}),
      ...(data.config || {}),
    },
  };
  return data.config?.team_training_profiles || {};
}

function buildTeamTrainingProfilePayload(member = {}, updates = {}) {
  const profiles = teamTrainingProfiles();
  const existing = profiles[String(member?.id || "").trim()] || {};
  return {
    ...existing,
    ...updates,
  };
}

function buildTeamRecordEvidencePayload(member = {}, fields = {}) {
  const existing = teamTrainingProfiles()[String(member?.id || "").trim()] || {};
  return {
    ...existing,
    record_evidence: {
      ...(existing?.record_evidence && typeof existing.record_evidence === "object" ? existing.record_evidence : {}),
      ...fields,
    },
  };
}

function openTeamRecordEvidenceModal(id) {
  const member = findTeamMemberById(id);
  if (!member) {
    showToast("Team member not found.");
    return;
  }
  const existing = document.getElementById("teamRecordEvidenceModal");
  if (existing) existing.remove();
  const profile = teamRecordEvidenceProfile(member);
  const modal = document.createElement("div");
  modal.id = "teamRecordEvidenceModal";
  modal.className = "modal-overlay";
  modal.innerHTML = `<div class="modal-box" style="max-width:560px;">
    <h3 style="margin:0 0 8px;font-size:1rem;">${escapeHtml(teamMemberLabel(member))} office records</h3>
    <div class="muted" style="margin-bottom:12px;">Mark which core records are on file so rollout and audit views stay honest without turning the office into a document-management team.</div>
    <div class="memory-checklist">
      ${profile.items.map((item) => `
        <label class="memory-checklist__item ${item.present ? "memory-checklist__item--ready" : "memory-checklist__item--warn"}" style="display:block;">
          <div class="memory-checklist__title">
            <input type="checkbox" data-record-key="${escapeAttr(item.key)}"${item.present ? " checked" : ""} style="margin-right:8px;" />
            ${escapeHtml(item.label)}
          </div>
          <div class="detail-copy memory-checklist__note">${escapeHtml(item.note)}</div>
          <label style="display:block;margin-top:8px;">
            <span class="muted" style="display:block;font-size:.72rem;margin-bottom:4px;">Office note</span>
            <input
              class="input"
              type="text"
              data-record-note="${escapeAttr(item.key)}"
              maxlength="160"
              placeholder="Where the record lives or any quick context"
              value="${escapeAttr(item.noteValue || "")}"
              style="width:100%;"
            />
          </label>
          ${item.present ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(item.recordedAt ? `Marked on file ${teamDateLabel(item.recordedAt)}` : "Marked on file")}${item.recordedBy ? ` | ${escapeHtml(item.recordedBy)}` : ""}</div>` : ""}
        </label>
      `).join("")}
    </div>
    <div id="teamRecordEvidenceMsg" class="msg" style="margin-top:10px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn btn-ghost" type="button" onclick="document.getElementById('teamRecordEvidenceModal')?.remove()">Cancel</button>
      <button class="btn btn-primary" type="button" id="btnSaveTeamRecordEvidence">Save records</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#btnSaveTeamRecordEvidence").onclick = async () => {
    const messageEl = modal.querySelector("#teamRecordEvidenceMsg");
    const operatorLabel = getTeamCurrentOperatorLabel();
    const recordEvidence = {};
    profile.items.forEach((item) => {
      const present = !!modal.querySelector(`[data-record-key="${item.key}"]`)?.checked;
      const note = String(modal.querySelector(`[data-record-note="${item.key}"]`)?.value || "").trim();
      if (!present) return;
      recordEvidence[item.key] = item.recordedAt
        ? {
            present: true,
            recorded_at: item.recordedAt,
            recorded_by: item.recordedBy || operatorLabel,
            note,
          }
        : {
            present: true,
            recorded_at: new Date().toISOString(),
            recorded_by: operatorLabel,
            note,
          };
    });
    setInlineMessage(messageEl, "Saving office record status...");
    try {
      await saveTeamTrainingProfile(member, buildTeamRecordEvidencePayload(member, recordEvidence));
      renderTeamPanel();
      modal.remove();
      showToast("Office records saved.");
    } catch (error) {
      setInlineMessage(messageEl, error.message || String(error), "error");
    }
  };
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
}

function openTeamTrainingModal(id) {
  const member = findTeamMemberById(id);
  if (!member) {
    showToast("Team member not found.");
    return;
  }
  const existing = document.getElementById("teamTrainingModal");
  if (existing) existing.remove();
  const profile = teamTrainingProfile(member);
  const track = teamMemberRolloutTrack(member);
  const restriction = teamMemberRolloutRestriction(member);
  const modal = document.createElement("div");
  modal.id = "teamTrainingModal";
  modal.className = "modal-overlay";
  const nextAction = teamMemberNextAction(member);
  modal.innerHTML = `<div class="modal-box" style="max-width:520px;">
    <h3 style="margin:0 0 8px;font-size:1rem;">${escapeHtml(teamMemberLabel(member))} onboarding</h3>
    <div class="muted" style="margin-bottom:12px;">${escapeHtml(track.key === "driver" ? "Driver / vactor operator rollout checklist" : track.key === "mixed" ? "Mixed-role rollout checklist" : "Labor / field onboarding checklist")}</div>
    <div class="card" style="margin-bottom:12px;">
      <div class="card-bd" style="padding:12px;">
        <div class="row row-tight" style="margin-bottom:8px;flex-wrap:wrap;">
          <span class="pill">${escapeHtml(track.label)}</span>
          <span class="pill ${restriction.tone}">${escapeHtml(restriction.label)}</span>
        </div>
        <div class="kicker">Recommended next move</div>
        <strong>${escapeHtml(nextAction.label)}</strong>
        <div class="muted" style="margin-top:6px;">${escapeHtml(nextAction.note)}</div>
        <div class="muted" style="margin-top:6px;">${escapeHtml(restriction.note)}</div>
      </div>
    </div>
    <div class="memory-checklist" id="teamTrainingChecklist">
      ${renderTeamTrainingChecklistItems(profile, member, null)}
    </div>
    <label style="display:block;margin-top:12px;">
      <span style="display:block;font-size:.8rem;color:rgba(255,255,255,.55);margin-bottom:6px;">Training notes</span>
      <textarea id="teamTrainingNotes" class="input" rows="4" style="width:100%;">${escapeHtml(profile.notes || "")}</textarea>
    </label>
    <div id="teamTrainingMsg" class="msg" style="margin-top:10px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn btn-ghost" type="button" onclick="document.getElementById('teamTrainingModal')?.remove()">Cancel</button>
      <button class="btn btn-ghost" type="button" id="btnTeamTrainingLogTime">Log training time</button>
      <button class="btn btn-primary" type="button" id="btnSaveTeamTraining">Save training</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const historyState = {
    loaded: false,
    value: null,
    request: null,
  };
  const renderChecklist = () => {
    const checklistEl = modal.querySelector("#teamTrainingChecklist");
    if (checklistEl) checklistEl.innerHTML = renderTeamTrainingChecklistItems(profile, member, historyState.loaded ? historyState.value : null);
  };
  const ensureHistoryLoaded = async () => {
    if (historyState.loaded) return historyState.value;
    if (!historyState.request) {
      historyState.request = fetchTeamMemberHistory(member)
        .then((history) => {
          historyState.loaded = true;
          historyState.value = history;
          renderChecklist();
          return history;
        })
        .catch((error) => {
          historyState.loaded = true;
          historyState.value = null;
          const messageEl = modal.querySelector("#teamTrainingMsg");
          if (messageEl) setInlineMessage(messageEl, `Recent evidence could not be loaded. Qualification records can still support signoff. ${error.message || String(error)}`, "warn");
          renderChecklist();
          return null;
        });
    }
    return historyState.request;
  };
  ensureHistoryLoaded().catch(() => null);
  modal.querySelector("#btnTeamTrainingLogTime").onclick = () => {
    modal.remove();
    openTeamTimeModal(member.id, teamTrainingQuickPreset(member));
  };
  modal.querySelector("#btnSaveTeamTraining").onclick = async () => {
    const messageEl = modal.querySelector("#teamTrainingMsg");
    const previousItems = profile.items || [];
    const previousMeta = profile.itemMeta || {};
    const items = Object.fromEntries(
      profile.items.map((item) => [
        item.key,
        !!modal.querySelector(`[data-training-key="${item.key}"]`)?.checked,
      ])
    );
    const operatorLabel = getTeamCurrentOperatorLabel();
    const itemMeta = {};
    previousItems.forEach((item) => {
      const nextComplete = !!items[item.key];
      const completionNote = String(modal.querySelector(`[data-training-note="${item.key}"]`)?.value || "").trim();
      if (!nextComplete) return;
      const existingMeta = previousMeta?.[item.key];
      itemMeta[item.key] = existingMeta && existingMeta.completed_at
        ? {
            ...existingMeta,
            completion_note: completionNote || existingMeta.completion_note || "",
          }
        : {
            completed_at: new Date().toISOString(),
            completed_by: operatorLabel,
            completion_note: completionNote,
          };
    });
    const allComplete = Object.values(items).every(Boolean);
    setInlineMessage(messageEl, "Saving training checklist...");
    try {
      const history = await ensureHistoryLoaded();
      const validationIssues = teamTrainingSaveValidation(profile, items, history, member);
      if (validationIssues.length) {
        setInlineMessage(messageEl, validationIssues.join(" "), "error");
        return;
      }
        await saveTeamTrainingProfile(member, buildTeamTrainingProfilePayload(member, {
          items,
          item_meta: itemMeta,
          notes: String(modal.querySelector("#teamTrainingNotes")?.value || "").trim(),
          completed_at: allComplete ? new Date().toISOString() : "",
          role_snapshot: {
          role: member.role || "",
            worker_label: member.worker_label || "",
            driver_label: member.driver_label || "",
          },
        }));
      renderTeamPanel();
      modal.remove();
      showToast("Training checklist saved.");
    } catch (error) {
      setInlineMessage(messageEl, error.message || String(error), "error");
    }
  };
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
}

function openTeamTimeModal(defaultMemberId = "", defaults = {}) {
  const members = Array.isArray(TEAM_MEMBERS_CACHE) ? TEAM_MEMBERS_CACHE : [];
  if (!members.length) {
    showToast("Add a team member before logging training or maintenance time.");
    return;
  }
  const existing = document.getElementById("teamTimeModal");
  if (existing) existing.remove();
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const defaultStarted = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const modal = document.createElement("div");
  modal.id = "teamTimeModal";
  modal.className = "modal-overlay";
  const defaultPresetButtons = teamTimePresetOptions(findTeamMemberById(defaultMemberId || "") || {});
  modal.innerHTML = `<div class="modal-box" style="max-width:560px;">
    <h3 style="margin:0 0 8px;font-size:1rem;">Log training or maintenance time</h3>
    <div class="muted" style="margin-bottom:12px;">Track the labor you expect pricing to carry without making the crew think like accountants.</div>
    <div class="card" style="margin-bottom:12px;">
      <div class="card-bd" style="padding:12px;">
        <div class="kicker">Quick starts</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
          ${defaultPresetButtons.map((preset) => `<button type="button" class="btn btn-ghost btn-sm" data-team-time-preset="${escapeAttr(preset.key)}">${escapeHtml(preset.label)}</button>`).join("")}
        </div>
        <div class="muted" style="font-size:.76rem;margin-top:8px;">${escapeHtml(defaultPresetButtons.map((preset) => `${preset.label}: ${preset.note}`).join(" | "))}</div>
      </div>
    </div>
    <div class="modal-stack">
      <label>
        <span class="section-heading-note">Team member</span>
        <select id="teamTimeMember" class="input" style="width:100%;">
          ${members.map((member) => `<option value="${escapeAttr(member.id)}"${String(defaultMemberId || "") === String(member.id) ? " selected" : ""}>${escapeHtml(teamMemberLabel(member))}</option>`).join("")}
        </select>
      </label>
      <label>
        <span class="section-heading-note">Time purpose</span>
        <select id="teamTimePurpose" class="input" style="width:100%;">
          ${teamTimePurposeOptions().map((option) => `<option value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
      <div id="teamTimePurposeNote" class="muted" style="font-size:.8rem;"></div>
      <label id="teamTrainingTypeWrap" style="display:none;">
        <span class="section-heading-note">Training type</span>
        <select id="teamTrainingType" class="input" style="width:100%;">
          ${teamTrainingTypeOptions().map((option) => `<option value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
        </select>
      </label>
      <div id="teamMaintenanceFields" style="display:none;">
        <label>
          <span class="section-heading-note">Maintenance type</span>
          <select id="teamMaintenanceType" class="input" style="width:100%;">
            ${teamMaintenanceTypeOptions().map((option) => `<option value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
        <div class="modal-grid-2" style="margin-top:10px;">
          <label class="modal-grid-2__fill">
            <span class="section-heading-note">Asset category</span>
            <select id="teamAssetCategory" class="input" style="width:100%;">
              ${teamAssetCategoryOptions().map((option) => `<option value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
          <label class="modal-grid-2__fill">
            <span class="section-heading-note">Asset label</span>
            <input id="teamAssetLabel" class="input" placeholder="Truck 12, Vactor 4, trailer, tool..." style="width:100%;" />
          </label>
        </div>
      </div>
      <label>
        <span class="section-heading-note">Description</span>
        <input id="teamTimeDescription" class="input" placeholder="What was covered or worked on?" style="width:100%;" />
      </label>
      <div class="modal-grid-2">
        <label class="modal-grid-2__fill">
          <span class="section-heading-note">Started at</span>
          <input id="teamTimeStartedAt" type="datetime-local" class="input" value="${defaultStarted}" style="width:100%;" />
        </label>
        <label class="modal-grid-2__fill">
          <span class="section-heading-note">Duration (minutes)</span>
          <input id="teamTimeDuration" type="number" min="1" step="1" class="input" placeholder="60" style="width:100%;" />
        </label>
      </div>
      <div class="modal-grid-2">
        <label class="modal-grid-2__fill">
          <span class="section-heading-note">Hourly rate ($)</span>
          <input id="teamTimeRate" type="number" min="0" step="0.01" class="input" placeholder="42.50" style="width:100%;" />
        </label>
        <label class="modal-grid-2__fill">
          <span class="section-heading-note">Cost treatment</span>
          <select id="teamTimeCostBucket" class="input" style="width:100%;">
            ${teamCostBucketOptions().map((option) => `<option value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
      </div>
      <label class="modal-check">
        <input id="teamTimeBillable" class="modal-check__input" type="checkbox" />
        <span class="modal-check__label">Bill directly to a job or order</span>
      </label>
      <div class="muted" style="font-size:.8rem;">Leave this off for training, maintenance, and support time that your pricing needs to absorb across jobs.</div>
    </div>
    <div id="teamTimeMsg" class="msg" style="margin-top:10px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
      <button class="btn btn-ghost" type="button" onclick="document.getElementById('teamTimeModal')?.remove()">Cancel</button>
      <button class="btn btn-primary" type="button" id="btnSaveTeamTime">Save time</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const purposeEl = modal.querySelector("#teamTimePurpose");
  const trainingWrap = modal.querySelector("#teamTrainingTypeWrap");
  const maintenanceWrap = modal.querySelector("#teamMaintenanceFields");
  const maintenanceTypeEl = modal.querySelector("#teamMaintenanceType");
  const costBucketEl = modal.querySelector("#teamTimeCostBucket");
  const billableEl = modal.querySelector("#teamTimeBillable");
  const rateEl = modal.querySelector("#teamTimeRate");
  const memberEl = modal.querySelector("#teamTimeMember");
  const noteEl = modal.querySelector("#teamTimePurposeNote");
  const trainingTypeEl = modal.querySelector("#teamTrainingType");
  const assetCategoryEl = modal.querySelector("#teamAssetCategory");
  const assetLabelEl = modal.querySelector("#teamAssetLabel");
  const descriptionEl = modal.querySelector("#teamTimeDescription");
  const durationEl = modal.querySelector("#teamTimeDuration");
  const startedAtEl = modal.querySelector("#teamTimeStartedAt");

  function applyTimeDefaults(nextDefaults = {}) {
    if (!nextDefaults || typeof nextDefaults !== "object") return;
    if (nextDefaults.purpose && purposeEl) purposeEl.value = String(nextDefaults.purpose);
    if (nextDefaults.training_type && trainingTypeEl) trainingTypeEl.value = String(nextDefaults.training_type);
    if (nextDefaults.maintenance_type && maintenanceTypeEl) maintenanceTypeEl.value = String(nextDefaults.maintenance_type);
    if (nextDefaults.asset_category && assetCategoryEl) assetCategoryEl.value = String(nextDefaults.asset_category);
    if (nextDefaults.asset_label !== undefined && assetLabelEl) assetLabelEl.value = String(nextDefaults.asset_label || "");
    if (nextDefaults.description && descriptionEl) descriptionEl.value = String(nextDefaults.description);
    if (nextDefaults.duration_minutes && durationEl) durationEl.value = String(nextDefaults.duration_minutes);
    if (nextDefaults.started_at && startedAtEl) startedAtEl.value = String(nextDefaults.started_at);
    syncPurposeFields();
    if (nextDefaults.cost_bucket && costBucketEl) costBucketEl.value = String(nextDefaults.cost_bucket);
    if (Object.prototype.hasOwnProperty.call(nextDefaults, "billable") && billableEl) {
      billableEl.checked = !!nextDefaults.billable;
    }
  }

  function refreshMemberRate() {
    const member = findTeamMemberById(memberEl?.value || "");
    if (!member || !rateEl || String(rateEl.value || "").trim()) return;
    const rateCents = teamMemberDisplayedRateCents(member);
    if (rateCents > 0) rateEl.value = (rateCents / 100).toFixed(2);
  }

  function syncPurposeFields() {
    const purpose = purposeEl?.value || "job_work";
    if (noteEl) noteEl.textContent = teamTimePurposeOptions().find((option) => option.value === purpose)?.note || "";
    if (trainingWrap) trainingWrap.style.display = purpose === "driver_training" || purpose === "trade_training" ? "block" : "none";
    if (maintenanceWrap) maintenanceWrap.style.display = purpose === "maintenance" ? "block" : "none";
    if (costBucketEl) costBucketEl.value = teamDefaultCostBucket(purpose, maintenanceTypeEl?.value || "routine_service");
    if (billableEl) billableEl.checked = purpose === "job_work";
  }

  memberEl?.addEventListener("change", refreshMemberRate);
  memberEl?.addEventListener("change", () => {
    const member = findTeamMemberById(memberEl?.value || "") || {};
    const presets = teamTimePresetOptions(member);
    modal.querySelectorAll("[data-team-time-preset]").forEach((button) => {
      const preset = presets.find((item) => item.key === button.getAttribute("data-team-time-preset"));
      button.textContent = preset?.label || "Preset";
    });
  });
  purposeEl?.addEventListener("change", syncPurposeFields);
  maintenanceTypeEl?.addEventListener("change", syncPurposeFields);
  refreshMemberRate();
  syncPurposeFields();
  applyTimeDefaults(defaults);
  modal.querySelectorAll("[data-team-time-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const member = findTeamMemberById(memberEl?.value || "") || {};
      const preset = teamTimePresetOptions(member).find((item) => item.key === button.getAttribute("data-team-time-preset"));
      applyTimeDefaults(preset?.defaults || {});
      refreshMemberRate();
    });
  });

  modal.querySelector("#btnSaveTeamTime").onclick = async () => {
    const messageEl = modal.querySelector("#teamTimeMsg");
    const member = findTeamMemberById(memberEl?.value || "");
    const description = String(modal.querySelector("#teamTimeDescription")?.value || "").trim();
    const startedAt = modal.querySelector("#teamTimeStartedAt")?.value || "";
    const duration = parseInt(modal.querySelector("#teamTimeDuration")?.value || "0", 10);
    const purpose = purposeEl?.value || "job_work";
    const hourlyRate = Math.max(0, parseFloat(rateEl?.value || "0"));
    if (!member) {
      setInlineMessage(messageEl, "Pick a team member.", "error");
      return;
    }
    if (!description) {
      setInlineMessage(messageEl, "Add a short description so this still makes sense later.", "error");
      return;
    }
    if (!startedAt || !duration) {
      setInlineMessage(messageEl, "Add a start time and duration.", "error");
      return;
    }
    setInlineMessage(messageEl, "Saving team time...");
    try {
      const token = await getOperatorAccessToken();
      const payload = {
        member_id: member.id,
        description,
        started_at: new Date(startedAt).toISOString(),
        duration_minutes: duration,
        hourly_rate_cents: Math.round(hourlyRate * 100),
        billable: !!billableEl?.checked,
        work_type: purpose,
        cost_bucket: costBucketEl?.value || teamDefaultCostBucket(purpose, maintenanceTypeEl?.value || ""),
      };
      if (purpose === "driver_training" || purpose === "trade_training") {
        payload.training_type = modal.querySelector("#teamTrainingType")?.value || "other";
      }
      if (purpose === "maintenance") {
        payload.maintenance_type = maintenanceTypeEl?.value || "routine_service";
        payload.asset_category = modal.querySelector("#teamAssetCategory")?.value || "vehicle";
        payload.asset_label = String(modal.querySelector("#teamAssetLabel")?.value || "").trim();
      }
      const response = await fetch("/.netlify/functions/log-time-entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to save time entry.");
      modal.remove();
      showToast("Team time saved.");
      if ($("hoursStart")?.value && $("hoursEnd")?.value) {
        await loadHoursReport();
      }
    } catch (error) {
      setInlineMessage(messageEl, error.message || String(error), "error");
    }
  };
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
}

async function loadHoursReport() {
  const startEl = $("hoursStart");
  const endEl = $("hoursEnd");
  const reportEl = $("hoursReport");
  if (!reportEl) return;
  const start = startEl?.value;
  const end = endEl?.value;
  if (!start || !end) {
    reportEl.innerHTML = '<div class="muted">Set start and end dates.</div>';
    return;
  }
  reportEl.innerHTML = '<div class="muted">Loading...</div>';
  try {
    const token = await getOperatorAccessToken();
    const response = await fetch(`/.netlify/functions/get-team-hours?start=${start}&end=${end}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Failed to load hours");
    renderHoursReport(data);
  } catch (error) {
    reportEl.innerHTML = `<div class="msg error">${escapeHtml(error.message)}</div>`;
  }
}

function buildHoursInvestmentSummary(data = {}) {
  const totals = data?.totals || {};
  const members = Array.isArray(data?.members) ? data.members : [];
  const readiness = {
    blocked: 0,
    supervised: 0,
    recordsMissing: 0,
  };

  members.forEach((member) => {
    const restriction = teamMemberRolloutRestriction(member).label;
    if (["Restricted from solo dispatch", "Labor-only until driver setup clears", "Qualification refresh overdue", "Training refresh overdue"].includes(restriction)) {
      readiness.blocked += 1;
    } else if (["Ride-along required", "Supervised mixed-role rollout", "Needs supervised field day", "Refresh due soon", "Training refresh due soon"].includes(restriction)) {
      readiness.supervised += 1;
    }
    if (teamRecordEvidenceSummary(member).needsAttention) {
      readiness.recordsMissing += 1;
    }
  });

  const estimatedPayrollCents = Number(totals.estimated_pay_cents || 0);
  const trainingHours = Number((Number(totals.training_minutes || 0) / 60).toFixed(1));
  const maintenanceHours = Number((Number(totals.maintenance_minutes || 0) / 60).toFixed(1));

  return {
    estimatedPayrollCents,
    trainingHours,
    maintenanceHours,
    pricingOverheadCents: Number(totals.pricing_overhead_cost_cents || 0),
    assetBasisCandidateCents: Number(totals.asset_basis_candidate_cost_cents || 0),
    readiness,
  };
}

function teamTrainingTypeLabel(value) {
  return teamTrainingTypeOptions().find((option) => option.value === value)?.label || "General training";
}

function teamMaintenanceTypeLabel(value) {
  return teamMaintenanceTypeOptions().find((option) => option.value === value)?.label || "General maintenance";
}

function teamAssetCategoryLabel(value) {
  return teamAssetCategoryOptions().find((option) => option.value === value)?.label || "Other asset";
}

function buildHoursInvestmentBreakdown(data = {}) {
  const members = Array.isArray(data?.members) ? data.members : [];
  const trainingTypes = new Map();
  const maintenanceAssets = new Map();
  const costBuckets = new Map();

  const upsert = (map, key, next) => {
    const current = map.get(key) || { label: key, minutes: 0, payrollCents: 0, count: 0, note: "" };
    current.minutes += Number(next.minutes || 0);
    current.payrollCents += Number(next.payrollCents || 0);
    current.count += Number(next.count || 0);
    if (next.note) {
      const notes = new Set(
        String(current.note || "")
          .split(" | ")
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      );
      notes.add(String(next.note).trim());
      current.note = Array.from(notes).join(" | ");
    }
    map.set(key, current);
  };

  members.forEach((member) => {
    const memberRateCents = teamMemberDisplayedRateCents(member);
    const entries = Array.isArray(member?.entries) ? member.entries : [];
    entries.forEach((entry) => {
      const minutes = Number(entry?.duration_minutes || 0);
      if (!minutes) return;
      const rateCents = Number(entry?.hourly_rate_cents || memberRateCents || 0);
      const payrollCents = Math.round((minutes / 60) * rateCents);
      const workType = String(entry?.work_type || "").trim();
      const costBucketLabel = teamCostBucketLabel(entry?.cost_bucket);

      upsert(costBuckets, costBucketLabel, {
        label: costBucketLabel,
        minutes,
        payrollCents,
        count: 1,
      });

      if (workType === "driver_training" || workType === "trade_training") {
        const label = teamTrainingTypeLabel(entry?.training_type);
        upsert(trainingTypes, label, {
          label,
          minutes,
          payrollCents,
          count: 1,
        });
      }

      if (workType === "maintenance") {
        const assetLabel = String(entry?.asset_label || "").trim()
          || teamAssetCategoryLabel(entry?.asset_category);
        const maintenanceLabel = teamMaintenanceTypeLabel(entry?.maintenance_type);
        upsert(maintenanceAssets, assetLabel, {
          label: assetLabel,
          minutes,
          payrollCents,
          count: 1,
          note: maintenanceLabel,
        });
      }
    });
  });

  const sortRows = (map) => Array.from(map.values()).sort((left, right) => (
    right.minutes - left.minutes || left.label.localeCompare(right.label)
  ));

  return {
    trainingTypes: sortRows(trainingTypes),
    maintenanceAssets: sortRows(maintenanceAssets),
    costBuckets: sortRows(costBuckets),
  };
}

function renderHoursInvestmentBreakdown(data = {}) {
  const breakdown = buildHoursInvestmentBreakdown(data);
  const sections = [
    {
      title: "Training categories",
      items: breakdown.trainingTypes,
      empty: "No training category detail is tracked in this report yet.",
      note: (item) => `${teamMinutesLabel(item.minutes)}${item.payrollCents ? ` • ${formatUsd(item.payrollCents)} est. payroll` : ""}`,
    },
    {
      title: "Maintenance assets",
      items: breakdown.maintenanceAssets,
      empty: "No maintenance asset detail is tracked in this report yet.",
      note: (item) => `${teamMinutesLabel(item.minutes)}${item.note ? ` • ${item.note}` : ""}`,
    },
    {
      title: "Cost buckets",
      items: breakdown.costBuckets,
      empty: "No cost bucket detail is tracked in this report yet.",
      note: (item) => `${teamMinutesLabel(item.minutes)}${item.payrollCents ? ` • ${formatUsd(item.payrollCents)} est. payroll` : ""}`,
    },
  ];

  return `
    <div class="row row-tight" style="gap:12px;align-items:stretch;margin:0 0 12px;">
      ${sections.map((section) => `
        <div class="card" style="flex:1 1 220px;min-width:220px;">
          <div class="card-hd">
            <div>
              <strong>${escapeHtml(section.title)}</strong>
              <div class="muted">Quick rollups so training and maintenance costs stay easy to read.</div>
            </div>
          </div>
          <div class="card-bd">
            ${section.items.length ? section.items.slice(0, 5).map((item) => `
              <div class="list-item" style="padding:6px 0;">
                <div class="li-main">
                  <div class="li-title" style="font-size:.85rem;">${escapeHtml(item.label)}</div>
                  <div class="li-sub muted" style="font-size:.75rem;">${escapeHtml(section.note(item))}</div>
                </div>
                <div class="li-meta">
                  <span class="pill">${escapeHtml(String(item.count))}</span>
                </div>
              </div>
            `).join("") : `<div class="muted" style="font-size:.82rem;">${escapeHtml(section.empty)}</div>`}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderHoursInvestmentSummary(data = {}) {
  const summary = buildHoursInvestmentSummary(data);
  return `
    <div class="workspace-signal-band" style="margin:0 0 12px;">
      <div class="workspace-signal-band__item ${summary.trainingHours ? "workspace-signal-band__item--good" : ""}">
        <span>Training investment</span>
        <strong>${escapeHtml(`${summary.trainingHours}h`)}</strong>
        <small>${escapeHtml(summary.pricingOverheadCents ? `${formatUsd(summary.pricingOverheadCents)} currently tracked into pricing overhead.` : "No training overhead has been tracked in this report yet.")}</small>
      </div>
      <div class="workspace-signal-band__item ${summary.maintenanceHours ? "workspace-signal-band__item--warn" : ""}">
        <span>Maintenance investment</span>
        <strong>${escapeHtml(`${summary.maintenanceHours}h`)}</strong>
        <small>${escapeHtml(summary.assetBasisCandidateCents ? `${formatUsd(summary.assetBasisCandidateCents)} is tagged as basis-candidate work.` : "No capital-style maintenance is tagged in this report yet.")}</small>
      </div>
      <div class="workspace-signal-band__item ${summary.readiness.blocked ? "workspace-signal-band__item--danger" : summary.readiness.supervised ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Readiness follow-up</span>
        <strong>${escapeHtml(String(summary.readiness.blocked + summary.readiness.supervised))}</strong>
        <small>${escapeHtml(summary.readiness.blocked ? `${summary.readiness.blocked} blocked and ${summary.readiness.supervised} supervised workers are still showing rollout pressure.` : summary.readiness.supervised ? `${summary.readiness.supervised} workers still need supervised follow-through.` : "No workers in this report are showing rollout pressure right now.")}</small>
      </div>
      <div class="workspace-signal-band__item ${summary.readiness.recordsMissing ? "workspace-signal-band__item--warn" : "workspace-signal-band__item--good"}">
        <span>Records follow-up</span>
        <strong>${escapeHtml(String(summary.readiness.recordsMissing))}</strong>
        <small>${escapeHtml(summary.readiness.recordsMissing ? "Office records are still missing for one or more workers in this report." : "Office record coverage looks complete for the visible workers.")}</small>
      </div>
      <div class="workspace-signal-band__item ${summary.estimatedPayrollCents ? "workspace-signal-band__item--good" : ""}">
        <span>Estimated payroll</span>
        <strong>${escapeHtml(summary.estimatedPayrollCents ? formatUsd(summary.estimatedPayrollCents) : "$0")}</strong>
        <small>${escapeHtml("Use this as a simple labor-cost preview before payroll reporting grows deeper.")}</small>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin:-4px 0 12px;">
      <button class="btn btn-ghost btn-sm" type="button" onclick="exportTeamInvestmentCsv()">Export investment</button>
    </div>
    ${renderHoursInvestmentBreakdown(data)}
  `;
}

function downloadTeamCsv(filename, rows = []) {
  if (!Array.isArray(rows) || !rows.length) {
    showToast("There is nothing to export yet.");
    return;
  }
  const csv = rows
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportTeamReadinessCsv() {
  const rows = [[
    "Member",
    "Role",
    "Track",
    "Driver readiness",
    "Training readiness",
    "Restriction",
    "Next action",
    "Records status",
    "Qualification refresh",
  ]];

  (Array.isArray(TEAM_MEMBERS_CACHE) ? TEAM_MEMBERS_CACHE : []).forEach((member) => {
    const track = teamMemberRolloutTrack(member);
    const driver = teamMemberDriverReadiness(member);
    const training = teamTrainingSummary(member);
    const restriction = teamMemberRolloutRestriction(member);
    const nextAction = teamMemberNextAction(member);
    const records = teamRecordEvidenceSummary(member);
    const refresh = teamQualificationRefreshPressure(member);
    rows.push([
      teamMemberLabel(member),
      member?.role || "",
      track.label,
      driver.label,
      training.label,
      restriction.label,
      nextAction.label,
      records.label,
      refresh.label,
    ]);
  });

  downloadTeamCsv(`team-readiness-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportMondayReadinessCsv() {
  const members = (Array.isArray(TEAM_MEMBERS_CACHE) ? TEAM_MEMBERS_CACHE : [])
    .slice()
    .sort((left, right) => {
      const leftReady = teamReadinessGates(left);
      const rightReady = teamReadinessGates(right);
      const leftRank = leftReady.blockedCount ? 0 : leftReady.warningCount ? 1 : 2;
      const rightRank = rightReady.blockedCount ? 0 : rightReady.warningCount ? 1 : 2;
      return leftRank - rightRank || teamMemberLabel(left).localeCompare(teamMemberLabel(right));
    });

  const rows = [[
    "Member",
    "Role",
    "Track",
    "Monday Status",
    "Restriction",
    "Next Action",
    "Driver Readiness",
    "Training Readiness",
    "Records Status",
    "Qualification Refresh",
  ]];

  members.forEach((member) => {
    const readiness = teamReadinessGates(member);
    rows.push([
      teamMemberLabel(member),
      member?.role || "",
      teamMemberRolloutTrack(member).label,
      readiness.blockedCount ? "Blocked before Monday" : readiness.warningCount ? "Supervised / follow-up" : "Ready for Monday",
      teamMemberRolloutRestriction(member).label,
      teamMemberNextAction(member).label,
      teamMemberDriverReadiness(member).label,
      teamTrainingSummary(member).label,
      teamRecordEvidenceSummary(member).label,
      teamQualificationRefreshPressure(member).label,
    ]);
  });

  downloadTeamCsv(`team-monday-readiness-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportTeamInvestmentCsv() {
  const reportEl = $("hoursReport");
  const data = reportEl?._data;
  if (!data) {
    showToast("Load Hours & Pay first.");
    return;
  }

  const rows = [[
    "Member",
    "Role",
    "Training Hours",
    "Maintenance Hours",
    "Pricing Overhead",
    "Basis Candidate",
    "Estimated Payroll",
    "Readiness",
    "Records",
  ]];

  (Array.isArray(data.members) ? data.members : []).forEach((member) => {
    rows.push([
      member.name || "",
      member.role || "",
      Number((Number(member.training_minutes || 0) / 60).toFixed(1)),
      Number((Number(member.maintenance_minutes || 0) / 60).toFixed(1)),
      formatUsd(Number(member.pricing_overhead_cost_cents || 0)),
      formatUsd(Number(member.asset_basis_candidate_cost_cents || 0)),
      formatUsd(Number(member.estimated_pay_cents || 0)),
      teamMemberRolloutRestriction(member).label,
      teamRecordEvidenceSummary(member).label,
    ]);
  });

  const totals = data.totals || {};
  const breakdown = buildHoursInvestmentBreakdown(data);
  rows.push([
    "TOTAL",
    "",
    Number((Number(totals.training_minutes || 0) / 60).toFixed(1)),
    Number((Number(totals.maintenance_minutes || 0) / 60).toFixed(1)),
    formatUsd(Number(totals.pricing_overhead_cost_cents || 0)),
    formatUsd(Number(totals.asset_basis_candidate_cost_cents || 0)),
    formatUsd(Number(totals.estimated_pay_cents || 0)),
    "",
    "",
  ]);

  if (breakdown.trainingTypes.length) {
    rows.push([]);
    rows.push(["TRAINING CATEGORIES", "Hours", "Estimated Payroll", "Entries"]);
    breakdown.trainingTypes.forEach((item) => {
      rows.push([
        item.label,
        Number((Number(item.minutes || 0) / 60).toFixed(1)),
        formatUsd(Number(item.payrollCents || 0)),
        item.count,
      ]);
    });
  }

  if (breakdown.maintenanceAssets.length) {
    rows.push([]);
    rows.push(["MAINTENANCE ASSETS", "Hours", "Primary Type", "Entries"]);
    breakdown.maintenanceAssets.forEach((item) => {
      rows.push([
        item.label,
        Number((Number(item.minutes || 0) / 60).toFixed(1)),
        item.note || "",
        item.count,
      ]);
    });
  }

  if (breakdown.costBuckets.length) {
    rows.push([]);
    rows.push(["COST BUCKETS", "Hours", "Estimated Payroll", "Entries"]);
    breakdown.costBuckets.forEach((item) => {
      rows.push([
        item.label,
        Number((Number(item.minutes || 0) / 60).toFixed(1)),
        formatUsd(Number(item.payrollCents || 0)),
        item.count,
      ]);
    });
  }

  downloadTeamCsv(`team-investment-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function exportTeamAuditCsv() {
  const rows = [[
    "Member",
    "Role",
    "Track",
    "Displayed Rate",
    "Pay Context",
    "Driver Readiness",
    "Training Readiness",
    "Restriction",
    "Next Action",
    "Records Status",
    "Qualification Refresh",
    "CDL Expiry",
    "Med Card Expiry",
    "MVR Check",
    "First Aid Expiry",
    "Confined Space Expiry",
    "H2S Expiry",
  ]];

  (Array.isArray(TEAM_MEMBERS_CACHE) ? TEAM_MEMBERS_CACHE : []).forEach((member) => {
    const track = teamMemberRolloutTrack(member);
    const displayedRateCents = teamMemberDisplayedRateCents(member);
    const qualification = teamMemberDriverQualification(member) || {};
    rows.push([
      teamMemberLabel(member),
      member?.role || "",
      track.label,
      displayedRateCents ? `${formatUsd(displayedRateCents)}/hr` : "",
      teamMemberCompensationNote(member),
      teamMemberDriverReadiness(member).label,
      teamTrainingSummary(member).label,
      teamMemberRolloutRestriction(member).label,
      teamMemberNextAction(member).label,
      teamRecordEvidenceSummary(member).label,
      teamQualificationRefreshPressure(member).label,
      qualification?.cdl_expiry_date ? teamDateLabel(qualification.cdl_expiry_date) : "",
      qualification?.medical_certificate_expiry ? teamDateLabel(qualification.medical_certificate_expiry) : "",
      qualification?.last_mvr_check_date ? teamDateLabel(qualification.last_mvr_check_date) : "",
      qualification?.first_aid_cert_expiry_date ? teamDateLabel(qualification.first_aid_cert_expiry_date) : "",
      qualification?.confined_space_cert_expiry_date ? teamDateLabel(qualification.confined_space_cert_expiry_date) : "",
      qualification?.h2s_cert_expiry_date ? teamDateLabel(qualification.h2s_cert_expiry_date) : "",
    ]);
  });

  downloadTeamCsv(`team-audit-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function renderHoursReport(data) {
  const reportEl = $("hoursReport");
  if (!reportEl) return;
  const { members = [], totals = {} } = data;
  if (!members.length) {
    reportEl.innerHTML = '<div class="muted">No hours logged in this period.</div>';
    return;
  }
  const toHours = (minutes) => (minutes / 60).toFixed(1);
  const memberHtml = members.map((member) => {
    const hasActivity = member.total_minutes > 0 || member.job_count > 0;
    const compensation = member.compensation || {};
    const displayedRateCents = teamMemberDisplayedRateCents(member);
    const contractFloorCents = Number(compensation.contract_floor_cents || 0);
    const jobRows = (member.jobs || []).map((job) => {
      const duration = job.actual_end_at && job.actual_start_at
        ? Math.round((new Date(job.actual_end_at) - new Date(job.actual_start_at)) / 60000)
        : null;
      return `<div class="list-item" style="padding:6px 0;">
        <div class="li-main">
          <div class="li-title" style="font-size:.85rem;">${escapeHtml(job.title || "Untitled job")} &middot; ${escapeHtml(job.customer_name || "")}</div>
          <div class="li-sub muted" style="font-size:.75rem;">${escapeHtml(job.actual_start_at ? new Date(job.actual_start_at).toLocaleDateString() : "-")}${duration != null ? ` &middot; ${toHours(duration)}h` : ""}</div>
        </div>
        <div class="li-meta"><span class="pill ${job.status === "completed" ? "pill-on" : ""}">${escapeHtml(job.status || "")}</span></div>
      </div>`;
    }).join("");
    const entryRows = (member.entries || []).map((entry) => `
      <div class="list-item" style="padding:6px 0;">
        <div class="li-main">
          <div class="li-title" style="font-size:.85rem;">${escapeHtml(entry.description || "Time entry")}</div>
          <div class="li-sub muted" style="font-size:.75rem;">
            ${escapeHtml(entry.started_at ? new Date(entry.started_at).toLocaleDateString() : "-")}
            &middot; ${escapeHtml(entry.work_type_label || teamTimePurposeLabel(entry.work_type))}
            &middot; ${escapeHtml(entry.billable ? "Billable" : "Non-billable")}
            ${entry.training_type ? ` &middot; ${escapeHtml(teamTrainingTypeOptions().find((item) => item.value === entry.training_type)?.label || entry.training_type)}` : ""}
            ${entry.maintenance_type ? ` &middot; ${escapeHtml(teamMaintenanceTypeOptions().find((item) => item.value === entry.maintenance_type)?.label || entry.maintenance_type)}` : ""}
            ${entry.asset_label ? ` &middot; ${escapeHtml(entry.asset_label)}` : ""}
          </div>
        </div>
        <div class="li-meta">
          <span class="pill">${toHours(entry.duration_minutes || 0)}h</span>
          ${entry.cost_bucket ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(teamCostBucketLabel(entry.cost_bucket))}</div>` : ""}
        </div>
      </div>`).join("");
    const activitySummary = [];
    if (member.training_minutes > 0) activitySummary.push(`${toHours(member.training_minutes)}h training`);
    if (member.maintenance_minutes > 0) activitySummary.push(`${toHours(member.maintenance_minutes)}h maintenance`);
    if (member.pricing_overhead_cost_cents > 0) activitySummary.push(`${formatUsd(member.pricing_overhead_cost_cents)} pricing overhead`);
    if (member.asset_basis_candidate_cost_cents > 0) activitySummary.push(`${formatUsd(member.asset_basis_candidate_cost_cents)} basis candidate`);
    return `
      <div class="card" style="margin-bottom:12px;${!hasActivity ? "opacity:.55;" : ""}">
        <div class="card-hd" style="cursor:pointer;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
          <div>
            <strong>${escapeHtml(member.name || "Unknown")}</strong>
            <span class="pill" style="margin-left:8px;">${escapeHtml(member.role || "")}</span>
            ${compensation.union_classification_name ? `<span class="pill" style="margin-left:8px;">${escapeHtml(compensation.union_classification_name)}</span>` : ""}
          </div>
          <div class="row" style="gap:16px;font-size:.85rem;">
            <span><strong>${toHours(member.total_minutes)}</strong> hrs total</span>
            <span class="muted">${toHours(member.billable_minutes)} billable</span>
            <span class="muted">${member.job_count} jobs</span>
            ${member.estimated_pay_cents > 0 ? `<span class="pill pill-on">${formatUsd(member.estimated_pay_cents)}</span>` : ""}
          </div>
        </div>
        <div class="card-bd" style="display:none;">
          ${displayedRateCents ? `<div class="muted" style="font-size:.8rem;margin-bottom:10px;">Effective rate ${escapeHtml(`${formatUsd(displayedRateCents)}/hr`)}${contractFloorCents ? ` - contract floor ${escapeHtml(`${formatUsd(contractFloorCents)}/hr`)}` : ""}${compensation.source ? ` - source ${escapeHtml(compensation.source.replace(/_/g, " "))}` : ""}</div>` : ""}
          ${activitySummary.length ? `<div class="muted" style="font-size:.8rem;margin-bottom:10px;">${escapeHtml(activitySummary.join(" | "))}</div>` : ""}
          ${jobRows ? `<div style="margin-bottom:10px;"><div class="kicker">Jobs</div><div class="list">${jobRows}</div></div>` : ""}
          ${entryRows ? `<div><div class="kicker">Time entries</div><div class="list">${entryRows}</div></div>` : ""}
          ${!jobRows && !entryRows ? '<div class="muted">No detail records in this period.</div>' : ""}
        </div>
      </div>`;
  }).join("");
  reportEl.innerHTML = renderHoursInvestmentSummary(data) + memberHtml + `
    <div style="border-top:1px solid rgba(255,255,255,.08);padding-top:14px;margin-top:4px;display:flex;gap:24px;font-size:.9rem;">
      <span><strong>${toHours(totals.total_minutes || 0)}</strong> total hours</span>
      <span class="muted">${toHours(totals.billable_minutes || 0)} billable</span>
      <span class="muted">${toHours(totals.training_minutes || 0)} training</span>
      <span class="muted">${toHours(totals.maintenance_minutes || 0)} maintenance</span>
      <span class="muted">${totals.member_count || 0} team members</span>
      ${totals.estimated_pay_cents > 0 ? `<span class="pill pill-on">Est. payroll: ${formatUsd(totals.estimated_pay_cents)}</span>` : ""}
      ${totals.pricing_overhead_cost_cents > 0 ? `<span class="pill">Pricing overhead: ${formatUsd(totals.pricing_overhead_cost_cents)}</span>` : ""}
      ${totals.asset_basis_candidate_cost_cents > 0 ? `<span class="pill">Basis candidate: ${formatUsd(totals.asset_basis_candidate_cost_cents)}</span>` : ""}
    </div>`;
  reportEl._data = data;
}

function exportHoursCsv() {
  const reportEl = $("hoursReport");
  const data = reportEl?._data;
  if (!data) {
    showToast("Load a report first.");
    return;
  }
  const startEl = $("hoursStart");
  const endEl = $("hoursEnd");
  const rows = [["Member", "Role", "Date", "Description", "Type", "Training Type", "Maintenance Type", "Asset Category", "Asset Label", "Cost Bucket", "Billable", "Duration (hrs)", "Hourly Rate", "Contract Floor", "Rate Source", "Est. Pay"]];
  for (const member of data.members || []) {
    const compensation = member.compensation || {};
    const memberRateCents = teamMemberDisplayedRateCents(member);
    const contractFloorCents = Number(compensation.contract_floor_cents || 0);
    const rateSource = compensation.source || "member_fallback";
    for (const entry of member.entries || []) {
      const hours = ((entry.duration_minutes || 0) / 60).toFixed(2);
      const rateCents = Number(entry.hourly_rate_cents || memberRateCents || 0);
      const rate = (rateCents / 100).toFixed(2);
      const pay = (Number(entry.cost_cents || Math.round(((entry.duration_minutes || 0) / 60) * rateCents)) / 100).toFixed(2);
      rows.push([member.name || "", member.role || "", entry.started_at ? new Date(entry.started_at).toLocaleDateString() : "", entry.description || "Time entry", teamTimePurposeLabel(entry.work_type), entry.training_type || "", entry.maintenance_type || "", entry.asset_category || "", entry.asset_label || "", teamCostBucketLabel(entry.cost_bucket), entry.billable ? "Yes" : "No", hours, `$${rate}`, contractFloorCents ? `$${(contractFloorCents / 100).toFixed(2)}` : "", rateSource, `$${pay}`]);
    }
    for (const job of member.jobs || []) {
      if (!job.actual_start_at || !job.actual_end_at) continue;
      const minutes = Math.round((new Date(job.actual_end_at) - new Date(job.actual_start_at)) / 60000);
      const hours = (minutes / 60).toFixed(2);
      const rate = (memberRateCents / 100).toFixed(2);
      const pay = ((minutes / 60) * memberRateCents / 100).toFixed(2);
      rows.push([member.name || "", member.role || "", new Date(job.actual_start_at).toLocaleDateString(), job.title || "Job", "Job work", "", "", "", "", "Direct job labor", "Yes", hours, `$${rate}`, contractFloorCents ? `$${(contractFloorCents / 100).toFixed(2)}` : "", rateSource, `$${pay}`]);
    }
  }
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `hours-${startEl?.value || "report"}-to-${endEl?.value || "report"}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

let TEAM_WORKSPACE_LOADED = false;
let TEAM_WORKSPACE_BINDINGS_BOUND = false;

function loadTeamWorkspace() {
  if (!TEAM_WORKSPACE_LOADED) {
    TEAM_WORKSPACE_LOADED = true;
    fetchTeamMembers().catch(console.warn);
    fetchHydrovacDriverQualifications().catch(console.warn);
    const hoursStart = $("hoursStart");
    const hoursEnd = $("hoursEnd");
    if (hoursStart && !hoursStart.value) {
      const now = new Date();
      hoursStart.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      hoursEnd.value = now.toISOString().split("T")[0];
    }
    return;
  }
  fetchHydrovacDriverQualifications().catch(console.warn);
}

function initTeamWorkspaceBindings() {
  if (TEAM_WORKSPACE_BINDINGS_BOUND) return;
  TEAM_WORKSPACE_BINDINGS_BOUND = true;
  $("btnTrainingRollout")?.addEventListener("click", () => {
    const member = teamMembersNeedingRollout()[0] || TEAM_MEMBERS_CACHE[0];
    if (!member) {
      showToast("Add a team member before starting rollout.");
      return;
    }
    openTeamTrainingModal(member.id);
  });
  $("btnInviteTeamMember")?.addEventListener("click", () => openInviteTeamMemberModal());
  $("btnLogTeamTime")?.addEventListener("click", () => openTeamTimeModal(""));
  $("btnLogMaintenanceTime")?.addEventListener("click", () => openMaintenanceTimeModal());
  $("btnRefreshTeam")?.addEventListener("click", async () => {
    await fetchTeamMembers().catch(console.warn);
    await fetchHydrovacDriverQualifications().catch(console.warn);
  });
  $("btnLoadHours")?.addEventListener("click", loadHoursReport);
  $("btnExportHoursCsv")?.addEventListener("click", exportHoursCsv);
}

const TEAM_WORKSPACE_HELPERS = {
  fetchTeamMembers,
  renderTeamPanel,
  openInviteTeamMemberModal,
  openTeamMemberProfileModal,
  openTeamTrainingModal,
  openPresetTrainingTimeModal,
  openMaintenanceTimeModal,
  openTeamTimeModal,
  openDriverSetupForTeamMember,
  openCrewPortalForTeamMember,
  openEditTeamMemberModal,
  removeTeamMember,
  loadHoursReport,
  renderHoursReport,
  exportHoursCsv,
  exportMondayReadinessCsv,
  exportTeamReadinessCsv,
  exportTeamInvestmentCsv,
  exportTeamAuditCsv,
  exportTeamMemberProfileCsv,
  buildTeamMemberProfileRows,
  buildHoursInvestmentBreakdown,
  loadTeamWorkspace,
  initTeamWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_TEAM_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_TEAM_WORKSPACE || {}),
  ...TEAM_WORKSPACE_HELPERS,
};

Object.assign(window, TEAM_WORKSPACE_HELPERS);
