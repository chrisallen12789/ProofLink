// Shared record presentation helpers extracted from operator.js so record
// layouts can evolve without bloating the main operator client file.
(function attachOperatorRecordUi(global) {
  function renderRecordHeroCard({
    eyebrow = "Record",
    title = "Untitled",
    badges = [],
    meta = [],
    summary = [],
    description = "",
    actionsHtml = "",
  } = {}) {
    const badgeHtml = (Array.isArray(badges) ? badges : [])
      .filter((item) => item && item.label)
      .map((item) => `<span class="pill ${escapeAttr(item.tone || "")}">${escapeHtml(item.label)}</span>`)
      .join("");
    const metaHtml = (Array.isArray(meta) ? meta : [])
      .filter(Boolean)
      .map((item) => `<div class="record-hero__meta-line">${escapeHtml(item)}</div>`)
      .join("");
    const summaryHtml = (Array.isArray(summary) ? summary : [])
      .filter((item) => item && item.label)
      .map((item) => `
        <div class="record-hero__metric ${escapeAttr(item.tone || "")}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value || "")}</strong>
          ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
        </div>
      `)
      .join("");

    return `
      <div class="record-hero detail-card">
        <div class="record-hero__head">
          <div class="record-hero__main">
            <div class="kicker">${escapeHtml(eyebrow)}</div>
            <h3>${escapeHtml(title)}</h3>
            ${metaHtml ? `<div class="record-hero__meta">${metaHtml}</div>` : ""}
            ${description ? `<div class="detail-copy">${escapeHtml(description)}</div>` : ""}
          </div>
          ${badgeHtml ? `<div class="record-hero__badges workspace-chip-row">${badgeHtml}</div>` : ""}
        </div>
        ${summaryHtml ? `<div class="record-hero__summary">${summaryHtml}</div>` : ""}
        ${actionsHtml ? `<div class="record-hero__actions">${actionsHtml}</div>` : ""}
      </div>
    `;
  }

  function renderRecordActionButtons(actions = []) {
    return (Array.isArray(actions) ? actions : [])
      .filter((action) => action && (action.label || action.html))
      .map((action) => {
        if (action.html) return action.html;
        const attrs = [
          `type="${escapeAttr(action.type || "button")}"`,
          `class="${escapeAttr(action.className || "btn btn-ghost")}"`,
        ];
        if (action.id) attrs.push(`id="${escapeAttr(action.id)}"`);
        if (action.title) attrs.push(`title="${escapeAttr(action.title)}"`);
        if (action.style) attrs.push(`style="${escapeAttr(action.style)}"`);
        if (action.disabled) attrs.push("disabled");
        Object.entries(action.data || {}).forEach(([key, value]) => {
          if (value !== undefined && value !== null) attrs.push(`data-${escapeAttr(key)}="${escapeAttr(String(value))}"`);
        });
        return `<button ${attrs.join(" ")}>${escapeHtml(action.label || "")}</button>`;
      })
      .join("");
  }

  function renderRecordActionRail({
    eyebrow = "Quick actions",
    title = "Keep things moving",
    description = "",
    actions = [],
    footerHtml = "",
  } = {}) {
    const actionHtml = renderRecordActionButtons(actions);
    return `
      <div class="record-action-rail detail-card record-card-spaced">
        <div class="record-action-rail__head">
          <div>
            <div class="kicker">${escapeHtml(eyebrow)}</div>
            <h3>${escapeHtml(title)}</h3>
          </div>
          ${description ? `<div class="detail-copy">${escapeHtml(description)}</div>` : ""}
        </div>
        ${actionHtml ? `<div class="record-action-rail__buttons">${actionHtml}</div>` : ""}
        ${footerHtml || ""}
      </div>
    `;
  }

  function renderLinkedRecordCard({
    eyebrow = "Linked records",
    title = "Keep the full chain together",
    description = "",
    items = [],
    footerHtml = "",
  } = {}) {
    const itemHtml = (Array.isArray(items) ? items : [])
      .filter((item) => item && item.label)
      .map((item) => `
        <div class="record-linked__item">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value || "")}</strong>
          ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
        </div>
      `)
      .join("");
    return `
      <div class="record-linked detail-card record-card-spaced">
        <div class="record-linked__head">
          <div>
            <div class="kicker">${escapeHtml(eyebrow)}</div>
            <h3>${escapeHtml(title)}</h3>
          </div>
          ${description ? `<div class="detail-copy">${escapeHtml(description)}</div>` : ""}
        </div>
        ${itemHtml ? `<div class="record-linked__grid">${itemHtml}</div>` : `<div class="empty-note">No linked records yet.</div>`}
        ${footerHtml || ""}
      </div>
    `;
  }

  function renderRecordFollowThroughCard({
    eyebrow = "Follow-through",
    title = "Keep the next move clear",
    description = "",
    summary = [],
    controlsHtml = "",
    actions = [],
    timelineHtml = "",
  } = {}) {
    const summaryHtml = (Array.isArray(summary) ? summary : [])
      .filter((item) => item && item.label)
      .map((item) => `
        <div class="record-follow-through__metric">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value || "")}</strong>
          ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
        </div>
      `)
      .join("");
    const actionsHtml = renderRecordActionButtons(actions);
    return `
      <div class="record-follow-through detail-card record-card-spaced">
        <div class="record-follow-through__head">
          <div>
            <div class="kicker">${escapeHtml(eyebrow)}</div>
            <h3>${escapeHtml(title)}</h3>
          </div>
          ${description ? `<div class="detail-copy">${escapeHtml(description)}</div>` : ""}
        </div>
        ${summaryHtml ? `<div class="record-follow-through__summary">${summaryHtml}</div>` : ""}
        ${controlsHtml ? `<div class="record-follow-through__controls">${controlsHtml}</div>` : ""}
        ${actionsHtml ? `<div class="record-follow-through__actions">${actionsHtml}</div>` : ""}
        ${timelineHtml ? `<div class="record-follow-through__timeline">${timelineHtml}</div>` : ""}
      </div>
    `;
  }

  const helpers = {
    renderRecordHeroCard,
    renderRecordActionButtons,
    renderRecordActionRail,
    renderLinkedRecordCard,
    renderRecordFollowThroughCard,
  };

  global.PROOFLINK_OPERATOR_RECORD_UI = {
    ...(global.PROOFLINK_OPERATOR_RECORD_UI || {}),
    ...helpers,
  };
  Object.assign(global, helpers);
})(window);
