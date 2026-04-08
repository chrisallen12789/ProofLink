// /crew/crew.js
// ProofLink Crew Field App
// Handles: auth, job loading, status updates, photo capture,
//          completion flow, signature capture, offline support.

'use strict';

// ── Config ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://ygfpawksbqfbgohztisv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bcILNxLX87f-G2zq_SbDGA_Vvs62biB';

// ── State ──────────────────────────────────────────────────────────────────────
let sb             = null;   // Supabase client
let SESSION        = null;   // current auth session
let MEMBER         = null;   // { id, name, role, role_title, tenant_id }
let JOBS           = [];     // today's jobs cache
let ACTIVE_JOB     = null;   // currently viewed job
let TIMER_INTERVAL = null;   // running timer for active job
let OFFLINE_QUEUE  = [];     // pending updates when offline
let DB             = null;   // IndexedDB handle
let SIG_DRAWING    = false;  // signature pad drawing state
let SIG_POINTS     = [];     // drawn path for blank-check
let CURRENT_DATE   = todayString(); // date filter for home view
let PENDING_LAUNCH_JOB_ID = '';
let PENDING_LAUNCH_SOURCE = '';
window.PROOFLINK_CREW_BOOT_READY = false;

// ── Quick Log State ─────────────────────────────────────────────────────────────
let _quickLogType          = 'Travel';
let _quickLogTimerStart    = null;
let _quickLogTimerInterval = null;
let _quickLogElapsedSecs   = 0;

