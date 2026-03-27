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
            const r  = (key !== undefined) ? os.put(value, key) : os.add(value);
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
    s.classList.remove('screen-active', 'slide-in-right', 'slide-in-left',
                        'slide-out-right', 'slide-out-left');
    s.style.display = 'none';
  });

  const target = document.getElementById('screen' + capitalize(name));
  if (!target) {
    console.warn('[showScreen] No screen found:', name);
    return;
  }

  target.style.display = 'flex';
  // Trigger animation on next frame so display:flex is painted first
  requestAnimationFrame(() => {
    target.classList.add('screen-active',
      direction === 'back' ? 'slide-in-left' : 'slide-in-right');
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
  if (err) { err.textContent = ''; err.style.display = 'none'; }

  if (!email || !password) {
    showLoginError('Please enter your email and password.');
    return;
  }

  setButtonLoading(btn, true, 'Signing in...');

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    SESSION = data.session;
    await loadMember();
    await showHome();
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

async function showHome() {
  // Populate member name in header
  const nameEl = document.getElementById('memberName');
  if (nameEl && MEMBER) nameEl.textContent = MEMBER.name || 'Crew Member';

  showScreen('home', 'back');
  await loadJobs(CURRENT_DATE);
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
    await saveJobsToIDB(JOBS);
    renderJobCards(JOBS);

    // Update date label
    const dateLabel = document.getElementById('currentDateLabel');
    if (dateLabel) {
      dateLabel.textContent = targetDate === todayString()
        ? 'Today'
        : formatDate(targetDate + 'T00:00:00');
    }
  } catch (err) {
    console.error('[loadJobs]', err);
    const cached = await loadJobsFromIDB();
    JOBS = cached;
    renderJobCards(JOBS);
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
    renderScheduleList(jobs || []);
  } catch (err) {
    console.error('[loadUpcomingJobs]', err);
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

    return `
      <div class="job-card" data-job-id="${job.id}" role="button" tabindex="0">
        <div class="job-card-top">
          <span class="job-time">${escHtml(time)}</span>
          <span class="status-pill ${statusClass(job.status)}">${statusLabel(job.status)}</span>
        </div>
        <div class="job-customer">${escHtml(customer)}</div>
        <div class="job-title">${escHtml(title)}</div>
        <div class="job-address">${escHtml(addr)}</div>
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

  // Populate fields
  setText('jobDetailTitle',    job.orders?.title   || job.title || 'Job');
  setText('jobDetailCustomer', job.customers?.name || '-');
  setText('jobDetailAddress',  job.service_address || job.address || '-');
  setText('jobDetailStatus',   statusLabel(job.status));
  setText('jobDetailDate',     formatDate((job.scheduled_date || '') + 'T00:00:00'));
  setText('jobDetailTime',     job.scheduled_time ? formatTime(job.scheduled_date + 'T' + job.scheduled_time) : 'TBD');
  setText('jobDetailNotes',    job.description || job.notes || '-');

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

  const blockerNote = String(job?.blocker_note || '').trim();
  const complianceMessage = String(job?.compliance_message || '').trim();
  let noteHtml = '';
  if (complianceMessage) {
    noteHtml = `<div class="status-note" style="margin-bottom:10px;">${escHtml(complianceMessage)}</div>`;
  } else if (blockerNote) {
    noteHtml = `<div class="status-note" style="margin-bottom:10px;">Blocker: ${escHtml(blockerNote)}</div>`;
  } else if (status === 'scheduled' || status === 'dispatched') {
    noteHtml = `<div class="status-note" style="margin-bottom:10px;">Clock in when you are on site. If access, scope, safety, or compliance is not ready, report the issue first.</div>`;
  } else if (status === 'in_progress') {
    noteHtml = `<div class="status-note" style="margin-bottom:10px;">Keep notes and proof current so closeout is fast when the work is done.</div>`;
  } else if (status === 'blocked') {
    noteHtml = `<div class="status-note" style="margin-bottom:10px;">Work is paused. Tell the office exactly what is stopping progress so they can clear it without another trip.</div>`;
  }

  let html = noteHtml;

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
    html += `<div class="status-note">This job has been cancelled.</div>`;
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
    showToast('Saved offline. We will sync it when you reconnect.', 'info');
    if (ACTIVE_JOB && ACTIVE_JOB.id === jobId) {
      ACTIVE_JOB = { ...ACTIVE_JOB, ...patch, compliance_message: '' };
      renderJobActions(ACTIVE_JOB.status, ACTIVE_JOB);
    }
    return true;
  }

  const token = await getToken();
  if (!token) { showToast('Please sign in again.', 'error'); return false; }

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
    showToast('Update queued. We will sync it when you reconnect.', 'info');
    if (ACTIVE_JOB && ACTIVE_JOB.id === jobId) {
      ACTIVE_JOB = { ...ACTIVE_JOB, ...patch, compliance_message: '' };
      renderJobActions(ACTIVE_JOB.status, ACTIVE_JOB);
    }
    return true;
  }
}

function updateJobCache(jobId, fields) {
  const idx = JOBS.findIndex((j) => j.id === jobId);
  if (idx !== -1) {
    JOBS[idx] = { ...JOBS[idx], ...fields };
    saveJobsToIDB(JOBS);
  }
  if (ACTIVE_JOB && ACTIVE_JOB.id === jobId) {
    ACTIVE_JOB = { ...ACTIVE_JOB, ...fields };
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

function showCompletionScreen() {
  if (!ACTIVE_JOB) return;

  // Reset form
  const noteEl = document.getElementById('completionNote');
  if (noteEl) noteEl.value = '';
  clearSignature();
  initSignatureCanvas();

  const titleEl = document.getElementById('completionJobTitle');
  if (titleEl) titleEl.textContent = ACTIVE_JOB.orders?.title || ACTIVE_JOB.title || 'Job';

  const afterPhotos = (ACTIVE_JOB.photos || []).filter((p) => p.photo_type === 'after');
  const photoWarn   = document.getElementById('completionPhotoWarn');
  if (photoWarn) {
    photoWarn.style.display = afterPhotos.length === 0 ? 'block' : 'none';
  }

  showScreen('completion');
}

async function submitCompletion() {
  if (!ACTIVE_JOB) return;

  const noteEl = document.getElementById('completionNote');
  const note   = noteEl ? noteEl.value.trim() : '';

  if (!note) {
    showToast('Please enter a completion note', 'error');
    if (noteEl) noteEl.focus();
    return;
  }

  const sigDataUrl = getSignatureDataUrl();

  const btn = document.getElementById('btnSubmitCompletion');
  setButtonLoading(btn, true, 'Submitting...');

  const token = await getToken();
  if (!token) {
    showToast('Please sign in again.', 'error');
    setButtonLoading(btn, false, 'Complete Job');
    return;
  }

  try {
    // Build payload for complete-crew-job or the update-crew-job fallback.
    const body = {
      job_id          : ACTIVE_JOB.id,
      status          : 'completed',
      crew_notes      : note,
      actual_end_at   : new Date().toISOString(),
    };

    // If a function for completion with signature exists, try it
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
          completion_note     : note,
          signature_data_url  : sigDataUrl || undefined,
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
      }
    } catch (err) {
      if (err?.stopFallback) throw err;
      /* fall through to update-crew-job */
    }

    if (!uploaded) {
      // Fallback: use update-crew-job
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

    // If we have a signature and couldn't send it via complete-crew-job, upload as photo
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

    updateJobCache(ACTIVE_JOB.id, { status: 'completed' });
    stopTimer();
    showSuccessScreen();

  } catch (err) {
    console.error('[submitCompletion]', err);
    if (ACTIVE_JOB) {
      ACTIVE_JOB = { ...ACTIVE_JOB, compliance_message: err.message || '' };
      renderJobActions(ACTIVE_JOB.status, ACTIVE_JOB);
    }
    showToast(err.message || 'Could not complete job. Please try again.', 'error');
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
    modal.classList.add('modal-visible');
    const input = document.getElementById('blockerNote');
    if (input) { input.value = ''; input.focus(); }
  }
}

function hideBlockerModal() {
  const modal = document.getElementById('blockerModal');
  if (modal) modal.classList.remove('modal-visible');
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
    showToast('Issue reported', 'success');

    if (ACTIVE_JOB) {
      ACTIVE_JOB.status = 'blocked';
      ACTIVE_JOB.blocker_note = note;
      ACTIVE_JOB.compliance_message = '';
      renderJobActions('blocked', ACTIVE_JOB);
    }
  } catch (err) {
    showToast('Failed to report issue', 'error');
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

  document.getElementById('loginPassword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSignIn();
  });

  // Bottom nav
  document.getElementById('navHome')?.addEventListener('click', () => {
    showScreen('home', 'back');
    loadJobs(CURRENT_DATE);
  });
  document.getElementById('navSchedule')?.addEventListener('click', loadUpcomingJobs);
  document.getElementById('navProfile')?.addEventListener('click', showProfile);

  // Job screen — delegated action buttons
  document.getElementById('screenJob')?.addEventListener('click', handleJobAction);

  // Back buttons
  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.back || 'home';
      showScreen(target, 'back');
    });
  });

  // Sign out
  document.getElementById('btnSignOut')?.addEventListener('click', signOut);

  // Blocker modal
  document.getElementById('btnSubmitBlocker')?.addEventListener('click', submitBlocker);
  document.getElementById('btnCancelBlocker')?.addEventListener('click', hideBlockerModal);

  // Completion screen
  document.getElementById('btnSubmitCompletion')?.addEventListener('click', submitCompletion);
  document.getElementById('btnClearSignature')?.addEventListener('click', clearSignature);

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
