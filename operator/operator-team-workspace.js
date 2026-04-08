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
  element.innerHTML = `${renderTeamRosterSummary()}<table style="width:100%;border-collapse:collapse;font-size:.85rem;">
    <thead><tr>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Name</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Role</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Field load</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Hourly Rate</th>
      <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08);"></th>
    </tr></thead>
    <tbody>
      ${TEAM_MEMBERS_CACHE.map((member) => {
        const summary = teamMemberJobSummary(member);
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
            ${conflictChip ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${conflictChip}</div>` : ""}
            <div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(note)}</div>
            ${summary.jobs.length ? `<div class="muted" style="font-size:.72rem;margin-top:4px;"><span class="pill ${capacityTone}">${escapeHtml(`${teamMinutesLabel(summary.totalEstimatedMinutes)} planned / ${teamMinutesLabel(summary.minimumBlockMinutes)} block`)}</span></div>` : ""}
            ${summary.lastFieldUpdate ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(`Last field update ${summary.lastFieldUpdate}`)}</div>` : ""}
            ${summary.blockerNotes[0] ? `<div class="muted" style="font-size:.72rem;margin-top:4px;">${escapeHtml(`Blocker: ${summary.blockerNotes[0]}`)}</div>` : ""}
          </td>
          <td style="padding:8px;color:rgba(255,255,255,.55);">${member.hourly_rate_cents ? `${formatUsd(member.hourly_rate_cents)}/hr` : "-"}</td>
          <td style="padding:8px;text-align:right;display:flex;gap:6px;justify-content:flex-end;">
            <button class="btn btn-ghost" style="font-size:.72rem;" onclick="openEditTeamMemberModal('${escapeAttr(member.id)}','${escapeAttr(member.role || "")}','${member.hourly_rate_cents || 0}')">Edit</button>
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

function openEditTeamMemberModal(id, currentRole, currentRateCents) {
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
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-ghost" onclick="document.getElementById('editTeamModal')?.remove()">Cancel</button>
      <button class="btn btn-primary" id="tmEditSave">Save</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#tmEditSave").onclick = async () => {
    const role = document.getElementById("tmEditRole")?.value;
    const rate = parseFloat(document.getElementById("tmEditRate")?.value || "0");
    try {
      const response = await fetch("/.netlify/functions/manage-operator-members", {
        method: "PATCH",
        headers: await getTeamWorkspaceAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id, role, hourly_rate_cents: Math.round(rate * 100) }),
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
          <div class="li-sub muted" style="font-size:.75rem;">${escapeHtml(entry.started_at ? new Date(entry.started_at).toLocaleDateString() : "-")} &middot; ${escapeHtml(entry.billable ? "Billable" : "Non-billable")}</div>
        </div>
        <div class="li-meta"><span class="pill">${toHours(entry.duration_minutes || 0)}h</span></div>
      </div>`).join("");
    return `
      <div class="card" style="margin-bottom:12px;${!hasActivity ? "opacity:.55;" : ""}">
        <div class="card-hd" style="cursor:pointer;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
          <div>
            <strong>${escapeHtml(member.name || "Unknown")}</strong>
            <span class="pill" style="margin-left:8px;">${escapeHtml(member.role || "")}</span>
          </div>
          <div class="row" style="gap:16px;font-size:.85rem;">
            <span><strong>${toHours(member.total_minutes)}</strong> hrs total</span>
            <span class="muted">${toHours(member.billable_minutes)} billable</span>
            <span class="muted">${member.job_count} jobs</span>
            ${member.estimated_pay_cents > 0 ? `<span class="pill pill-on">${formatUsd(member.estimated_pay_cents)}</span>` : ""}
          </div>
        </div>
        <div class="card-bd" style="display:none;">
          ${jobRows ? `<div style="margin-bottom:10px;"><div class="kicker">Jobs</div><div class="list">${jobRows}</div></div>` : ""}
          ${entryRows ? `<div><div class="kicker">Time entries</div><div class="list">${entryRows}</div></div>` : ""}
          ${!jobRows && !entryRows ? '<div class="muted">No detail records in this period.</div>' : ""}
        </div>
      </div>`;
  }).join("");
  reportEl.innerHTML = memberHtml + `
    <div style="border-top:1px solid rgba(255,255,255,.08);padding-top:14px;margin-top:4px;display:flex;gap:24px;font-size:.9rem;">
      <span><strong>${toHours(totals.total_minutes || 0)}</strong> total hours</span>
      <span class="muted">${toHours(totals.billable_minutes || 0)} billable</span>
      <span class="muted">${totals.member_count || 0} team members</span>
      ${totals.estimated_pay_cents > 0 ? `<span class="pill pill-on">Est. payroll: ${formatUsd(totals.estimated_pay_cents)}</span>` : ""}
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
  const rows = [["Member", "Role", "Date", "Description", "Type", "Billable", "Duration (hrs)", "Hourly Rate", "Est. Pay"]];
  for (const member of data.members || []) {
    for (const entry of member.entries || []) {
      const hours = ((entry.duration_minutes || 0) / 60).toFixed(2);
      const rate = ((entry.hourly_rate_cents || member.hourly_rate_cents || 0) / 100).toFixed(2);
      const pay = (((entry.duration_minutes || 0) / 60) * (entry.hourly_rate_cents || member.hourly_rate_cents || 0) / 100).toFixed(2);
      rows.push([member.name || "", member.role || "", entry.started_at ? new Date(entry.started_at).toLocaleDateString() : "", entry.description || "Time entry", "Time Entry", entry.billable ? "Yes" : "No", hours, `$${rate}`, `$${pay}`]);
    }
    for (const job of member.jobs || []) {
      if (!job.actual_start_at || !job.actual_end_at) continue;
      const minutes = Math.round((new Date(job.actual_end_at) - new Date(job.actual_start_at)) / 60000);
      const hours = (minutes / 60).toFixed(2);
      const rate = (member.hourly_rate_cents / 100).toFixed(2);
      const pay = ((minutes / 60) * member.hourly_rate_cents / 100).toFixed(2);
      rows.push([member.name || "", member.role || "", new Date(job.actual_start_at).toLocaleDateString(), job.title || "Job", "Job", "Yes", hours, `$${rate}`, `$${pay}`]);
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
  $("btnInviteTeamMember")?.addEventListener("click", () => openInviteTeamMemberModal());
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
  openEditTeamMemberModal,
  removeTeamMember,
  loadHoursReport,
  renderHoursReport,
  exportHoursCsv,
  loadTeamWorkspace,
  initTeamWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_TEAM_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_TEAM_WORKSPACE || {}),
  ...TEAM_WORKSPACE_HELPERS,
};

Object.assign(window, TEAM_WORKSPACE_HELPERS);