// ── Utilities ──────────────────────────────────────────────────────────────────

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDate(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function crewLaunchJobIdFromLocation() {
  try {
    const search = String(window?.location?.search || '');
    const params = new URLSearchParams(search);
    return String(params.get('job') || '').trim();
  } catch (_) {
    return '';
  }
}

function crewLaunchSourceFromLocation() {
  try {
    const search = String(window?.location?.search || '');
    const params = new URLSearchParams(search);
    return String(params.get('source') || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

function clearCrewLaunchJobId() {
  try {
    const href = String(window?.location?.href || '');
    const url = href
      ? new URL(href)
      : new URL(String(window?.location?.pathname || '/crew/'), String(window?.location?.origin || 'https://prooflink.co'));
    url.searchParams.delete('job');
    url.searchParams.delete('source');
    if (window?.history?.replaceState) {
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch (_) {
    // Ignore launch cleanup issues so the crew app can still open jobs.
  }
}

async function maybeOpenRequestedCrewJob(jobList = JOBS) {
  const requestedId = String(PENDING_LAUNCH_JOB_ID || crewLaunchJobIdFromLocation()).trim();
  const launchSource = String(PENDING_LAUNCH_SOURCE || crewLaunchSourceFromLocation()).trim().toLowerCase();
  if (!requestedId) return false;
  const job = Array.isArray(jobList) ? jobList.find((row) => String(row?.id || '') === requestedId) : null;
  if (!job) return false;
  PENDING_LAUNCH_JOB_ID = '';
  PENDING_LAUNCH_SOURCE = '';
  clearCrewLaunchJobId();
  await openJob(job);
  if (launchSource === 'operator') {
    const label = String(job?.title || job?.customer_name || job?.service_address || 'the assigned job').trim();
    showToast(`The office sent you into ${label}. Review the details before you roll.`, 'info');
  }
  return true;
}

function statusLabel(status) {
  const map = {
    scheduled  : 'Scheduled',
    dispatched : 'Dispatched',
    in_progress: 'In Progress',
    blocked    : 'Blocked',
    completed  : 'Completed',
    cancelled  : 'Cancelled',
  };
  return map[status] || status;
}

function statusClass(status) {
  const map = {
    scheduled  : 'status-scheduled',
    dispatched : 'status-dispatched',
    in_progress: 'status-inprogress',
    blocked    : 'status-blocked',
    completed  : 'status-completed',
    cancelled  : 'status-cancelled',
  };
  return map[status] || '';
}

const CREW_SCREEN_ALIASES = {
  completion: ['screenCompletion', 'screenComplete'],
  blocker: ['screenBlocker'],
  success: ['screenSuccess'],
  schedule: ['screenSchedule'],
  home: ['screenHome'],
  job: ['screenJob'],
  profile: ['screenProfile'],
  login: ['screenLogin'],
};

function resolveCrewScreenKey(name = '') {
  const normalized = String(name || '').trim();
  if (!normalized) return '';
  if (CREW_SCREEN_ALIASES[normalized]) return normalized;
  return normalized.replace(/^screen/i, '').toLowerCase();
}

function resolveCrewScreenElement(name = '') {
  const normalized = String(name || '').trim();
  if (!normalized) return null;
  const direct = document.getElementById(normalized);
  if (direct) return direct;

  const key = resolveCrewScreenKey(normalized);
  const aliasIds = CREW_SCREEN_ALIASES[key] || [`screen${capitalize(key)}`];
  for (const id of aliasIds) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

function bindClickHandler(id, handler) {
  const element = document.getElementById(id);
  if (!element) return;
  if (element.getAttribute('onclick')) {
    element.removeAttribute('onclick');
    element.onclick = null;
  }
  element.addEventListener('click', handler);
}

function syncBottomNav(screenName = '') {
  const nav = document.getElementById('bottomNav');
  const appShell = document.getElementById('appShell');
  if (!nav || !appShell) return;

  const screenKey = resolveCrewScreenKey(screenName);
  const showNav = !['login', 'completion', 'blocker', 'success'].includes(screenKey);
  nav.classList.toggle('visible', showNav);
  nav.setAttribute('aria-hidden', showNav ? 'false' : 'true');
  appShell.classList.toggle('nav-visible', showNav);

  const activeTab = screenKey === 'schedule'
    ? 'schedule'
    : screenKey === 'profile'
      ? 'profile'
      : 'home';

  nav.querySelectorAll('.nav-tab').forEach((button) => {
    const isActive = button.id === `nav${capitalize(activeTab)}`;
    button.classList.toggle('active', isActive);
    if (isActive) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  });
}

function crewSitePacket(job = ACTIVE_JOB) {
  return job?.site_packet && typeof job.site_packet === 'object' && !Array.isArray(job.site_packet)
    ? job.site_packet
    : {};
}

function crewBusinessKey(job = ACTIVE_JOB) {
  const explicit = String(
    job?.business_key
    || job?.business_type
    || job?.profile
    || job?.workspace_key
    || job?.customers?.business_key
    || job?.customers?.business_type
    || ''
  ).trim().toLowerCase();
  if (explicit) return explicit;

  const jobType = String(job?.service_type || job?.job_type || '').trim().toLowerCase();
  if ([
    'hydrovac',
    'vactor',
    'daylighting',
    'potholing',
    'basin',
    'vacuum',
    'vault',
    'excavation',
    'sewer',
    'storm',
  ].some((needle) => jobType.includes(needle))) {
    return 'hydrovac';
  }
  return 'service_business';
}

function crewCustomerRef(job = ACTIVE_JOB) {
  return job?.customers || {};
}

function crewHydrovacManifestSummary(job = ACTIVE_JOB) {
  const manifests = Array.isArray(job?.manifests)
    ? job.manifests
    : Array.isArray(job?.waste_manifests)
      ? job.waste_manifests
      : [];
  const metadata = job?.manifest_metadata && typeof job.manifest_metadata === 'object' && !Array.isArray(job.manifest_metadata)
    ? job.manifest_metadata
    : {};
  const liveManifest = manifests.find((manifest) => {
    const manifestMeta = manifest?.metadata && typeof manifest.metadata === 'object' && !Array.isArray(manifest.metadata)
      ? manifest.metadata
      : {};
    if (manifestMeta.load_still_in_truck === true) return true;
    return String(manifestMeta.load_state || '').trim().toLowerCase() === 'live_in_truck';
  }) || null;

  const liveLoadCount = Number(
    job?.truck_live_load_count
    ?? job?.live_load_count
    ?? metadata.truck_live_load_count
    ?? (liveManifest ? 1 : 0)
    ?? 0
  );
  const bolNumber = String(
    job?.bol_number
    || job?.bill_of_lading_number
    || liveManifest?.metadata?.bol_number
    || liveManifest?.metadata?.bill_of_lading_number
    || metadata.bol_number
    || ''
  ).trim();
  const holdReason = String(
    job?.live_load_hold_reason
    || job?.hold_reason
    || liveManifest?.metadata?.live_load_hold_reason
    || liveManifest?.metadata?.hold_reason
    || metadata.live_load_hold_reason
    || ''
  ).trim();
  const readyBy = String(
    job?.disposal_ready_by
    || liveManifest?.metadata?.disposal_ready_by
    || metadata.disposal_ready_by
    || ''
  ).trim();
  const isolationNote = String(
    job?.load_isolation_note
    || job?.cross_contamination_note
    || metadata.load_isolation_note
    || ''
  ).trim();

  return {
    liveLoadCount: Number.isFinite(liveLoadCount) ? liveLoadCount : 0,
    bolNumber,
    holdReason,
    readyBy,
    isolationNote,
    manifestNumber: String(liveManifest?.manifest_number || liveManifest?.id || '').trim(),
  };
}
function crewJobReferenceTime(job = ACTIVE_JOB) {
  const scheduledDate = String(job?.scheduled_date || '').trim();
  const scheduledTime = String(job?.scheduled_time || '').trim() || '12:00:00';
  const scheduledAt = scheduledDate ? Date.parse(`${scheduledDate}T${scheduledTime}`) : NaN;
  if (Number.isFinite(scheduledAt)) return scheduledAt;

  const dispatchAt = Date.parse(job?.scheduled_at || job?.service_date || '');
  if (Number.isFinite(dispatchAt)) return dispatchAt;

  return Date.now();
}
function crewHydrovacLocateSummary(job = ACTIVE_JOB) {
  const tickets = Array.isArray(job?.locates)
    ? job.locates
    : Array.isArray(job?.locate_tickets)
      ? job.locate_tickets
      : Array.isArray(job?.utility_locate_tickets)
        ? job.utility_locate_tickets
        : [];
  const referenceTime = crewJobReferenceTime(job);
  const active = [];
  let expiringSoon = 0;
  let expired = 0;
  let verified = 0;

  tickets.forEach((ticket) => {
    const status = String(ticket?.status || '').trim().toLowerCase();
    const untilRaw = ticket?.extended_until || ticket?.valid_until || '';
    const until = Date.parse(untilRaw);
    const isExpired = status === 'expired' || (Number.isFinite(until) && until < referenceTime);
    if (ticket?.verified_on_site === true) verified += 1;
    if (isExpired) {
      expired += 1;
      return;
    }
    if (['active', 'extended'].includes(status)) {
      active.push(ticket);
      if (Number.isFinite(until)) {
        const days = Math.ceil((until - referenceTime) / (24 * 60 * 60 * 1000));
        if (days >= 0 && days <= 2) expiringSoon += 1;
      }
    }
  });

  return {
    tickets,
    activeCount: active.length,
    expiringSoon,
    expired,
    verified,
    primary: active[0] || tickets[0] || null,
  };
}
function crewHydrovacPermitSummary(job = ACTIVE_JOB) {
  const permits = Array.isArray(job?.permits)
    ? job.permits
    : Array.isArray(job?.confined_space_permits)
      ? job.confined_space_permits
      : [];
  const referenceTime = crewJobReferenceTime(job);
  const openPermits = permits.filter((permit) => String(permit?.status || '').trim().toLowerCase() === 'open');
  const expiredOpen = openPermits.filter((permit) => {
    const until = Date.parse(permit?.permit_valid_until || '');
    return Number.isFinite(until) && until < referenceTime;
  });
  return {
    permits,
    openCount: openPermits.length,
    expiredOpenCount: expiredOpen.length,
    primary: openPermits[0] || permits[0] || null,
    required: job?.requires_confined_space_permit === true,
  };
}
const CREW_HYDROVAC_LOAD_STATUS_LABELS = {
  truck_clear: 'Truck clear',
  live_load_remaining: 'Live load remaining',
  no_load: 'No load hauled',
};
const CREW_HYDROVAC_PERMIT_STATUS_LABELS = {
  not_required: 'Not required',
  open_and_safe: 'Open and safe',
  closed: 'Closed',
  needs_office_followup: 'Needs office follow-up',
};
const CREW_HYDROVAC_FOLLOW_UP_OPTIONS = [
  { key: 'customer_records', label: 'Customer records' },
  { key: 'audit_packet', label: 'Audit packet' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'disposal_ticket', label: 'Disposal ticket' },
  { key: 'site_return', label: 'Site return' },
];

function crewJobMetadata(job = ACTIVE_JOB) {
  return job?.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
    ? job.metadata
    : {};
}

function crewHydrovacCompletionHandoff(job = ACTIVE_JOB) {
  if (job?.completion_handoff && typeof job.completion_handoff === 'object' && !Array.isArray(job.completion_handoff)) {
    return job.completion_handoff;
  }
  const metadata = crewJobMetadata(job);
  if (metadata.crew_closeout && typeof metadata.crew_closeout === 'object' && !Array.isArray(metadata.crew_closeout)) {
    return metadata.crew_closeout;
  }
  return null;
}

function crewHydrovacPermitStatusRequired(job = ACTIVE_JOB) {
  const permit = crewHydrovacPermitSummary(job);
  return job?.requires_confined_space_permit === true || permit.permits.length > 0;
}

function crewHydrovacLoadStatusLabel(value = '') {
  return CREW_HYDROVAC_LOAD_STATUS_LABELS[String(value || '').trim()] || 'Not captured';
}

function crewHydrovacPermitStatusLabel(value = '') {
  return CREW_HYDROVAC_PERMIT_STATUS_LABELS[String(value || '').trim()] || 'Not captured';
}

function crewHydrovacFollowUpLabel(value = '') {
  const option = CREW_HYDROVAC_FOLLOW_UP_OPTIONS.find((item) => item.key === value);
  return option?.label || value || 'Office follow-up';
}

function completionFieldValue(id) {
  const element = document.getElementById(id);
  if (!element) return '';
  return String(element.value || '').trim();
}

function normalizeCompletionText(value, max = 800) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function collectHydrovacCompletionHandoff(job = ACTIVE_JOB) {
  const root = document.getElementById('completionHydrovacFields');
  const officeFollowUp = root
    ? Array.from(root.querySelectorAll('[data-completion-followup].is-active'))
      .map((button) => String(button.getAttribute('data-completion-followup') || '').trim())
      .filter(Boolean)
    : [];
  return {
    load_status: completionFieldValue('completionLoadStatus'),
    bol_number: completionFieldValue('completionBolNumber'),
    live_load_hold_reason: normalizeCompletionText(completionFieldValue('completionLiveLoadHoldReason'), 240),
    disposal_ready_by: completionFieldValue('completionDisposalReadyBy'),
    locates_verified_on_site: (() => {
      const value = completionFieldValue('completionLocatesVerified');
      if (value === 'true') return true;
      if (value === 'false') return false;
      return null;
    })(),
    permit_status: completionFieldValue('completionPermitStatus'),
    permit_note: normalizeCompletionText(completionFieldValue('completionPermitNote'), 240),
    field_summary: normalizeCompletionText(completionFieldValue('completionFieldSummary'), 800),
    customer_note: normalizeCompletionText(completionFieldValue('completionCustomerNote'), 400),
    office_follow_up: [...new Set(officeFollowUp)],
    permit_status_required: crewHydrovacPermitStatusRequired(job),
  };
}

function validateHydrovacCompletionHandoff(handoff, job = ACTIVE_JOB) {
  const errors = [];
  const permitRequired = crewHydrovacPermitStatusRequired(job);
  if (!handoff?.field_summary) errors.push('Add the field summary so the office knows what actually happened on site.');
  if (!handoff?.load_status) errors.push('Choose the load status before you submit the closeout.');
  if (handoff?.load_status === 'live_load_remaining' && !handoff?.live_load_hold_reason) {
    errors.push('Explain why the live load is still riding with the truck.');
  }
  if (handoff?.load_status === 'live_load_remaining' && !handoff?.disposal_ready_by) {
    errors.push('Set the disposal-ready date for the live load still on the truck.');
  }
  if (permitRequired && !handoff?.permit_status) {
    errors.push('Choose the permit status before you submit the closeout.');
  }
  if (permitRequired && handoff?.permit_status === 'not_required') {
    errors.push('This job already carries permit pressure, so the permit status cannot be Not required.');
  }
  return {
    ok: errors.length === 0,
    error: errors[0] || '',
    errors,
  };
}

function buildCrewHydrovacCompletionNarrative(handoff = {}) {
  const followUp = Array.isArray(handoff.office_follow_up) && handoff.office_follow_up.length
    ? handoff.office_follow_up.map((item) => crewHydrovacFollowUpLabel(item)).join(', ')
    : 'None';
  const locateSummary = handoff.locates_verified_on_site === true
    ? 'Locate verified on site.'
    : handoff.locates_verified_on_site === false
      ? 'Locate still needs office follow-up.'
      : 'Locate verification not captured.';
  const loadSummary = handoff.load_status === 'truck_clear'
    ? 'Truck clear.'
    : handoff.load_status === 'no_load'
      ? 'No load hauled.'
      : `Live load remains${handoff.disposal_ready_by ? ` until ${handoff.disposal_ready_by}` : ''}${handoff.live_load_hold_reason ? ` (${handoff.live_load_hold_reason})` : ''}.`;
  return [
    `Hydrovac closeout: ${loadSummary}`,
    handoff.bol_number ? `BOL ${handoff.bol_number}.` : '',
    locateSummary,
    handoff.permit_status ? `Permit ${crewHydrovacPermitStatusLabel(handoff.permit_status).toLowerCase()}.` : '',
    handoff.field_summary ? `Field summary: ${handoff.field_summary}` : '',
    handoff.customer_note ? `Customer note: ${handoff.customer_note}` : '',
    `Office follow-up: ${followUp}.`,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
function crewHydrovacSignalTone(kind = '') {
  if (kind === 'danger') return 'job-card__signal--danger';
  if (kind === 'warn') return 'job-card__signal--warn';
  if (kind === 'good') return 'job-card__signal--good';
  return '';
}
function renderCrewSitePacketCard(job = ACTIVE_JOB) {
  const packet = crewSitePacket(job);
  const businessKey = crewBusinessKey(job);
  const siteLabel = String(packet.site_label || '').trim();
  const siteAddress = String(packet.site_address || job?.service_address || job?.address || '').trim();
  const accessNotes = String(packet.access_notes || '').trim();
  const siteNotes = String(packet.site_notes || '').trim();
  const contactName = String(packet.contact_name || crewCustomerRef(job)?.name || '').trim();
  const contactPhone = String(packet.contact_phone || crewCustomerRef(job)?.phone || '').trim();
  const photoCount = Number(packet.current_photo_count || 0);
  const recentWork = Array.isArray(packet.recent_work) ? packet.recent_work.filter(Boolean).slice(0, 3) : [];

  if (!siteLabel && !siteAddress && !accessNotes && !siteNotes && !contactName && !contactPhone && !recentWork.length && !photoCount) {
    return '';
  }

  return `
    <div class="field-handoff-card">
      <div class="field-handoff-card__head">
        <div>
          <div class="field-handoff-card__eyebrow">${escHtml(['hydrovac', 'vactor', 'hydrovac_vactor'].includes(businessKey) ? 'Field packet' : 'Site packet')}</div>
          <div class="field-handoff-card__title">${escHtml(siteLabel || 'Keep the office handoff attached to the field visit')}</div>
        </div>
        <span class="status-pill ${recentWork.length ? 'status-inprogress' : 'status-scheduled'}">${escHtml(recentWork.length ? `${recentWork.length} recent stop${recentWork.length === 1 ? '' : 's'}` : 'Fresh visit')}</span>
      </div>
      ${siteAddress ? `<div class="field-handoff-card__address">${escHtml(siteAddress)}</div>` : ''}
      <div class="field-handoff-card__grid">
        <div class="field-handoff-card__item">
          <span>Access</span>
          <strong>${escHtml(accessNotes || 'No gate, lockbox, or entry note is attached yet.')}</strong>
        </div>
        <div class="field-handoff-card__item">
          <span>Contact</span>
          <strong>${escHtml([contactName, contactPhone].filter(Boolean).join(' | ') || 'No field contact is attached yet.')}</strong>
        </div>
        <div class="field-handoff-card__item">
          <span>Site memory</span>
          <strong>${escHtml(siteNotes || 'No recent property or scope memory is attached yet.')}</strong>
        </div>
        <div class="field-handoff-card__item">
          <span>Proof on file</span>
          <strong>${escHtml(photoCount ? `${photoCount} photo${photoCount === 1 ? '' : 's'} already attached` : 'No proof photos are attached yet.')}</strong>
        </div>
      </div>
      ${recentWork.length ? `
        <div class="field-handoff-card__recent">
          <div class="field-handoff-card__subhead">Recent site work</div>
          <div class="field-handoff-card__list">
            ${recentWork.map((item) => `
              <div class="field-handoff-card__list-item">
                <strong>${escHtml(item.title || 'Recent work')}</strong>
                <span>${escHtml([
                  statusLabel(String(item.status || '').trim().toLowerCase()) || item.status || '',
                  item.scheduled_date || '',
                ].filter(Boolean).join(' | ') || 'Earlier site activity')}</span>
                ${item.notes ? `<small>${escHtml(item.notes)}</small>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}
function renderCrewHydrovacJobSignals(job = ACTIVE_JOB) {
  const manifest = crewHydrovacManifestSummary(job);
  const locate = crewHydrovacLocateSummary(job);
  const permit = crewHydrovacPermitSummary(job);
  const signals = [];

  if (manifest.liveLoadCount > 0) {
    signals.push({
      label: manifest.manifestNumber ? `Live load ${manifest.manifestNumber}` : `Live load x${manifest.liveLoadCount}`,
      tone: manifest.readyBy ? 'warn' : 'danger',
    });
  } else {
    signals.push({ label: 'Truck clear', tone: 'good' });
  }

  if (locate.expired > 0) {
    signals.push({ label: `${locate.expired} locate expired`, tone: 'danger' });
  } else if (locate.activeCount > 0) {
    signals.push({ label: `${locate.activeCount} locate active`, tone: locate.expiringSoon ? 'warn' : 'good' });
  }

  if (permit.expiredOpenCount > 0) {
    signals.push({ label: `${permit.expiredOpenCount} permit expired`, tone: 'danger' });
  } else if (permit.openCount > 0) {
    signals.push({ label: `${permit.openCount} permit open`, tone: 'good' });
  } else if (permit.required) {
    signals.push({ label: 'Permit needed', tone: 'warn' });
  }

  if (!signals.length) return '';
  return `
    <div class="job-card__signals">
      ${signals.map((signal) => `
        <span class="job-card__signal ${crewHydrovacSignalTone(signal.tone)}">${escHtml(signal.label)}</span>
      `).join('')}
    </div>
  `;
}
function renderCrewHydrovacFieldCard(job = ACTIVE_JOB) {
  if (!['hydrovac', 'vactor', 'hydrovac_vactor'].includes(crewBusinessKey(job))) return '';
  const manifest = crewHydrovacManifestSummary(job);
  const locate = crewHydrovacLocateSummary(job);
  const permit = crewHydrovacPermitSummary(job);
  const statusTone = manifest.liveLoadCount > 0 || locate.expired > 0 || permit.expiredOpenCount > 0
    ? 'status-pill status-blocked'
    : (locate.expiringSoon > 0 || (permit.required && permit.openCount === 0))
      ? 'status-pill status-inprogress'
      : 'status-pill status-completed';
  const statusLabelText = manifest.liveLoadCount > 0 || locate.expired > 0 || permit.expiredOpenCount > 0
    ? 'Field watch'
    : (locate.expiringSoon > 0 || (permit.required && permit.openCount === 0))
      ? 'Prep tight'
      : 'Field clear';

  return `
    <div class="field-command-card">
      <div class="field-command-card__head">
        <div>
          <div class="field-command-card__eyebrow">Hydrovac command</div>
          <div class="field-command-card__title">Keep the truck plan, locate, and permit state obvious</div>
        </div>
        <span class="${statusTone}">${statusLabelText}</span>
      </div>
      <div class="field-command-card__copy">${escHtml(
        manifest.liveLoadCount > 0
          ? 'Truck load state is still active, so the crew should treat isolation, BOL, and disposal timing like part of the job.'
          : locate.expired > 0
            ? 'Locate coverage has already lapsed. Do not let the field guess around expired paperwork.'
            : permit.required && permit.openCount === 0
              ? 'This job still needs permit coverage visible before confined-space entry becomes a field decision.'
              : 'Hydrovac paperwork looks steady. Keep the office handoff intact as the field work moves.'
      )}</div>
      <div class="field-command-card__grid">
        <div class="field-command-card__item ${manifest.liveLoadCount > 0 ? 'field-command-card__item--warn' : 'field-command-card__item--good'}">
          <span>Truck load plan</span>
          <strong>${escHtml(manifest.liveLoadCount > 0 ? (manifest.manifestNumber || `${manifest.liveLoadCount} live load${manifest.liveLoadCount === 1 ? '' : 's'}`) : 'Truck clear')}</strong>
          <small>${escHtml(manifest.liveLoadCount > 0 ? (manifest.holdReason || 'The office still needs the live-load reason documented clearly.') : 'No live load is riding with the truck right now.')}</small>
        </div>
        <div class="field-command-card__item ${locate.expired > 0 ? 'field-command-card__item--danger' : locate.activeCount > 0 ? 'field-command-card__item--good' : 'field-command-card__item--warn'}">
          <span>Locate coverage</span>
          <strong>${escHtml(locate.expired > 0 ? 'Expired' : locate.activeCount > 0 ? `${locate.activeCount} active` : 'Not visible')}</strong>
          <small>${escHtml(locate.expired > 0 ? 'Expired locate coverage should be cleared with the office before excavation continues.' : locate.primary?.ticket_number ? `Primary ticket: ${locate.primary.ticket_number}` : 'No active locate ticket is attached to this job.')}</small>
        </div>
        <div class="field-command-card__item ${permit.expiredOpenCount > 0 ? 'field-command-card__item--danger' : permit.openCount > 0 ? 'field-command-card__item--good' : permit.required ? 'field-command-card__item--warn' : ''}">
          <span>Permit state</span>
          <strong>${escHtml(permit.expiredOpenCount > 0 ? 'Expired open permit' : permit.openCount > 0 ? `${permit.openCount} open` : permit.required ? 'Required' : 'Not required')}</strong>
          <small>${escHtml(permit.primary?.permit_number ? `Permit ${permit.primary.permit_number} stays tied to this entry.` : permit.required ? 'Confined-space coverage is still expected here.' : 'No confined-space permit is driving this job.')}</small>
        </div>
        <div class="field-command-card__item ${manifest.readyBy ? 'field-command-card__item--warn' : ''}">
          <span>Disposal timing</span>
          <strong>${escHtml(manifest.readyBy || 'No live-load timer')}</strong>
          <small>${escHtml(manifest.readyBy ? `Clear the carried load by ${manifest.readyBy} so the next dispatch does not inherit it.` : 'No disposal-ready deadline is attached to a live load right now.')}</small>
        </div>
      </div>
    </div>
  `;
}

async function getToken() {
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data?.session?.access_token || null;
  } catch {
    return null;
  }
}

function isOnline() {
  return navigator.onLine;
}

// ── IndexedDB ──────────────────────────────────────────────────────────────────

async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('prooflink-crew', 1);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('jobs')) {
        db.createObjectStore('jobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
    };

    req.onsuccess = (e) => {
      const db = e.target.result;

      resolve({
        get(store, key) {
          return new Promise((res, rej) => {
            const tx = db.transaction(store, 'readonly');
            const r  = tx.objectStore(store).get(key);
            r.onsuccess = () => res(r.result);
            r.onerror   = () => rej(r.error);
          });
        },
        set(store, key, value) {
          return new Promise((res, rej) => {
            const tx = db.transaction(store, 'readwrite');
            const os = tx.objectStore(store);
            const r  = key === undefined
              ? os.put(value)
              : os.keyPath
                ? os.put({
                  ...value,
                  [os.keyPath]: value?.[os.keyPath] ?? key,
                })
                : os.put(value, key);
            r.onsuccess = () => res(r.result);
            r.onerror   = () => rej(r.error);
          });
        },
        getAll(store) {
          return new Promise((res, rej) => {
            const tx = db.transaction(store, 'readonly');
            const r  = tx.objectStore(store).getAll();
            r.onsuccess = () => res(r.result || []);
            r.onerror   = () => rej(r.error);
          });
        },
        delete(store, key) {
          return new Promise((res, rej) => {
            const tx = db.transaction(store, 'readwrite');
            const r  = tx.objectStore(store).delete(key);
            r.onsuccess = () => res();
            r.onerror   = () => rej(r.error);
          });
        },
        clear(store) {
          return new Promise((res, rej) => {
            const tx = db.transaction(store, 'readwrite');
            const r  = tx.objectStore(store).clear();
            r.onsuccess = () => res();
            r.onerror   = () => rej(r.error);
          });
        },
        addToStore(store, value) {
          return new Promise((res, rej) => {
            const tx = db.transaction(store, 'readwrite');
            const r  = tx.objectStore(store).add(value);
            r.onsuccess = () => res(r.result);
            r.onerror   = () => rej(r.error);
          });
        },
      });
    };

    req.onerror = () => reject(req.error);
  });
}

async function saveJobsToIDB(jobs) {
  if (!DB) return;
  try {
    await DB.clear('jobs');
    for (const job of jobs) {
      await DB.set('jobs', job.id, job);
    }
  } catch (err) {
    console.warn('[IDB] Failed to save jobs:', err);
  }
}

async function loadJobsFromIDB() {
  if (!DB) return [];
  try {
    return await DB.getAll('jobs');
  } catch {
    return [];
  }
}

function mergeJobsForCache(existing = [], incoming = []) {
  const merged = new Map();
  for (const job of existing) {
    if (job?.id) merged.set(job.id, job);
  }
  for (const job of incoming) {
    if (job?.id) merged.set(job.id, job);
  }
  return Array.from(merged.values());
}

function upcomingWindowDateStrings() {
  const today = new Date();
  const plus7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return {
    today: today.toISOString().slice(0, 10),
    plus7: plus7.toISOString().slice(0, 10),
  };
}

function filterUpcomingJobs(jobs = []) {
  const { today, plus7 } = upcomingWindowDateStrings();
  return (Array.isArray(jobs) ? jobs : [])
    .filter((job) => {
      const scheduledDate = String(job?.scheduled_date || '').trim();
      if (!scheduledDate) return false;
      if (scheduledDate < today || scheduledDate > plus7) return false;
      const status = String(job?.status || '').trim().toLowerCase();
      return status !== 'cancelled' && status !== 'completed';
    })
    .sort((left, right) => {
      const leftKey = `${left?.scheduled_date || ''}T${left?.scheduled_time || '00:00:00'}`;
      const rightKey = `${right?.scheduled_date || ''}T${right?.scheduled_time || '00:00:00'}`;
      return leftKey.localeCompare(rightKey);
    });
}

async function persistQueue() {
  if (!DB) return;
  try {
    await DB.clear('queue');
    for (const item of OFFLINE_QUEUE) {
      await DB.addToStore('queue', item);
    }
  } catch (err) {
    console.warn('[IDB] Failed to persist queue:', err);
  }
}

async function loadQueueFromIDB() {
  if (!DB) return [];
  try {
    return await DB.getAll('queue');
  } catch {
    return [];
  }
}

// ── Navigation / Screens ───────────────────────────────────────────────────────

function showScreen(name, direction = 'forward') {
  const screens = document.querySelectorAll('.screen');
  screens.forEach((s) => {
    s.classList.remove('active', 'screen-active', 'slide-in-right', 'slide-in-left',
                        'slide-out-right', 'slide-out-left', 'sliding-out');
    s.style.display = 'none';
  });

  const target = resolveCrewScreenElement(name);
  if (!target) {
    console.warn('[showScreen] No screen found:', name);
    return;
  }

  syncBottomNav(name);
  target.style.display = 'flex';
  // Trigger animation on next frame so display:flex is painted first
  requestAnimationFrame(() => {
    target.classList.add('active', 'screen-active');
  });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

let _toastTimer = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.className   = 'toast toast-' + type + ' toast-visible';

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('toast-visible');
  }, 3500);
}

function complianceIssueMessage(body = {}, fallback = '') {
  const issues = Array.isArray(body.issues) ? body.issues : [];
  if (issues.length) {
    return issues.map((issue) => issue.message || issue.code || '').filter(Boolean).join(' ');
  }
  return body.error || fallback || 'This step is blocked until the required compliance item is handled.';
}

function fieldActionGuidance(status, job = ACTIVE_JOB) {
  const blockerNote = String(job?.blocker_note || '').trim();
  const complianceMessage = String(job?.compliance_message || '').trim();
  const businessKey = crewBusinessKey(job);
  const customer = crewCustomerRef(job);
  const packet = crewSitePacket(job);
  const routeNote = String(customer?.service_schedule || customer?.frequency || '').trim();
  const accessNote = String(packet.access_notes || customer?.access_notes || customer?.entry_notes || customer?.alarm_notes || customer?.gate_notes || '').trim();
  const systemNote = String(customer?.equipment_notes || customer?.system_notes || customer?.diagnostic_notes || '').trim();
  const plumbingNote = String(customer?.shutoff_notes || customer?.issue_summary || customer?.approval_notes || '').trim();
  const siteNote = String(packet.site_notes || '').trim();
  const hydrovacManifest = crewHydrovacManifestSummary(job);

  if (complianceMessage) {
    return complianceMessage;
  }
  if (blockerNote) {
    return `Blocked: ${blockerNote}`;
  }
  if (status === 'scheduled' || status === 'dispatched') {
    if (['landscaping', 'property_maintenance', 'pressure_washing'].includes(businessKey)) {
      return routeNote
        ? `Clock in when you are on site. Keep the route and property note in mind: ${routeNote}`
        : 'Clock in when you are on site. Confirm gates, property access, and the exact area of work before unloading.';
    }
    if (businessKey === 'cleaning') {
      return accessNote
        ? `Clock in when you are on site. Confirm entry and visit access before you start: ${accessNote}`
        : 'Clock in when you are on site. Confirm entry, alarm, or lockbox instructions before the visit begins.';
    }
    if (businessKey === 'hvac') {
      return systemNote
        ? `Clock in when you are on site. Start from the system note already attached to this call: ${systemNote}`
        : 'Clock in when you are on site. Confirm the unit, system, and who is meeting you before diagnosis starts.';
    }
    if (businessKey === 'plumbing') {
      return plumbingNote
        ? `Clock in when you are on site. Keep the repair and shutoff note in mind before you begin: ${plumbingNote}`
        : 'Clock in when you are on site. Confirm shutoff access, fixture context, and approval limits before opening anything up.';
    }
    if (['hydrovac', 'vactor', 'hydrovac_vactor'].includes(businessKey)) {
      if (hydrovacManifest.liveLoadCount > 0) {
        return hydrovacManifest.bolNumber && hydrovacManifest.holdReason
          ? `Clock in when you are on site only after you confirm the live load plan. Truck still carries ${hydrovacManifest.manifestNumber || 'a documented load'} under BOL ${hydrovacManifest.bolNumber}, so keep that load isolated and follow the hold reason: ${hydrovacManifest.holdReason}`
          : 'Clock in when you are on site only after the office confirms the live load is documented. Keep the truck isolated until the BOL and hold reason are attached.';
      }
      if (accessNote) {
        return `Clock in when you are on site. Confirm truck clearance, site access, and where the crew should stage before excavation starts: ${accessNote}`;
      }
      return 'Clock in when you are on site. Confirm the truck is cleared, the BOL packet is with the truck, and disposal timing will not stall this job before you begin.';
    }
    if (siteNote) {
      return `Clock in when you are on site. Start from the handoff already attached to this visit: ${siteNote}`;
    }
    return 'Clock in when you are on site. If access, scope, safety, or compliance is not ready, report the issue before work begins.';
  }
  if (status === 'in_progress') {
    if (businessKey === 'cleaning') {
      return 'Keep the visit checklist, add-ons, and access details current so the office can close this cleaning visit out without guesswork.';
    }
    if (businessKey === 'hvac') {
      return 'Keep the diagnostic finding, equipment details, and parts follow-up current so the office can invoice and schedule the next step without guesswork.';
    }
    if (businessKey === 'plumbing') {
      return 'Keep the repair result, shutoff context, and any approval or restoration note current so closeout is clear and defensible.';
    }
    if (['hydrovac', 'vactor', 'hydrovac_vactor'].includes(businessKey)) {
      return 'Keep the load record, BOL, disposal timing, and any live-load hold reason current so the office can prevent cross contamination before the next dispatch.';
    }
    return 'Keep notes, photos, and customer details current so closeout is quick and the office can invoice without guesswork.';
  }
  if (status === 'blocked') {
    return 'Work is paused. Tell the office exactly what is stopping progress so they can clear it before another trip is needed.';
  }
  if (status === 'completed') {
    return 'Job complete. The office can now handle any remaining invoice or customer follow-through from this record.';
  }
  if (status === 'cancelled') {
    return 'This job has been cancelled.';
  }
  return '';
}

function crewJobMemoryItems(job = ACTIVE_JOB) {
  const items = [];
  const businessKey = crewBusinessKey(job);
  const customer = crewCustomerRef(job);
  const packet = crewSitePacket(job);
  const serviceAddress = String(packet.site_address || job?.service_address || job?.address || '').trim();
  const customerPhone = String(packet.contact_phone || customer?.phone || '').trim();
  const customerEmail = String(packet.contact_email || customer?.email || '').trim();
  const workNotes = String(packet.site_notes || job?.description || job?.notes || '').trim();
  const hydrovacManifest = crewHydrovacManifestSummary(job);
  const accessNotes = String(packet.access_notes || '').trim();
  const recentWork = Array.isArray(packet.recent_work) ? packet.recent_work.filter(Boolean) : [];

  if (String(packet.site_label || '').trim()) {
    items.push(`Site packet: ${String(packet.site_label).trim()}`);
  }

  if (serviceAddress) {
    items.push(`Service location: ${serviceAddress}`);
  } else {
    items.push('Service location is missing. Confirm the address with the office before you travel.');
  }

  if (customerPhone || customerEmail) {
    const contactParts = [];
    if (customerPhone) contactParts.push(customerPhone);
    if (customerEmail) contactParts.push(customerEmail);
    items.push(`Customer contact: ${contactParts.join(' | ')}`);
  } else {
    items.push('Customer contact is missing. Ask the office for the best number before access becomes a problem.');
  }

  if (workNotes) {
    items.push(`Scope and notes: ${workNotes}`);
  } else {
    items.push('Scope and notes are still light. Add a field note if the work changes so the office can finish strong.');
  }

  if (accessNotes) {
    items.push(`Access and staging: ${accessNotes}`);
  }

  if (recentWork.length) {
    const latest = recentWork[0];
    const parts = [latest.title || 'Recent site work'];
    if (latest.status) parts.push(statusLabel(String(latest.status).trim().toLowerCase()) || latest.status);
    if (latest.scheduled_date) parts.push(latest.scheduled_date);
    items.push(`Recent site work: ${parts.filter(Boolean).join(' | ')}`);
  }

  if (['landscaping', 'property_maintenance', 'pressure_washing'].includes(businessKey)) {
    const routeNote = String(customer?.service_schedule || customer?.frequency || customer?.seasonal_notes || '').trim();
    items.push(routeNote
      ? `Route and property note: ${routeNote}`
      : 'Route or seasonal context is still light. Confirm the property focus before the crew loses time on the wrong area.');
  } else if (businessKey === 'cleaning') {
    const accessNote = String(customer?.access_notes || customer?.alarm_notes || customer?.entry_notes || '').trim();
    const checklistNote = String(customer?.checklist_notes || customer?.scope_notes || customer?.add_on_notes || '').trim();
    items.push(accessNote
      ? `Entry and access: ${accessNote}`
      : 'Entry instructions are still light. Confirm lockbox, alarm, or entry details before the crew gets stuck outside.');
    items.push(checklistNote
      ? `Visit checklist: ${checklistNote}`
      : 'Checklist and add-ons are still light. Confirm the rooms or add-ons before the visit drifts off scope.');
  } else if (businessKey === 'hvac') {
    const systemNote = String(customer?.equipment_notes || customer?.system_notes || customer?.equipment_serial || '').trim();
    const diagnosticNote = String(customer?.diagnostic_notes || customer?.failure_symptoms || customer?.parts_follow_up || '').trim();
    items.push(systemNote
      ? `System context: ${systemNote}`
      : 'System details are still light. Confirm the unit or equipment details before diagnosis begins.');
    items.push(diagnosticNote
      ? `Diagnostic handoff: ${diagnosticNote}`
      : 'Diagnostic context is still light. Ask the office what symptom or part follow-up already exists before starting.');
  } else if (businessKey === 'plumbing') {
    const shutoffNote = String(customer?.shutoff_notes || customer?.access_notes || customer?.entry_notes || '').trim();
    const repairNote = String(customer?.issue_summary || customer?.fixture_notes || customer?.approval_notes || '').trim();
    items.push(shutoffNote
      ? `Shutoff and access: ${shutoffNote}`
      : 'Shutoff or access details are still light. Confirm those before the repair gets riskier than it needs to be.');
    items.push(repairNote
      ? `Repair context: ${repairNote}`
      : 'Repair context is still light. Ask the office what fixture, issue, or approval limit should guide this visit.');
  } else if (['hydrovac', 'vactor', 'hydrovac_vactor'].includes(businessKey)) {
    if (hydrovacManifest.liveLoadCount > 0) {
      items.push(`Live load on truck: ${hydrovacManifest.manifestNumber || `${hydrovacManifest.liveLoadCount} load${hydrovacManifest.liveLoadCount === 1 ? '' : 's'} still onboard`}`);
      items.push(hydrovacManifest.bolNumber
        ? `Bill of lading: ${hydrovacManifest.bolNumber}`
        : 'Bill of lading is missing. Stop and confirm the BOL before this load moves to another job.');
      items.push(hydrovacManifest.holdReason
        ? `Live-load plan: ${hydrovacManifest.holdReason}`
        : 'Live-load plan is missing. Ask the office why this load is still riding with the truck before you continue.');
      if (hydrovacManifest.readyBy) {
        items.push(`Disposal timing: Clear this load by ${hydrovacManifest.readyBy} so tomorrow does not get blocked.`);
      }
      if (hydrovacManifest.isolationNote) {
        items.push(`Isolation note: ${hydrovacManifest.isolationNote}`);
      }
    } else {
      items.push('Truck load status: Confirm the truck is cleared or the live-load packet is attached before hydrovac work begins.');
    }
  }

  return items;
}

function renderCrewJobMemory(job = ACTIVE_JOB) {
  const items = crewJobMemoryItems(job);
  if (!items.length) return '';

  return `
    <div class="status-note">
      <strong>Keep in mind before you move this job forward:</strong>
      <ul>
        ${items.map((item) => `<li>${escHtml(item)}</li>`).join('')}
      </ul>
    </div>`;
}

// ── Supabase Bootstrap ─────────────────────────────────────────────────────────

function loadSupabaseScript() {
  return new Promise((resolve, reject) => {
    if (window.supabase && window.supabase.createClient) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src   = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Supabase SDK'));
    document.head.appendChild(script);
  });
}

// ── App Init ───────────────────────────────────────────────────────────────────

async function initApp() {
  PENDING_LAUNCH_JOB_ID = crewLaunchJobIdFromLocation();
  PENDING_LAUNCH_SOURCE = crewLaunchSourceFromLocation();
  try {
    await loadSupabaseScript();
  } catch (err) {
    showFatalError('Could not load app dependencies. Please check your connection.');
    return;
  }

  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Open IndexedDB
  try {
    DB = await openDB();
    OFFLINE_QUEUE = await loadQueueFromIDB();
  } catch (err) {
    console.warn('[initApp] IndexedDB unavailable:', err);
  }

  // Set up online/offline listeners
  setupOfflineSync();

  // Register service worker
  registerServiceWorker();

  // Check existing session
  let session = null;
  try {
    const { data } = await sb.auth.getSession();
    session = data?.session || null;
  } catch (err) {
    console.warn('[initApp] getSession error:', err);
  }

  if (session) {
    SESSION = session;
    try {
      await loadMember();
      await showHome();
    } catch (err) {
      console.warn('[initApp] loadMember failed, showing login:', err);
      showScreen('login');
    }
  } else {
    showScreen('login');
  }

  // Auth state changes
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      clearAppState();
      showScreen('login');
    } else if (event === 'TOKEN_REFRESHED' && session) {
      SESSION = session;
    }
  });
}

function showFatalError(message) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;
                font-family:-apple-system,sans-serif;background:#0f1117;color:#e8e9eb;text-align:center;">
      <div>
        <div style="font-size:2.5rem;margin-bottom:16px;">!</div>
        <p style="font-size:1rem;color:rgba(255,255,255,.7);">${message}</p>
        <button onclick="location.reload()"
          style="margin-top:20px;padding:10px 24px;background:#c84b2f;color:#fff;
                 border:none;border-radius:6px;cursor:pointer;font-size:.95rem;">
          Retry
        </button>
      </div>
    </div>`;
}

function clearAppState() {
  SESSION    = null;
  MEMBER     = null;
  JOBS       = [];
  ACTIVE_JOB = null;
  stopTimer();
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/crew/sw.js');
    } catch {
      // SW optional — don't block app
    }
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────────

async function signIn(email, password) {
  const btn = document.getElementById('btnSignIn');
  const err = document.getElementById('loginError');
  if (err) {
    err.textContent = '';
    err.style.display = 'none';
    err.classList.add('hidden');
  }

  if (!email || !password) {
    showLoginError('Please enter your email and password.');
    return;
  }

  setButtonLoading(btn, true, 'Signing in...');

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    SESSION = data.session;
    let bootstrapped = false;
    try {
      await loadMember();
      bootstrapped = true;
    } catch (bootstrapErr) {
      console.warn('[signIn] member bootstrap fell back to local shell:', bootstrapErr);
      MEMBER = MEMBER || {
        id: data?.user?.id || null,
        name: data?.user?.user_metadata?.full_name || data?.user?.email || email || 'Crew Member',
        role: 'member',
        role_title: 'Crew Member',
      };
      showToast('Could not refresh your jobs yet. Loading the field shell.', 'info');
    }
    await showHome({ reload: !bootstrapped });
  } catch (err) {
    showLoginError(err.message || 'Sign-in failed. Check your credentials.');
  } finally {
    setButtonLoading(btn, false, 'Sign In');
  }
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.display = 'block';
  }
}

async function signOut() {
  try {
    await sb.auth.signOut();
  } catch { /* ignore */ }
  clearAppState();
  showScreen('login');
}

async function loadMember() {
  const token = await getToken();
  if (!token) throw new Error('No auth token');

  // Load today's jobs which also returns the member record
  const res = await fetch(`/.netlify/functions/get-crew-jobs?date=${todayString()}`, {
    headers: {
      'Authorization' : 'Bearer ' + token,
      'Content-Type'  : 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  const { jobs, member } = await res.json();
  MEMBER = member; // { id, name, role, role_title }
  JOBS   = jobs || [];
  await saveJobsToIDB(JOBS);
}

// ── Home / Job List ────────────────────────────────────────────────────────────

function renderCurrentDateLabel(targetDate = CURRENT_DATE) {
  const dateLabel = document.getElementById('currentDateLabel');
  if (!dateLabel) return;
  dateLabel.textContent = targetDate === todayString()
    ? 'Today'
    : formatDate(targetDate + 'T00:00:00');
}

async function showHome({ reload = true } = {}) {
  // Populate member name in header
  const nameEl = document.getElementById('memberName');
  if (nameEl && MEMBER) nameEl.textContent = MEMBER.name || 'Crew Member';

  showScreen('home', 'back');
  if (reload) {
    await loadJobs(CURRENT_DATE);
  } else {
    renderJobCards(JOBS || []);
    renderCurrentDateLabel(CURRENT_DATE);
  }
  window.PROOFLINK_CREW_BOOT_READY = true;
}

async function loadJobs(date = null) {
  const targetDate = date || todayString();
  CURRENT_DATE = targetDate;

  const list = document.getElementById('jobsList');
  if (list) list.innerHTML = skeletonCards(3);

  const token = await getToken();

  if (!token || !isOnline()) {
    // Offline fallback
    const cached = await loadJobsFromIDB();
    JOBS = cached.filter((j) => j.scheduled_date === targetDate);
    renderJobCards(JOBS);
    if (!isOnline()) showToast('Offline. Showing saved jobs.', 'info');
    return;
  }

  try {
    const res = await fetch(`/.netlify/functions/get-crew-jobs?date=${targetDate}`, {
      headers: {
        'Authorization' : 'Bearer ' + token,
        'Content-Type'  : 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    const { jobs, member } = await res.json();
    if (member) MEMBER = member;
    JOBS = jobs || [];
    await saveJobsToIDB(mergeJobsForCache(await loadJobsFromIDB(), JOBS));
    renderJobCards(JOBS);
    await maybeOpenRequestedCrewJob(JOBS);

    // Update date label
    renderCurrentDateLabel(targetDate);
  } catch (err) {
    console.error('[loadJobs]', err);
    const cached = await loadJobsFromIDB();
    JOBS = cached;
    renderJobCards(JOBS);
    await maybeOpenRequestedCrewJob(JOBS);
    showToast('Could not refresh. Showing saved data.', 'error');
  }
}

async function loadUpcomingJobs() {
  showScreen('schedule');
  const list = document.getElementById('scheduleList');
  if (list) list.innerHTML = skeletonCards(5);

  const token = await getToken();
  if (!token) { showToast('Please sign in again.', 'error'); return; }

  try {
    const res = await fetch('/.netlify/functions/get-crew-jobs?upcoming=true', {
      headers: {
        'Authorization' : 'Bearer ' + token,
        'Content-Type'  : 'application/json',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { jobs } = await res.json();
    const upcomingJobs = jobs || [];
    renderScheduleList(upcomingJobs);
    await saveJobsToIDB(mergeJobsForCache(await loadJobsFromIDB(), upcomingJobs));
    window.PROOFLINK_CREW_BOOT_READY = true;
  } catch (err) {
    console.error('[loadUpcomingJobs]', err);
    const cachedUpcoming = filterUpcomingJobs(await loadJobsFromIDB());
    if (cachedUpcoming.length) {
      renderScheduleList(cachedUpcoming);
      showToast('Schedule could not refresh. Showing saved jobs.', 'info');
      window.PROOFLINK_CREW_BOOT_READY = true;
      return;
    }
    showToast('Failed to load schedule', 'error');
    if (list) list.innerHTML = '<p class="empty-state">Could not load schedule.</p>';
  }
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => `
    <div class="job-card skeleton">
      <div class="sk-line sk-short"></div>
      <div class="sk-line sk-long"></div>
      <div class="sk-line sk-med"></div>
    </div>
  `).join('');
}

function renderJobCards(jobs) {
  const list = document.getElementById('jobsList');
  if (!list) return;

  if (!jobs || jobs.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">*</div>
        <p>No jobs scheduled for today</p>
      </div>`;
    return;
  }

  list.innerHTML = jobs.map((job) => {
    const customer  = job.customers?.name || 'Customer';
    const title     = job.orders?.title   || job.title || 'Job';
    const time      = job.scheduled_time  ? formatTime(job.scheduled_date + 'T' + job.scheduled_time) : 'TBD';
    const addr      = job.service_address || job.address || '-';
    const hydrovacSignals = ['hydrovac', 'vactor', 'hydrovac_vactor'].includes(crewBusinessKey(job))
      ? renderCrewHydrovacJobSignals(job)
      : '';

    return `
      <div class="job-card ${statusClass(job.status)} ${['hydrovac', 'vactor', 'hydrovac_vactor'].includes(crewBusinessKey(job)) ? 'job-card--hydrovac' : ''}" data-job-id="${job.id}" role="button" tabindex="0">
        <div class="job-card-top">
          <span class="job-time">${escHtml(time)}</span>
          <span class="status-pill ${statusClass(job.status)}">${statusLabel(job.status)}</span>
        </div>
        <div class="job-customer">${escHtml(customer)}</div>
        <div class="job-title">${escHtml(title)}</div>
        <div class="job-address">${escHtml(addr)}</div>
        ${hydrovacSignals}
      </div>`;
  }).join('');

  // Bind tap events
  list.querySelectorAll('.job-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id  = card.dataset.jobId;
      const job = JOBS.find((j) => j.id === id);
      if (job) openJob(job);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') card.click();
    });
  });
}

