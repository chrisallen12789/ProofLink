// Equipment management extracted from operator.js
// so fleet CRUD and equipment-tab setup stay in one module.
async function fetchEquipment() {
  const token = (await sb.auth.getSession()).data.session?.access_token;
  const res = await fetch('/.netlify/functions/manage-equipment', { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) { console.warn('[equipment] fetch failed:', res.status); return; }
  const d = await res.json().catch(() => ({}));
  EQUIPMENT_CACHE = d.equipment || [];
  renderEquipment();
}

function renderEquipment() {
  const el = document.getElementById('equipmentList');
  if (!el) return;
  if (!EQUIPMENT_CACHE.length) {
    el.innerHTML = '<div class="muted" style="font-size:.85rem;padding:16px 0;">No equipment yet. <button class="btn btn-ghost btn-sm" onclick="openAddEquipmentModal()">+ Add first truck</button></div>';
    return;
  }
  const statusColor = { active: '#4caf82', maintenance: '#e5a027', retired: 'rgba(255,255,255,.3)' };
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.85rem;">
    <thead><tr>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Unit</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Type</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Rate</th>
      <th style="text-align:left;padding:6px 8px;color:rgba(255,255,255,.4);font-weight:500;border-bottom:1px solid rgba(255,255,255,.08);">Status</th>
      <th style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08);"></th>
    </tr></thead>
    <tbody>
      ${EQUIPMENT_CACHE.map(e => `<tr>
        <td style="padding:8px;color:#e8e9eb;">${escapeHtml(e.unit_number ? `${e.unit_number} — ${e.name}` : e.name)}<br><span style="font-size:.75rem;color:rgba(255,255,255,.35);">${escapeHtml([e.year, e.make, e.model].filter(Boolean).join(' '))}</span></td>
        <td style="padding:8px;color:rgba(255,255,255,.55);">${escapeHtml(e.equipment_type || '—')}</td>
        <td style="padding:8px;color:rgba(255,255,255,.55);">${e.hourly_rate_cents ? '$' + (e.hourly_rate_cents/100).toFixed(0) + '/hr' : '—'}</td>
        <td style="padding:8px;"><span style="font-size:.75rem;font-weight:600;color:${statusColor[e.status] || '#fff'};">${e.status || 'active'}</span></td>
        <td style="padding:8px;text-align:right;display:flex;gap:6px;justify-content:flex-end;">
          <button class="btn btn-ghost" style="font-size:.72rem;" onclick="openEditEquipmentModal('${escapeAttr(e.id)}')">Edit</button>
          <button class="btn btn-ghost" style="font-size:.72rem;" onclick="deleteEquipment('${escapeAttr(e.id)}')">Remove</button>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function openAddEquipmentModal() {
  const existing = document.getElementById('addEquipmentModal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'addEquipmentModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-box" style="max-width:400px;">
    <h3 style="margin:0 0 16px;font-size:1rem;">Add equipment</h3>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Name *</label>
    <input id="eqName" class="input" style="margin-bottom:10px;width:100%;" placeholder="Truck 1 / Vactor 2112">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Unit #</label>
        <input id="eqUnit" class="input" style="width:100%;" placeholder="T-01"></div>
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Type</label>
        <select id="eqType" class="input" style="width:100%;">
          <option value="hydrovac">Hydrovac</option>
          <option value="vactor">Vactor</option>
          <option value="jetter">Jetter</option>
          <option value="combo">Combo</option>
          <option value="vacuum_truck">Vacuum truck</option>
          <option value="other">Other</option>
        </select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Year</label>
        <input id="eqYear" class="input" style="width:100%;" type="number" placeholder="2024"></div>
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Make</label>
        <input id="eqMake" class="input" style="width:100%;" placeholder="Vactor"></div>
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Model</label>
        <input id="eqModel" class="input" style="width:100%;" placeholder="2112"></div>
    </div>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Hourly rate ($/hr)</label>
    <input id="eqRate" class="input" style="margin-bottom:10px;width:100%;" type="number" min="0" placeholder="0">
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Notes</label>
    <textarea id="eqNotes" class="input" style="margin-bottom:16px;width:100%;height:60px;"></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-ghost" onclick="document.getElementById('addEquipmentModal')?.remove()">Cancel</button>
      <button class="btn btn-primary" id="eqSaveBtn">Save</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#eqSaveBtn').onclick = async () => {
    const name = document.getElementById('eqName')?.value?.trim();
    if (!name) { showToast('Name is required'); return; }
    const token = (await sb.auth.getSession()).data.session?.access_token;
    try {
      const res = await fetch('/.netlify/functions/manage-equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          name,
          unit_number: document.getElementById('eqUnit')?.value || null,
          equipment_type: document.getElementById('eqType')?.value || 'hydrovac',
          year: parseInt(document.getElementById('eqYear')?.value) || null,
          make: document.getElementById('eqMake')?.value || null,
          model: document.getElementById('eqModel')?.value || null,
          hourly_rate_cents: Math.round((parseFloat(document.getElementById('eqRate')?.value) || 0) * 100),
          notes: document.getElementById('eqNotes')?.value || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      modal.remove();
      await fetchEquipment();
      showToast('Equipment added.');
    } catch (err) { showToast('Error: ' + err.message); }
  };
}

function openEditEquipmentModal(id) {
  const eq = EQUIPMENT_CACHE.find(e => e.id === id);
  if (!eq) return;
  const existing = document.getElementById('editEquipmentModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'editEquipmentModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-box" style="max-width:400px;">
    <h3 style="margin:0 0 16px;font-size:1rem;">Edit equipment</h3>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Name</label>
    <input id="eqEditName" class="input" style="margin-bottom:10px;width:100%;" value="${escapeAttr(eq.name)}">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Unit #</label>
        <input id="eqEditUnit" class="input" style="width:100%;" value="${escapeAttr(eq.unit_number||'')}"></div>
      <div><label style="font-size:.8rem;color:rgba(255,255,255,.55);">Status</label>
        <select id="eqEditStatus" class="input" style="width:100%;">
          ${['active','maintenance','retired'].map(s => `<option value="${s}"${s===eq.status?' selected':''}>${s}</option>`).join('')}
        </select></div>
    </div>
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Hourly rate ($/hr)</label>
    <input id="eqEditRate" class="input" style="margin-bottom:10px;width:100%;" type="number" min="0" value="${eq.hourly_rate_cents ? (eq.hourly_rate_cents/100).toFixed(0) : ''}">
    <label style="font-size:.8rem;color:rgba(255,255,255,.55);">Notes</label>
    <textarea id="eqEditNotes" class="input" style="margin-bottom:16px;width:100%;height:60px;">${escapeHtml(eq.notes||'')}</textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="btn btn-ghost" onclick="document.getElementById('editEquipmentModal')?.remove()">Cancel</button>
      <button class="btn btn-primary" id="eqEditSaveBtn">Save</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#eqEditSaveBtn').onclick = async () => {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    try {
      const res = await fetch('/.netlify/functions/manage-equipment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          id,
          name: document.getElementById('eqEditName')?.value?.trim(),
          unit_number: document.getElementById('eqEditUnit')?.value || null,
          status: document.getElementById('eqEditStatus')?.value || 'active',
          hourly_rate_cents: Math.round((parseFloat(document.getElementById('eqEditRate')?.value) || 0) * 100),
          notes: document.getElementById('eqEditNotes')?.value || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      modal.remove();
      await fetchEquipment();
      showToast('Equipment updated.');
    } catch (err) { showToast('Error: ' + err.message); }
  };
}

async function deleteEquipment(id) {
  if (!(await showConfirmModal('Remove this equipment?', 'Remove', 'Cancel'))) return;
  const token = (await sb.auth.getSession()).data.session?.access_token;
  try {
    const res = await fetch(`/.netlify/functions/manage-equipment?id=${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed');
    EQUIPMENT_CACHE = EQUIPMENT_CACHE.filter(e => e.id !== id);
    renderEquipment();
    showToast('Equipment removed.');
  } catch (err) { showToast('Error: ' + err.message); }
}

let EQUIPMENT_WORKSPACE_LOADED = false;
let EQUIPMENT_WORKSPACE_BINDINGS_BOUND = false;

function loadEquipmentWorkspace() {
  if (EQUIPMENT_WORKSPACE_LOADED) return;
  EQUIPMENT_WORKSPACE_LOADED = true;
  fetchEquipment().catch(console.warn);
}

function initEquipmentWorkspaceBindings() {
  if (EQUIPMENT_WORKSPACE_BINDINGS_BOUND) return;
  EQUIPMENT_WORKSPACE_BINDINGS_BOUND = true;
  $("btnAddEquipment")?.addEventListener("click", () => openAddEquipmentModal());
  $("btnRefreshEquipment")?.addEventListener("click", () => fetchEquipment().catch(console.warn));
}

const EQUIPMENT_WORKSPACE_HELPERS = {
  fetchEquipment,
  renderEquipment,
  openAddEquipmentModal,
  openEditEquipmentModal,
  deleteEquipment,
  loadEquipmentWorkspace,
  initEquipmentWorkspaceBindings,
};

window.PROOFLINK_OPERATOR_EQUIPMENT_WORKSPACE = {
  ...(window.PROOFLINK_OPERATOR_EQUIPMENT_WORKSPACE || {}),
  ...EQUIPMENT_WORKSPACE_HELPERS,
};

Object.assign(window, EQUIPMENT_WORKSPACE_HELPERS);