function renderScheduleList(jobs) {
  const list = document.getElementById('scheduleList');
  if (!list) return;

  if (!jobs.length) {
    list.innerHTML = '<div class="empty-state"><p>No upcoming jobs.</p></div>';
    return;
  }

  // Group by date
  const byDate = {};
  jobs.forEach((j) => {
    const d = j.scheduled_date || 'Unknown';
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(j);
  });

  list.innerHTML = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, dateJobs]) => `
    <div class="schedule-date-header">${formatDate(date + 'T00:00:00')}</div>
    ${dateJobs.map((job) => {
      const customer = job.customers?.name || '-';
      const title    = job.orders?.title   || job.title || 'Job';
      const time     = job.scheduled_time  ? formatTime(job.scheduled_date + 'T' + job.scheduled_time) : 'TBD';
      return `
        <div class="job-card" data-job-id="${job.id}" role="button" tabindex="0">
          <div class="job-card-top">
            <span class="job-time">${escHtml(time)}</span>
            <span class="status-pill ${statusClass(job.status)}">${statusLabel(job.status)}</span>
          </div>
          <div class="job-customer">${escHtml(customer)}</div>
          <div class="job-title">${escHtml(title)}</div>
        </div>`;
    }).join('')}
  `).join('');

  list.querySelectorAll('.job-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id  = card.dataset.jobId;
      const job = JOBS.find((j) => j.id === id)
               || jobs.find((j) => j.id === id);
      if (job) openJob(job);
    });
  });
}

// ── Job Detail ─────────────────────────────────────────────────────────────────

async function openJob(job) {
  ACTIVE_JOB = job;
  stopTimer();
  const workSummary = [job.summary, job.description].filter(Boolean).join(' ').trim();
  const notesSummary = [workSummary, job.notes].filter(Boolean).join(' ').trim();

  // Populate fields
  setText('jobDetailTitle',    job.orders?.title   || job.title || 'Job');
  setText('jobDetailCustomer', job.customers?.name || '-');
  setText('jobDetailAddress',  job.service_address || job.address || '-');
  setText('jobDetailStatus',   statusLabel(job.status));
  setText('jobDetailDate',     formatDate((job.scheduled_date || '') + 'T00:00:00'));
  setText('jobDetailTime',     job.scheduled_time ? formatTime(job.scheduled_date + 'T' + job.scheduled_time) : 'TBD');
  setText('jobDetailNotes',    notesSummary || '-');
  setText('jobScope',          workSummary || '-');
  setText('jobNotes',          job.notes || workSummary || '-');

  // Status pill
  const pill = document.getElementById('jobDetailStatusPill');
  if (pill) {
    pill.textContent = statusLabel(job.status);
    pill.className   = 'status-pill ' + statusClass(job.status);
  }

  // Customer contact
  const phone = job.customers?.phone;
  const email = job.customers?.email;
  const contactEl = document.getElementById('jobDetailContact');
  if (contactEl) {
    const parts = [];
    if (phone) parts.push(`<a href="tel:${escHtml(phone)}" class="contact-link">${escHtml(phone)}</a>`);
    if (email) parts.push(`<a href="mailto:${escHtml(email)}" class="contact-link">${escHtml(email)}</a>`);
    contactEl.innerHTML = parts.join(' - ') || '-';
  }

  const crewNotesEl = document.getElementById('crewNotes');
  if (crewNotesEl) crewNotesEl.value = job.crew_notes || '';

  // Action buttons
  renderJobActions(job.status, job);

  // Photos
  const photos = job.photos || [];
  renderPhotoGrid(photos, 'before',  'beforePhotosGrid');
  renderPhotoGrid(photos, 'after',   'afterPhotosGrid');
  renderPhotoGrid(photos, 'blocker', 'blockerPhotosGrid');

  // Timer
  if (job.status === 'in_progress' && job.actual_start_at) {
    startTimer(new Date(job.actual_start_at));
  } else {
    setText('jobTimer', '0h 00m');
  }

  showScreen('job');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '-';
}

function renderJobActions(status, job = ACTIVE_JOB) {
  const container = document.getElementById('jobActions');
  if (!container) return;

  const guidance = fieldActionGuidance(status, job);
  const noteHtml = guidance
    ? `<div class="status-note">${escHtml(guidance)}</div>`
    : '';
  const hydrovacFieldCard = (status === 'scheduled' || status === 'dispatched' || status === 'in_progress' || status === 'blocked')
    ? renderCrewHydrovacFieldCard(job)
    : '';
  const sitePacketCard = (status === 'scheduled' || status === 'dispatched' || status === 'in_progress' || status === 'blocked')
    ? renderCrewSitePacketCard(job)
    : '';
  const memoryHtml = (status === 'scheduled' || status === 'dispatched' || status === 'in_progress' || status === 'blocked')
    ? renderCrewJobMemory(job)
    : '';

  let html = noteHtml + hydrovacFieldCard + sitePacketCard + memoryHtml;

  if (status === 'scheduled' || status === 'dispatched') {
    html += `
      <button class="btn btn-primary" data-action="clock-in">Clock In</button>
      <button class="btn btn-ghost"   data-action="report-blocker">Report Issue</button>`;
  } else if (status === 'in_progress') {
    html += `
      <button class="btn btn-success" data-action="complete-job">Complete Job</button>
      <button class="btn btn-ghost"   data-action="report-blocker">Report Issue</button>`;
  } else if (status === 'blocked') {
    html += `
      <button class="btn btn-primary" data-action="clock-in">Resume Job</button>
      <button class="btn btn-success" data-action="complete-job">Complete Job</button>`;
  } else if (status === 'completed') {
    html += `<div class="completion-badge">&#10003; Job complete</div>`;
  } else if (status === 'cancelled') {
    html += `<div class="status-note">${escHtml(fieldActionGuidance(status, job))}</div>`;
  }

  container.innerHTML = html;
}

// ── Status Updates ─────────────────────────────────────────────────────────────

async function updateJobStatus(jobId, status, extraFields = {}) {
  const patch = { status, ...extraFields };

  if (!isOnline()) {
    OFFLINE_QUEUE.push({ type: 'status', jobId, patch, timestamp: Date.now() });
    await persistQueue();
    updateJobCache(jobId, patch);
    showToast('Saved offline. The update will sync when you reconnect.', 'info');
    if (ACTIVE_JOB && ACTIVE_JOB.id === jobId) {
      ACTIVE_JOB = { ...ACTIVE_JOB, ...patch, compliance_message: '' };
      renderJobActions(ACTIVE_JOB.status, ACTIVE_JOB);
    }
    return true;
  }

  const token = await getToken();
  if (!token) { showToast('Please sign in again so this update can be sent.', 'error'); return false; }

  try {
    const res = await fetch('/.netlify/functions/update-crew-job', {
      method : 'PATCH',
      headers: {
        'Authorization' : 'Bearer ' + token,
        'Content-Type'  : 'application/json',
      },
      body: JSON.stringify({ job_id: jobId, ...patch }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 409) throw new Error(complianceIssueMessage(body, 'This job is blocked until the required compliance item is handled.'));
      throw new Error(body.error || `HTTP ${res.status}`);
    }

    const updated = body.job || { id: jobId, ...patch };
    updateJobCache(jobId, updated);

    if (ACTIVE_JOB && ACTIVE_JOB.id === jobId) {
      ACTIVE_JOB = { ...ACTIVE_JOB, ...updated, compliance_message: '' };
      renderJobActions(ACTIVE_JOB.status, ACTIVE_JOB);
      const pill = document.getElementById('jobDetailStatusPill');
      if (pill) {
        pill.textContent = statusLabel(ACTIVE_JOB.status);
        pill.className   = 'status-pill ' + statusClass(ACTIVE_JOB.status);
      }
    }
    return true;
  } catch (err) {
    console.error('[updateJobStatus]', err);
    const detail = String(err.message || '').toLowerCase();
    if (detail.includes('compliance') || detail.includes('permit') || detail.includes('locate') || detail.includes('manifest')) {
      if (ACTIVE_JOB && ACTIVE_JOB.id === jobId) {
        ACTIVE_JOB = { ...ACTIVE_JOB, compliance_message: err.message || 'This job is blocked until the required compliance item is handled.' };
        renderJobActions(ACTIVE_JOB.status, ACTIVE_JOB);
      }
      showToast(err.message || 'This job is blocked until the required compliance item is handled.', 'error');
      return false;
    }
    OFFLINE_QUEUE.push({ type: 'status', jobId, patch, timestamp: Date.now() });
    await persistQueue();
    updateJobCache(jobId, patch);
    showToast('Update queued. It will sync when you reconnect.', 'info');
    if (ACTIVE_JOB && ACTIVE_JOB.id === jobId) {
      ACTIVE_JOB = { ...ACTIVE_JOB, ...patch, compliance_message: '' };
      renderJobActions(ACTIVE_JOB.status, ACTIVE_JOB);
    }
    return true;
  }
}

function updateJobCache(jobId, fields) {
  const nextFields = { ...fields };
  if (nextFields.completion_handoff) {
    const currentMetadata = crewJobMetadata(JOBS.find((job) => job.id === jobId) || ACTIVE_JOB || {});
    nextFields.metadata = {
      ...currentMetadata,
      crew_closeout: nextFields.completion_handoff,
    };
  }
  const idx = JOBS.findIndex((j) => j.id === jobId);
  if (idx !== -1) {
    JOBS[idx] = { ...JOBS[idx], ...nextFields };
    saveJobsToIDB(JOBS);
  }
  if (ACTIVE_JOB && ACTIVE_JOB.id === jobId) {
    ACTIVE_JOB = { ...ACTIVE_JOB, ...nextFields };
  }
}

async function clockIn(jobId) {
  const fields = { actual_start_at: new Date().toISOString() };

  // Try geolocation. Optional and non-blocking.
  try {
    const pos = await getPosition();
    if (pos) {
      fields.check_in_lat = pos.coords.latitude;
      fields.check_in_lng = pos.coords.longitude;
    }
  } catch { /* geolocation optional */ }

  const updated = await updateJobStatus(jobId, 'in_progress', fields);
  if (!updated) return;
  showToast('Clocked in. Work timer started.', 'success');

  // Start timer
  const startTime = ACTIVE_JOB?.actual_start_at
    ? new Date(ACTIVE_JOB.actual_start_at)
    : new Date();
  startTimer(startTime);

  // Refresh action buttons
  if (ACTIVE_JOB) {
    ACTIVE_JOB.status = 'in_progress';
    ACTIVE_JOB.compliance_message = '';
    renderJobActions('in_progress', ACTIVE_JOB);
  }
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      timeout            : 6000,
      maximumAge         : 60000,
      enableHighAccuracy : false,
    });
  });
}

// ── Photo Capture ──────────────────────────────────────────────────────────────

function setupPhotoCapture(type) {
  if (!ACTIVE_JOB) { showToast('No active job', 'error'); return; }

  const input = document.createElement('input');
  input.type    = 'file';
  input.accept  = 'image/*';
  input.capture = 'environment';

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;

    const uploading = showPhotoProgress(type, true);

    try {
      const base64 = await compressImage(file);
      await uploadPhoto(ACTIVE_JOB.id, base64, type);
    } catch (err) {
      console.error('[photo capture]', err);
      showToast('Photo failed: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      showPhotoProgress(type, false);
      input.remove();
    }
  });

  document.body.appendChild(input);
  input.click();
}

function showPhotoProgress(type, loading) {
  const gridId = type + 'PhotosGrid';
  const grid   = document.getElementById(gridId);
  if (!grid) return;

  const spinner = grid.querySelector('.photo-uploading');
  if (loading && !spinner) {
    const el = document.createElement('div');
    el.className = 'photo-thumb photo-uploading';
    el.innerHTML = '<div class="spinner"></div>';
    grid.insertBefore(el, grid.querySelector('.photo-add-btn'));
  } else if (!loading && spinner) {
    spinner.remove();
  }
}

async function uploadPhoto(jobId, base64, type) {
  // Strip data URL prefix if present
  const photoBase64 = base64.includes(',') ? base64.split(',')[1] : base64;

  if (!isOnline()) {
    // Save for later sync
    if (DB) {
      await DB.addToStore('photos', {
        jobId,
        photoBase64,
        type,
        mime_type : 'image/jpeg',
        timestamp : Date.now(),
      });
    }
    showToast('Photo saved offline. We will upload it when you reconnect.', 'info');
    // Add a placeholder to the grid
    addPhotoToGrid({ url: 'data:image/jpeg;base64,' + photoBase64, photo_type: type, id: 'offline-' + Date.now() }, type);
    return;
  }

  const token = await getToken();
  if (!token) throw new Error('Please sign in again.');

  const res = await fetch('/.netlify/functions/upload-job-photo', {
    method : 'POST',
    headers: {
      'Authorization' : 'Bearer ' + token,
      'Content-Type'  : 'application/json',
    },
    body: JSON.stringify({
      job_id      : jobId,
      photo_base64: photoBase64,
      mime_type   : 'image/jpeg',
      photo_type  : type,
      caption     : '',
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

  const photo = body.photo;
  if (photo) {
    // Update local cache
    if (ACTIVE_JOB) {
      ACTIVE_JOB.photos = [...(ACTIVE_JOB.photos || []), photo];
      updateJobCache(ACTIVE_JOB.id, { photos: ACTIVE_JOB.photos });
    }
    addPhotoToGrid(photo, type);
    showToast('Photo uploaded', 'success');
  }
}

function addPhotoToGrid(photo, type) {
  const gridId = type + 'PhotosGrid';
  const grid   = document.getElementById(gridId);
  if (!grid) return;

  const addBtn = grid.querySelector('.photo-add-btn');
  const thumb  = document.createElement('div');
  thumb.className = 'photo-thumb';
  thumb.innerHTML = `
    <img src="${escAttr(photo.url)}" alt="${escAttr(photo.photo_type)} photo" loading="lazy" />
    <span class="photo-badge">${escHtml(photo.photo_type)}</span>`;

  thumb.addEventListener('click', () => showPhotoFullscreen(photo.url));

  if (addBtn) {
    grid.insertBefore(thumb, addBtn);
  } else {
    grid.appendChild(thumb);
  }
}

function renderPhotoGrid(photos, type, containerId) {
  const grid = document.getElementById(containerId);
  if (!grid) return;

  const filtered = (photos || []).filter((p) => p.photo_type === type);

  grid.innerHTML = filtered.map((p) => `
    <div class="photo-thumb" data-url="${escAttr(p.url)}">
      <img src="${escAttr(p.url)}" alt="${escAttr(type)} photo" loading="lazy" />
      <span class="photo-badge">${escHtml(type)}</span>
    </div>`
  ).join('') + `
    <div class="photo-add-btn" data-type="${escAttr(type)}" role="button" tabindex="0" aria-label="Add ${type} photo">
      <span>+</span>
    </div>`;

  grid.querySelectorAll('.photo-thumb').forEach((thumb) => {
    thumb.addEventListener('click', () => showPhotoFullscreen(thumb.dataset.url));
  });

  grid.querySelectorAll('.photo-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => setupPhotoCapture(btn.dataset.type));
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') btn.click(); });
  });
}

function showPhotoFullscreen(url) {
  let overlay = document.getElementById('photoOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id        = 'photoOverlay';
    overlay.className = 'photo-overlay';
    overlay.innerHTML = `
      <div class="photo-overlay-close" role="button" aria-label="Close">&#10005;</div>
      <img id="photoOverlayImg" src="" alt="Full size photo" />`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('photo-overlay-close')) {
        overlay.classList.remove('visible');
      }
    });
  }
  document.getElementById('photoOverlayImg').src = url;
  overlay.classList.add('visible');
}

function compressImage(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload  = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.onload  = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width  = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Signature Capture ──────────────────────────────────────────────────────────

function initSignatureCanvas() {
  const canvas = document.getElementById('signatureCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  SIG_POINTS = [];

  // Resize canvas to its display size
  function resize() {
    const rect  = canvas.getBoundingClientRect();
    canvas.width  = rect.width;
    canvas.height = rect.height;
    ctx.strokeStyle = '#1a1d27';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }
  resize();

  function getPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return {
      x: src.clientX - rect.left,
      y: src.clientY - rect.top,
    };
  }

  function startDraw(e) {
    e.preventDefault();
    SIG_DRAWING = true;
    const pt = getPoint(e);
    SIG_POINTS.push({ type: 'move', ...pt });
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  }

  function draw(e) {
    e.preventDefault();
    if (!SIG_DRAWING) return;
    const pt = getPoint(e);
    SIG_POINTS.push({ type: 'line', ...pt });
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  }

  function endDraw(e) {
    e.preventDefault();
    SIG_DRAWING = false;
    ctx.beginPath();
  }

  canvas.addEventListener('mousedown',  startDraw, { passive: false });
  canvas.addEventListener('mousemove',  draw,      { passive: false });
  canvas.addEventListener('mouseup',    endDraw,   { passive: false });
  canvas.addEventListener('mouseleave', endDraw,   { passive: false });
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove',  draw,      { passive: false });
  canvas.addEventListener('touchend',   endDraw,   { passive: false });
}

function clearSignature() {
  const canvas = document.getElementById('signatureCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  SIG_POINTS = [];
}

function getSignatureDataUrl() {
  const canvas = document.getElementById('signatureCanvas');
  if (!canvas) return null;

  // Check if blank: sample a few pixels
  if (SIG_POINTS.length === 0) return null;

  const ctx   = canvas.getContext('2d');
  const data  = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hasInk  = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) { hasInk = true; break; }
  }
  if (!hasInk) return null;

  return canvas.toDataURL('image/png');
}

// ── Completion Flow ────────────────────────────────────────────────────────────

function renderHydrovacCompletionForm(job = ACTIVE_JOB) {
  const existing = crewHydrovacCompletionHandoff(job) || {};
  const permitRequired = crewHydrovacPermitStatusRequired(job);
  return `
    <div class="completion-section-card">
      <div class="completion-section-card__head">
        <div>
          <div class="completion-section-card__eyebrow">Load and disposal</div>
          <strong>Tell the office what is riding with the truck right now</strong>
        </div>
        <span class="status-pill ${existing.load_status ? 'status-inprogress' : 'status-scheduled'}">${escHtml(existing.load_status ? crewHydrovacLoadStatusLabel(existing.load_status) : 'Required')}</span>
      </div>
      <div class="completion-section-card__copy">This is the part the office uses to clear live-load pressure and decide whether billing can move right away.</div>
      <div class="completion-grid" style="margin-top:12px;">
        <div class="completion-field">
          <label for="completionLoadStatus">Load status <span class="completion-required">*</span></label>
          <select id="completionLoadStatus">
            <option value="">Choose load status</option>
            <option value="truck_clear" ${existing.load_status === 'truck_clear' ? 'selected' : ''}>Truck clear</option>
            <option value="live_load_remaining" ${existing.load_status === 'live_load_remaining' ? 'selected' : ''}>Live load remaining</option>
            <option value="no_load" ${existing.load_status === 'no_load' ? 'selected' : ''}>No load hauled</option>
          </select>
        </div>
        <div class="completion-field">
          <label for="completionBolNumber">BOL / load reference</label>
          <input id="completionBolNumber" placeholder="BOL-4401" value="${escHtml(existing.bol_number || '')}">
        </div>
        <div class="completion-field completion-field--full" id="completionLiveLoadHoldReasonWrap">
          <label for="completionLiveLoadHoldReason">Why is the live load still on the truck? <span class="completion-required">*</span></label>
          <textarea id="completionLiveLoadHoldReason" rows="3" placeholder="Waiting on compatible municipal load or final dump instructions…">${escHtml(existing.live_load_hold_reason || '')}</textarea>
          <div class="completion-helper">Only use this when the truck is still carrying material forward.</div>
        </div>
        <div class="completion-field" id="completionDisposalReadyByWrap">
          <label for="completionDisposalReadyBy">Disposal ready by <span class="completion-required">*</span></label>
          <input id="completionDisposalReadyBy" type="date" value="${escHtml(existing.disposal_ready_by || '')}">
        </div>
      </div>
    </div>
    <div class="completion-section-card">
      <div class="completion-section-card__head">
        <div>
          <div class="completion-section-card__eyebrow">Locate and permit</div>
          <strong>Confirm the paper trail the office still needs to trust</strong>
        </div>
        <span class="status-pill ${permitRequired ? 'status-inprogress' : 'status-scheduled'}">${escHtml(permitRequired ? 'Permit watch' : 'Locate watch')}</span>
      </div>
      <div class="completion-section-card__copy">A clean office handoff is not the same as “all clear.” Use this section to be explicit if locate or permit follow-through is still needed.</div>
      <div class="completion-grid" style="margin-top:12px;">
        <div class="completion-field">
          <label for="completionLocatesVerified">Locate marks verified on site</label>
          <select id="completionLocatesVerified">
            <option value="">Not captured</option>
            <option value="true" ${existing.locates_verified_on_site === true ? 'selected' : ''}>Yes</option>
            <option value="false" ${existing.locates_verified_on_site === false ? 'selected' : ''}>No</option>
          </select>
        </div>
        <div class="completion-field">
          <label for="completionPermitStatus">Permit status ${permitRequired ? '<span class="completion-required">*</span>' : ''}</label>
          <select id="completionPermitStatus">
            <option value="">Choose permit status</option>
            <option value="not_required" ${existing.permit_status === 'not_required' ? 'selected' : ''}>Not required</option>
            <option value="open_and_safe" ${existing.permit_status === 'open_and_safe' ? 'selected' : ''}>Open and safe</option>
            <option value="closed" ${existing.permit_status === 'closed' ? 'selected' : ''}>Closed</option>
            <option value="needs_office_followup" ${existing.permit_status === 'needs_office_followup' ? 'selected' : ''}>Needs office follow-up</option>
          </select>
        </div>
        <div class="completion-field completion-field--full" id="completionPermitNoteWrap">
          <label for="completionPermitNote">Permit note</label>
          <textarea id="completionPermitNote" rows="3" placeholder="Air check complete, permit still open with inspector, or tell the office what needs follow-through…">${escHtml(existing.permit_note || '')}</textarea>
        </div>
      </div>
    </div>
    <div class="completion-section-card">
      <div class="completion-section-card__head">
        <div>
          <div class="completion-section-card__eyebrow">Office handoff</div>
          <strong>Give the office the exact handoff they need to finish strong</strong>
        </div>
        <span class="status-pill ${existing.field_summary ? 'status-completed' : 'status-scheduled'}">${escHtml(existing.field_summary ? 'Summary ready' : 'Required')}</span>
      </div>
      <div class="completion-section-card__copy">Keep it direct. The operator will use this to finish customer records, compliance packet prep, and billing without calling the crew back.</div>
      <div class="completion-grid" style="margin-top:12px;">
        <div class="completion-field completion-field--full">
          <label for="completionFieldSummary">Field summary <span class="completion-required">*</span></label>
          <textarea id="completionFieldSummary" rows="4" placeholder="Summarize what was completed, what changed on site, and what the office needs to know next…">${escHtml(existing.field_summary || '')}</textarea>
        </div>
        <div class="completion-field completion-field--full">
          <label for="completionCustomerNote">Customer-facing note</label>
          <textarea id="completionCustomerNote" rows="3" placeholder="Optional note the office can reuse when they send records or follow up with the customer…">${escHtml(existing.customer_note || '')}</textarea>
        </div>
        <div class="completion-field completion-field--full">
          <label>Office follow-up</label>
          <div class="completion-followup-grid">
            ${CREW_HYDROVAC_FOLLOW_UP_OPTIONS.map((option) => `
              <button type="button" class="completion-followup-chip ${(existing.office_follow_up || []).includes(option.key) ? 'is-active' : ''}" data-completion-followup="${escHtml(option.key)}">${escHtml(option.label)}</button>
            `).join('')}
          </div>
          <div class="completion-helper">Mark only the office moves that still matter after this truck leaves.</div>
        </div>
      </div>
    </div>
  `;
}

function syncHydrovacCompletionFieldVisibility() {
  const loadStatus = completionFieldValue('completionLoadStatus');
  const permitStatus = completionFieldValue('completionPermitStatus');
  const liveLoadHoldReasonWrap = document.getElementById('completionLiveLoadHoldReasonWrap');
  const disposalReadyByWrap = document.getElementById('completionDisposalReadyByWrap');
  const permitNoteWrap = document.getElementById('completionPermitNoteWrap');
  if (liveLoadHoldReasonWrap) liveLoadHoldReasonWrap.style.display = loadStatus === 'live_load_remaining' ? '' : 'none';
  if (disposalReadyByWrap) disposalReadyByWrap.style.display = loadStatus === 'live_load_remaining' ? '' : 'none';
  if (permitNoteWrap) permitNoteWrap.style.display = permitStatus && permitStatus !== 'not_required' ? '' : 'none';
}

function renderCompletionPreview(job = ACTIVE_JOB) {
  const previewWrap = document.getElementById('completionPreviewWrap');
  const previewCard = document.getElementById('completionPreviewCard');
  if (!previewWrap || !previewCard) return;

  if (crewBusinessKey(job) !== 'hydrovac') {
    previewWrap.style.display = 'none';
    previewCard.innerHTML = '';
    return;
  }

  previewWrap.style.display = '';
  const handoff = collectHydrovacCompletionHandoff(job);
  const validation = validateHydrovacCompletionHandoff(handoff, job);
  const followUp = Array.isArray(handoff.office_follow_up) ? handoff.office_follow_up : [];
  const locateSummary = handoff.locates_verified_on_site === true
    ? 'Crew verified marks on site.'
    : handoff.locates_verified_on_site === false
      ? 'Locate still needs office follow-up.'
      : 'Locate verification has not been captured yet.';
  previewCard.innerHTML = `
    <div class="completion-preview-card__head">
      <div>
        <div class="completion-preview-card__eyebrow">Preview</div>
        <strong>What the office will read next</strong>
      </div>
      <span class="status-pill ${validation.ok ? 'status-completed' : 'status-inprogress'}">${escHtml(validation.ok ? 'Closeout ready' : 'Still missing' )}</span>
    </div>
    <div class="completion-preview-card__summary">
      ${escHtml(handoff.field_summary || 'Start with the field summary. The office should be able to understand the outcome without chasing the crew back down.')}
    </div>
    <div class="completion-preview-card__signals">
      <div class="completion-preview-card__signal">
        <span>Load</span>
        <strong>${escHtml(crewHydrovacLoadStatusLabel(handoff.load_status || ''))}</strong>
        <small>${escHtml(handoff.load_status === 'live_load_remaining' ? (handoff.live_load_hold_reason || 'Explain why the load is still on the truck.') : handoff.bol_number ? `BOL ${handoff.bol_number}` : 'Add the load reference if one exists.')}</small>
      </div>
      <div class="completion-preview-card__signal">
        <span>Locate</span>
        <strong>${escHtml(handoff.locates_verified_on_site === true ? 'Verified' : handoff.locates_verified_on_site === false ? 'Needs office follow-up' : 'Not captured')}</strong>
        <small>${escHtml(locateSummary)}</small>
      </div>
      <div class="completion-preview-card__signal">
        <span>Permit</span>
        <strong>${escHtml(crewHydrovacPermitStatusLabel(handoff.permit_status || ''))}</strong>
        <small>${escHtml(handoff.permit_note || (handoff.permit_status ? 'No extra permit note attached.' : 'Choose a permit status when the job carries permit pressure.'))}</small>
      </div>
    </div>
    ${followUp.length ? `
      <div>
        <div class="completion-preview-card__eyebrow">Office follow-up</div>
        <div class="completion-preview-card__followups">
          ${followUp.map((item) => `<span class="completion-preview-pill">${escHtml(crewHydrovacFollowUpLabel(item))}</span>`).join('')}
        </div>
      </div>
    ` : `
      <div class="completion-preview-empty">No office follow-up is selected yet. Add it only when the office still needs to act after the truck leaves.</div>
    `}
    ${!validation.ok ? `<div class="completion-preview-empty">${escHtml(validation.error)}</div>` : `<div class="completion-preview-empty">${escHtml(buildCrewHydrovacCompletionNarrative(handoff))}</div>`}
  `;
}

function bindHydrovacCompletionFields(job = ACTIVE_JOB) {
  const root = document.getElementById('completionHydrovacFields');
  if (!root) return;
  root.querySelectorAll('input, select, textarea').forEach((element) => {
    element.addEventListener('input', () => {
      syncHydrovacCompletionFieldVisibility();
      renderCompletionPreview(job);
    });
    element.addEventListener('change', () => {
      syncHydrovacCompletionFieldVisibility();
      renderCompletionPreview(job);
    });
  });
  root.querySelectorAll('[data-completion-followup]').forEach((button) => {
    button.addEventListener('click', () => {
      button.classList.toggle('is-active');
      renderCompletionPreview(job);
    });
  });
  syncHydrovacCompletionFieldVisibility();
  renderCompletionPreview(job);
}

function syncCompletionScreen(job = ACTIVE_JOB) {
  const isHydrovac = crewBusinessKey(job) === 'hydrovac';
  const overview = document.getElementById('completionHydrovacOverview');
  const standardFields = document.getElementById('completionStandardFields');
  const hydrovacFields = document.getElementById('completionHydrovacFields');
  const flow = document.getElementById('completionFlow');
  const previewWrap = document.getElementById('completionPreviewWrap');
  const submitNote = document.getElementById('completionSubmitNote');

  if (overview) {
    overview.innerHTML = isHydrovac
      ? `${renderCrewHydrovacFieldCard(job)}${renderCrewSitePacketCard(job)}`
      : '';
    overview.style.display = isHydrovac ? '' : 'none';
  }

  if (standardFields) standardFields.style.display = isHydrovac ? 'none' : '';
  if (hydrovacFields) {
    hydrovacFields.innerHTML = isHydrovac ? renderHydrovacCompletionForm(job) : '';
    hydrovacFields.style.display = isHydrovac ? '' : 'none';
  }
  if (flow) flow.classList.toggle('completion-flow--hydrovac', isHydrovac);
  if (previewWrap && !isHydrovac) previewWrap.style.display = 'none';
  if (submitNote) {
    submitNote.textContent = isHydrovac
      ? 'Structured closeout keeps manifests, compliance, and money aligned for the office.'
      : 'The office will use this closeout to finish billing and customer follow-through.';
  }

  if (isHydrovac) {
    bindHydrovacCompletionFields(job);
  } else {
    renderCompletionPreview(job);
  }
}

function showCompletionScreen() {
  if (!ACTIVE_JOB) return;

  const noteEl = document.getElementById('completionNote');
  if (noteEl) noteEl.value = '';

  const titleEl = document.getElementById('completionJobTitle');
  if (titleEl) titleEl.textContent = ACTIVE_JOB.orders?.title || ACTIVE_JOB.title || 'Job';

  const afterPhotos = (ACTIVE_JOB.photos || []).filter((p) => p.photo_type === 'after');
  const photoWarn   = document.getElementById('completionPhotoWarn');
  if (photoWarn) {
    photoWarn.style.display = afterPhotos.length === 0 ? 'block' : 'none';
    const textNode = photoWarn.querySelector('span:last-child');
    if (textNode) textNode.textContent = afterPhotos.length === 0 ? 'No after photos added' : `${afterPhotos.length} after photo${afterPhotos.length === 1 ? '' : 's'} attached`;
  }

  syncCompletionScreen(ACTIVE_JOB);
  clearSignature();
  initSignatureCanvas();
  showScreen('completion');
}

async function submitCompletion() {
  if (!ACTIVE_JOB) return;

  const isHydrovac = crewBusinessKey(ACTIVE_JOB) === 'hydrovac';
  const noteEl = document.getElementById('completionNote');
  const note = noteEl ? noteEl.value.trim() : '';
  let completionHandoff = null;

  if (isHydrovac) {
    completionHandoff = collectHydrovacCompletionHandoff(ACTIVE_JOB);
    const validation = validateHydrovacCompletionHandoff(completionHandoff, ACTIVE_JOB);
    if (!validation.ok) {
      showToast(validation.error, 'error');
      return;
    }
  } else if (!note) {
    showToast('Add a completion note so the office knows what was finished.', 'error');
    if (noteEl) noteEl.focus();
    return;
  }

  const narrative = isHydrovac
    ? buildCrewHydrovacCompletionNarrative(completionHandoff)
    : note;
  const sigDataUrl = getSignatureDataUrl();

  const btn = document.getElementById('btnSubmitCompletion');
  setButtonLoading(btn, true, 'Submitting...');

  const token = await getToken();
  if (!token) {
    showToast('Please sign in again so the closeout can be saved.', 'error');
    setButtonLoading(btn, false, 'Complete Job');
    return;
  }

  try {
    const body = {
      job_id: ACTIVE_JOB.id,
      status: 'completed',
      crew_notes: narrative,
      actual_end_at: new Date().toISOString(),
      completion_handoff: completionHandoff || undefined,
    };

    let uploaded = false;
    try {
      const res = await fetch('/.netlify/functions/complete-crew-job', {
        method : 'POST',
        headers: {
          'Authorization' : 'Bearer ' + token,
          'Content-Type'  : 'application/json',
        },
        body: JSON.stringify({
          ...body,
          completion_note    : narrative,
          signature_data_url : sigDataUrl || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        uploaded = true;
        if (data.job) {
          updateJobCache(ACTIVE_JOB.id, data.job);
          ACTIVE_JOB = { ...ACTIVE_JOB, ...data.job, compliance_message: '' };
        }
      } else if (res.status === 409) {
        const error = new Error(complianceIssueMessage(data, 'This job cannot be completed until the required compliance item is handled.'));
        error.stopFallback = true;
        throw error;
      } else if (res.status === 400) {
        const error = new Error(data.error || 'The closeout is missing required hydrovac details.');
        error.stopFallback = true;
        throw error;
      }
    } catch (err) {
      if (err?.stopFallback) throw err;
      /* fall through to update-crew-job */
    }

    if (!uploaded) {
      const res = await fetch('/.netlify/functions/update-crew-job', {
        method : 'PATCH',
        headers: {
          'Authorization' : 'Bearer ' + token,
          'Content-Type'  : 'application/json',
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) throw new Error(complianceIssueMessage(data, 'This job cannot be completed until the required compliance item is handled.'));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (data.job) {
        updateJobCache(ACTIVE_JOB.id, data.job);
        ACTIVE_JOB = { ...ACTIVE_JOB, ...data.job, compliance_message: '' };
      }
    }

    if (sigDataUrl && !uploaded) {
      try {
        const sigBase64 = sigDataUrl.split(',')[1];
        await fetch('/.netlify/functions/upload-job-photo', {
          method : 'POST',
          headers: {
            'Authorization' : 'Bearer ' + token,
            'Content-Type'  : 'application/json',
          },
          body: JSON.stringify({
            job_id      : ACTIVE_JOB.id,
            photo_base64: sigBase64,
            mime_type   : 'image/png',
            photo_type  : 'other',
            caption     : 'Customer signature',
          }),
        });
      } catch { /* signature upload non-fatal */ }
    }

    updateJobCache(ACTIVE_JOB.id, {
      status: 'completed',
      completion_handoff: completionHandoff || undefined,
      completion_note: narrative,
      crew_notes: narrative,
    });
    stopTimer();
    showSuccessScreen();

  } catch (err) {
    console.error('[submitCompletion]', err);
    if (ACTIVE_JOB) {
      ACTIVE_JOB = { ...ACTIVE_JOB, compliance_message: err.message || '' };
      renderJobActions(ACTIVE_JOB.status, ACTIVE_JOB);
    }
    showToast(err.message || 'Could not complete the closeout. Please try again.', 'error');
  } finally {
    setButtonLoading(btn, false, 'Complete Job');
  }
}

function showSuccessScreen() {
  const titleEl    = document.getElementById('successJobTitle');
  const customerEl = document.getElementById('successCustomer');
  const timeEl     = document.getElementById('successTime');

  if (titleEl)    titleEl.textContent    = ACTIVE_JOB?.orders?.title || ACTIVE_JOB?.title || 'Job';
  if (customerEl) customerEl.textContent = ACTIVE_JOB?.customers?.name || '-';
  if (timeEl)     timeEl.textContent     = `Completed at ${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;

  showScreen('success');
  spawnConfetti();

  setTimeout(() => {
    showScreen('home', 'back');
    loadJobs(CURRENT_DATE);
  }, 3000);
}

// ── Confetti ───────────────────────────────────────────────────────────────────

function spawnConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
  document.body.appendChild(canvas);

  const ctx     = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = Array.from({ length: 80 }, () => ({
    x    : Math.random() * canvas.width,
    y    : -20,
    r    : 4 + Math.random() * 6,
    color: ['#c84b2f', '#4ade80', '#60a5fa', '#fbbf24', '#a78bfa'][Math.floor(Math.random() * 5)],
    vx   : (Math.random() - 0.5) * 4,
    vy   : 2 + Math.random() * 4,
    angle: Math.random() * 360,
    spin : (Math.random() - 0.5) * 8,
    life : 1,
  }));

  let frame;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      if (p.y > canvas.height + 20) continue;
      alive = true;
      p.x    += p.vx;
      p.y    += p.vy;
      p.angle += p.spin;
      p.vy   *= 1.01;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.angle * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.5);
      ctx.restore();
    }
    if (alive) {
      frame = requestAnimationFrame(animate);
    } else {
      canvas.remove();
    }
  }
  animate();

  setTimeout(() => {
    cancelAnimationFrame(frame);
    canvas.remove();
  }, 4000);
}

// ── Blocker Report ─────────────────────────────────────────────────────────────

function showBlockerModal() {
  const modal = document.getElementById('blockerModal');
  if (modal) {
    modal.classList.add('modal-visible', 'open');
    const input = document.getElementById('blockerNote');
    if (input) { input.value = ''; input.focus(); }
    return;
  }
  showScreen('blocker');
  const input = document.getElementById('blockerNote');
  if (input) { input.value = ''; input.focus(); }
}

function hideBlockerModal() {
  const modal = document.getElementById('blockerModal');
  if (modal) {
    modal.classList.remove('modal-visible', 'open');
    return;
  }
  showScreen('job', 'back');
}

async function submitBlocker() {
  if (!ACTIVE_JOB) return;
  const noteEl = document.getElementById('blockerNote');
  const note   = noteEl ? noteEl.value.trim() : '';

  if (!note) {
    showToast('Please describe the issue', 'error');
    return;
  }

  const btn = document.getElementById('btnSubmitBlocker');
  setButtonLoading(btn, true, 'Reporting...');

  try {
    const updated = await updateJobStatus(ACTIVE_JOB.id, 'blocked', { blocker_note: note });
    if (!updated) return;
    hideBlockerModal();
    showToast('Issue reported. The office can see it now.', 'success');

    if (ACTIVE_JOB) {
      ACTIVE_JOB.status = 'blocked';
      ACTIVE_JOB.blocker_note = note;
      ACTIVE_JOB.compliance_message = '';
      renderJobActions('blocked', ACTIVE_JOB);
    }
  } catch (err) {
    showToast('Could not send the issue yet. Please try again.', 'error');
  } finally {
    setButtonLoading(btn, false, 'Submit Report');
  }
}

// ── Timer ──────────────────────────────────────────────────────────────────────

function startTimer(startTime) {
  stopTimer();
  TIMER_INTERVAL = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
    const el = document.getElementById('jobTimer');
    if (el) el.textContent = formatDuration(elapsed);
  }, 1000);
  // Immediate render
  const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
  const el = document.getElementById('jobTimer');
  if (el) el.textContent = formatDuration(elapsed);
}

function stopTimer() {
  if (TIMER_INTERVAL) {
    clearInterval(TIMER_INTERVAL);
    TIMER_INTERVAL = null;
  }
}

// ── Offline Sync ───────────────────────────────────────────────────────────────

function setupOfflineSync() {
  window.addEventListener('online',  handleOnline);
  window.addEventListener('offline', handleOffline);

  const indicator = document.getElementById('offlineIndicator');
  if (indicator) indicator.style.display = isOnline() ? 'none' : 'flex';
}

function handleOffline() {
  const indicator = document.getElementById('offlineIndicator');
  if (indicator) indicator.style.display = 'flex';
  showToast('You are offline. Changes will sync when you reconnect.', 'info');
}

async function handleOnline() {
  const indicator = document.getElementById('offlineIndicator');
  if (indicator) indicator.style.display = 'none';

  if (OFFLINE_QUEUE.length === 0 && !(await hasPendingPhotos())) return;

  showToast(`Syncing ${OFFLINE_QUEUE.length} pending update(s)...`, 'info');

  const token = await getToken();
  if (!token) return;

  // Process queued status updates
  const failed = [];
  for (const item of OFFLINE_QUEUE) {
    try {
      const res = await fetch('/.netlify/functions/update-crew-job', {
        method : 'PATCH',
        headers: {
          'Authorization' : 'Bearer ' + token,
          'Content-Type'  : 'application/json',
        },
        body: JSON.stringify({ job_id: item.jobId, ...item.patch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.warn('[sync] Failed to sync item:', err);
      failed.push(item);
    }
  }

  // Process queued photos
  await syncOfflinePhotos(token);

  OFFLINE_QUEUE = failed;
  await persistQueue();

  if (failed.length === 0) {
    showToast('All updates synced', 'success');
    await loadJobs(CURRENT_DATE);
  } else {
    showToast(`${failed.length} update(s) failed to sync`, 'error');
  }
}

async function hasPendingPhotos() {
  if (!DB) return false;
  const photos = await DB.getAll('photos').catch(() => []);
  return photos.length > 0;
}

async function syncOfflinePhotos(token) {
  if (!DB) return;
  let photos;
  try { photos = await DB.getAll('photos'); } catch { return; }

  for (const p of photos) {
    try {
      const res = await fetch('/.netlify/functions/upload-job-photo', {
        method : 'POST',
        headers: {
          'Authorization' : 'Bearer ' + token,
          'Content-Type'  : 'application/json',
        },
        body: JSON.stringify({
          job_id      : p.jobId,
          photo_base64: p.photoBase64,
          mime_type   : p.mime_type || 'image/jpeg',
          photo_type  : p.type,
          caption     : '',
        }),
      });
      if (res.ok) {
        // Remove from IDB on success
        // (autoIncrement store — clear all and re-add failures)
      }
    } catch { /* leave in IDB for next attempt */ }
  }

  // Simple strategy: clear photo queue after attempt
  try { await DB.clear('photos'); } catch { /* ignore */ }
}

// ── Profile ────────────────────────────────────────────────────────────────────

function showProfile() {
  showScreen('profile');

  const nameEl  = document.getElementById('profileName');
  const roleEl  = document.getElementById('profileRole');
  const emailEl = document.getElementById('profileEmail');

  if (MEMBER) {
    if (nameEl)  nameEl.textContent  = MEMBER.name       || '-';
    if (roleEl)  roleEl.textContent  = MEMBER.role_title || MEMBER.role || '-';
  }

  if (SESSION?.user) {
    if (emailEl) emailEl.textContent = SESSION.user.email || '-';
  }
}

async function saveCrewNotes() {
  if (!ACTIVE_JOB) {
    showToast('Open a job first.', 'error');
    return;
  }
  const noteEl = document.getElementById('crewNotes');
  const crewNotes = noteEl ? noteEl.value.trim() : '';
  const token = await getToken();
  if (!token) {
    showToast('Please sign in again.', 'error');
    return;
  }

  try {
    const res = await fetch('/.netlify/functions/update-crew-job', {
      method : 'PATCH',
      headers: {
        'Authorization' : 'Bearer ' + token,
        'Content-Type'  : 'application/json',
      },
      body: JSON.stringify({
        job_id: ACTIVE_JOB.id,
        crew_notes: crewNotes,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

    const updated = body.job || { crew_notes: crewNotes };
    ACTIVE_JOB = { ...ACTIVE_JOB, ...updated, crew_notes: crewNotes };
    updateJobCache(ACTIVE_JOB.id, updated);
    showToast('Notes saved for the office.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not save notes yet.', 'error');
  }
}

function legacyScreenKey(name = '') {
  return String(name || '').replace(/^screen/i, '').trim().toLowerCase();
}

window.App = {
  async goBack() {
    showScreen('home', 'back');
    await loadJobs(CURRENT_DATE);
  },
  async refreshCurrentJob() {
    if (!ACTIVE_JOB) {
      showToast('No active job to refresh.', 'info');
      return;
    }
    await loadJobs(CURRENT_DATE);
    const refreshed = JOBS.find((job) => job.id === ACTIVE_JOB.id);
    if (refreshed) openJob(refreshed);
  },
  async navTo(name) {
    const target = legacyScreenKey(name);
    if (target === 'schedule') {
      await loadUpcomingJobs();
      return;
    }
    if (target === 'profile') {
      showProfile();
      return;
    }
    await showHome();
  },
  async showScreen(name) {
    const target = legacyScreenKey(name);
    if (target === 'schedule') {
      await loadUpcomingJobs();
      return;
    }
    if (target === 'profile') {
      showProfile();
      return;
    }
    if (target === 'home') {
      await showHome();
      return;
    }
    showScreen(target, 'back');
  },
  signOut,
  async openJob(id) {
    const job = JOBS.find((row) => row.id === id);
    if (job) await openJob(job);
  },
  async jobAction(action) {
    if (!ACTIVE_JOB) return;
    if (action === 'start' || action === 'im_here' || action === 'on_my_way') {
      await clockIn(ACTIVE_JOB.id);
      return;
    }
    if (action === 'complete') {
      showCompletionScreen();
      return;
    }
    if (action === 'blocker') {
      showBlockerModal();
      return;
    }
    if (action === 'unblock') {
      await updateJobStatus(ACTIVE_JOB.id, 'in_progress');
    }
  },
  selectBlockerReason(button) {
    const value = String(button?.dataset?.val || '').trim();
    const noteEl = document.getElementById('blockerNote');
    if (noteEl && value && !String(noteEl.value || '').trim()) noteEl.value = value;
  },
  reportBlocker: submitBlocker,
  clearSignature,
  submitCompletion,
  saveCrewNotes,
  confirmOk() {
    document.getElementById('confirmModal')?.classList.remove('open');
  },
  confirmCancel() {
    document.getElementById('confirmModal')?.classList.remove('open');
  },
};

window.switchJobsTab = async function switchJobsTab(tab) {
  const target = String(tab || '').trim().toLowerCase();
  if (target === 'upcoming') {
    await loadUpcomingJobs();
    return;
  }
  await showHome();
};

// ── Event Delegation ───────────────────────────────────────────────────────────

async function handleJobAction(e) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action || !ACTIVE_JOB) return;

  switch (action) {
    case 'clock-in':
      await clockIn(ACTIVE_JOB.id);
      break;
    case 'complete-job':
      showCompletionScreen();
      break;
    case 'report-blocker':
      showBlockerModal();
      break;
    default:
      break;
  }
}

async function handleSignIn() {
  const email    = document.getElementById('loginEmail')?.value.trim()    || '';
  const password = document.getElementById('loginPassword')?.value || '';
  await signIn(email, password);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function setButtonLoading(btn, loading, label) {
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = label;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Quick Log ──────────────────────────────────────────────────────────────────

function openQuickLog() {
  const sheet = document.getElementById('quickLogSheet');
  if (!sheet) return;
  // Reset state
  _quickLogType = 'Travel';
  _quickLogTimerStart = null;
  _quickLogElapsedSecs = 0;
  clearInterval(_quickLogTimerInterval);
  const timerDisplay = document.getElementById('quickLogTimer');
  if (timerDisplay) timerDisplay.textContent = '00:00';
  const startBtn = document.getElementById('btnTimerStart');
  const stopBtn = document.getElementById('btnTimerStop');
  if (startBtn) startBtn.classList.remove('hidden');
  if (stopBtn) stopBtn.classList.add('hidden');
  // Reset type buttons
  document.querySelectorAll('.type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === 'Travel');
  });
  // Reset duration mode
  const durTimer = document.getElementById('durTimer');
  if (durTimer) durTimer.checked = true;
  document.getElementById('timerMode')?.classList.remove('hidden');
  document.getElementById('manualMode')?.classList.add('hidden');
  // Clear note and msg
  const noteEl = document.getElementById('quickLogNote');
  if (noteEl) noteEl.value = '';
  const msgEl = document.getElementById('quickLogMsg');
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'msg'; }
  sheet.classList.remove('hidden');
}

function closeQuickLog() {
  clearInterval(_quickLogTimerInterval);
  _quickLogTimerInterval = null;
  document.getElementById('quickLogSheet')?.classList.add('hidden');
}

function startQuickLogTimer() {
  _quickLogTimerStart = Date.now() - (_quickLogElapsedSecs * 1000);
  _quickLogTimerInterval = setInterval(() => {
    _quickLogElapsedSecs = Math.floor((Date.now() - _quickLogTimerStart) / 1000);
    const mins = Math.floor(_quickLogElapsedSecs / 60).toString().padStart(2, '0');
    const secs = (_quickLogElapsedSecs % 60).toString().padStart(2, '0');
    const el = document.getElementById('quickLogTimer');
    if (el) el.textContent = `${mins}:${secs}`;
  }, 1000);
  document.getElementById('btnTimerStart')?.classList.add('hidden');
  document.getElementById('btnTimerStop')?.classList.remove('hidden');
}

function stopQuickLogTimer() {
  clearInterval(_quickLogTimerInterval);
  _quickLogTimerInterval = null;
  document.getElementById('btnTimerStart')?.classList.remove('hidden');
  document.getElementById('btnTimerStop')?.classList.add('hidden');
}

async function saveQuickLog() {
  const btn = document.getElementById('btnQuickLogSave');
  const msgEl = document.getElementById('quickLogMsg');
  if (btn) btn.disabled = true;
  if (msgEl) { msgEl.textContent = ''; msgEl.className = 'msg'; }

  // Determine duration
  const durMode = document.querySelector('input[name="durMode"]:checked')?.value || 'timer';
  let durationMinutes = 0;

  if (durMode === 'timer') {
    durationMinutes = Math.round(_quickLogElapsedSecs / 60);
  } else {
    const hrs = parseInt(document.getElementById('manualHours')?.value || '0', 10) || 0;
    const mins = parseInt(document.getElementById('manualMins')?.value || '0', 10) || 0;
    durationMinutes = hrs * 60 + mins;
  }

  if (durationMinutes <= 0) {
    if (msgEl) { msgEl.textContent = 'Add a duration first.'; msgEl.className = 'msg error'; }
    if (btn) btn.disabled = false;
    return;
  }

  const note = document.getElementById('quickLogNote')?.value?.trim() || '';
  const description = note ? `${_quickLogType} - ${note}` : _quickLogType;
  const started_at = _quickLogTimerStart
    ? new Date(_quickLogTimerStart).toISOString()
    : new Date(Date.now() - durationMinutes * 60000).toISOString();

  try {
    const token = await getToken();
    if (!token) throw new Error('Not signed in');

    const res = await fetch('/.netlify/functions/log-time-entry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        description,
        started_at,
        duration_minutes: durationMinutes,
        billable: false,
      }),
    });

    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Failed to save');

    stopQuickLogTimer();
    closeQuickLog();
    showToast(`${_quickLogType} logged - ${durationMinutes} min`, 'success');
  } catch (err) {
    if (msgEl) { msgEl.textContent = err.message; msgEl.className = 'msg error'; }
  }

  if (btn) btn.disabled = false;
}

// ── Boot ───────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initApp();

  // Login form
  document.getElementById('btnSignIn')?.addEventListener('click', handleSignIn);
  document.getElementById('btnForgot')?.addEventListener('click', () => {
    showToast('Use your company password reset flow if you need a new password.', 'info');
  });

  document.getElementById('loginPassword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSignIn();
  });

  // Bottom nav
  bindClickHandler('navHome', () => {
    showScreen('home', 'back');
    loadJobs(CURRENT_DATE);
  });
  bindClickHandler('navSchedule', loadUpcomingJobs);
  bindClickHandler('navProfile', showProfile);

  // Job screen — delegated action buttons
  document.getElementById('screenJob')?.addEventListener('click', handleJobAction);

  // Back buttons
  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.back || 'home';
      showScreen(target, 'back');
    });
  });

  bindClickHandler('btnJobBack', async () => {
    showScreen('home', 'back');
    await loadJobs(CURRENT_DATE);
  });
  bindClickHandler('btnJobRefresh', () => {
    window.App?.refreshCurrentJob?.();
  });
  bindClickHandler('btnSaveCrewNotes', saveCrewNotes);
  bindClickHandler('btnCompletionBack', () => {
    showScreen('job', 'back');
  });
  bindClickHandler('btnBlockerBack', () => {
    showScreen('job', 'back');
  });
  bindClickHandler('btnScheduleBack', async () => {
    await showHome();
  });

  // Sign out
  bindClickHandler('btnSignOut', signOut);

  // Blocker modal
  bindClickHandler('btnSubmitBlocker', submitBlocker);
  bindClickHandler('btnCancelBlocker', hideBlockerModal);
  document.getElementById('blockerChips')?.addEventListener('click', (event) => {
    const button = event.target.closest('.chip');
    if (!button) return;
    window.App?.selectBlockerReason?.(button);
  });

  // Completion screen
  bindClickHandler('btnSubmitCompletion', submitCompletion);
  bindClickHandler('btnClearSignature', clearSignature);

  // Confirm modal
  bindClickHandler('confirmOk', () => {
    window.App?.confirmOk?.();
  });
  bindClickHandler('confirmCancel', () => {
    window.App?.confirmCancel?.();
  });

  // Date navigation on home
  document.getElementById('btnDatePrev')?.addEventListener('click', () => {
    const d = new Date(CURRENT_DATE + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    CURRENT_DATE = d.toISOString().slice(0, 10);
    loadJobs(CURRENT_DATE);
  });
  document.getElementById('btnDateNext')?.addEventListener('click', () => {
    const d = new Date(CURRENT_DATE + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    CURRENT_DATE = d.toISOString().slice(0, 10);
    loadJobs(CURRENT_DATE);
  });

  // Photo add buttons on job screen (delegated, since grids re-render)
  document.getElementById('screenJob')?.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.photo-add-btn');
    if (addBtn && addBtn.dataset.type) {
      setupPhotoCapture(addBtn.dataset.type);
    }
  });

  // Quick Log
  document.getElementById('btnQuickLog')?.addEventListener('click', openQuickLog);
  document.getElementById('btnTimerStart')?.addEventListener('click', startQuickLogTimer);
  document.getElementById('btnTimerStop')?.addEventListener('click', stopQuickLogTimer);
  document.getElementById('btnQuickLogSave')?.addEventListener('click', saveQuickLog);

  // Type selector
  document.getElementById('quickLogTypes')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.type-btn');
    if (!btn) return;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _quickLogType = btn.dataset.type;
  });

  // Duration mode toggle
  document.querySelectorAll('input[name="durMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isTimer = radio.value === 'timer' && radio.checked;
      const isManual = radio.value === 'manual' && radio.checked;
      if (isTimer) {
        document.getElementById('timerMode')?.classList.remove('hidden');
        document.getElementById('manualMode')?.classList.add('hidden');
      }
      if (isManual) {
        document.getElementById('manualMode')?.classList.remove('hidden');
        document.getElementById('timerMode')?.classList.add('hidden');
        stopQuickLogTimer();
      }
    });
  });

  // Pull-to-refresh (simple touch gesture on job list)
  setupPullToRefresh();
});

function setupPullToRefresh() {
  let startY = 0;
  const list = document.getElementById('jobsList');
  if (!list) return;

  list.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
  }, { passive: true });

  list.addEventListener('touchend', (e) => {
    const delta = e.changedTouches[0].clientY - startY;
    if (delta > 80 && list.scrollTop === 0) {
      showToast('Refreshing...', 'info');
      loadJobs(CURRENT_DATE);
    }
  }, { passive: true });
}
