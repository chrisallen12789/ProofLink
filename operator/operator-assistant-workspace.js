// Assistant and customer-message workspace helpers extracted from operator.js
// so the main shell can lazy-load them only when the user opens those panels.
(function attachOperatorAssistantWorkspace(global) {
  let aiPanelLoaded = false;
  let bindingsReady = false;

  function runtime() {
    return global.PROOFLINK_OPERATOR_RUNTIME || {};
  }

  function getAccessToken() {
    return runtime().getAccessToken?.() || Promise.resolve("");
  }

  function getSupabase() {
    return runtime().getSupabase?.() || global.sb;
  }

  function getTenantColumn() {
    return runtime().getTenantColumn?.() || "tenant_id";
  }

  function getTenantId() {
    return runtime().getTenantId?.() || "";
  }

  function getActiveOrderId() {
    return runtime().getActiveOrderId?.() || "";
  }

  function getActiveBidId() {
    return runtime().getActiveBidId?.() || "";
  }

  function getOrdersCache() {
    return runtime().getOrdersCache?.() || [];
  }

  function getBidsCache() {
    return runtime().getBidsCache?.() || [];
  }

  async function fetchAndRenderMessages() {
    const list = global.$?.("messagesList");
    if (!list) return;
    list.innerHTML = `<p class="muted" style="padding:12px 0;">Loading…</p>`;
    try {
      const sb = getSupabase();
      if (!sb) throw new Error("Messages workspace is not ready.");
      const { data, error } = await sb
        .from("customer_messages")
        .select("id, customer_name, customer_email, message, reply_text, replied_at, created_at, status")
        .eq(getTenantColumn(), getTenantId())
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      if (!data || !data.length) {
        list.innerHTML = `<p class="muted" style="padding:12px 0;">No messages yet. Messages from customers submitted through your contact form will appear here.</p>`;
        return;
      }

      list.innerHTML = data.map((msg) => {
        const date = msg.created_at
          ? new Date(msg.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
          : "—";
        return `<div style="padding:14px 0;border-bottom:1px solid rgba(255,255,255,.06);">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <div style="font-weight:600;font-size:.88rem;">${global.escapeHtml(msg.customer_name || "Customer")}</div>
            <div style="font-size:.78rem;color:rgba(255,255,255,.4);">${global.escapeHtml(msg.customer_email || "")}</div>
            <div style="font-size:.75rem;color:rgba(255,255,255,.3);margin-left:auto;">${date}</div>
          </div>
          <div style="font-size:.85rem;color:rgba(255,255,255,.7);margin-bottom:${msg.reply_text ? "8px" : "10px"};">${global.escapeHtml(msg.message || "")}</div>
          ${msg.reply_text ? `<div style="background:rgba(200,75,47,.08);border-left:3px solid #c84b2f;padding:8px 12px;font-size:.82rem;color:rgba(255,255,255,.6);margin-bottom:8px;"><span style="font-size:.75rem;color:#c84b2f;font-weight:600;display:block;margin-bottom:4px;">Your reply</span>${global.escapeHtml(msg.reply_text)}</div>` : ""}
          ${!msg.reply_text ? `<div style="margin-top:6px;">
            <div class="msg-reply-form" data-id="${global.escapeAttr(msg.id)}" data-name="${global.escapeAttr(msg.customer_name || "")}" style="display:none;">
              <textarea class="msg-reply-input" rows="3" placeholder="Type your reply…" style="width:100%;background:#0f1117;border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#e8e9eb;padding:8px 10px;font-size:.85rem;resize:vertical;margin-bottom:6px;font-family:inherit;outline:none;"></textarea>
              <div style="display:flex;gap:8px;">
                <button class="btn btn-primary btn-sm msg-send-reply" type="button">Send reply</button>
                <button class="btn btn-ghost btn-sm msg-cancel-reply" type="button">Cancel</button>
              </div>
              <div class="msg-reply-result" style="font-size:.8rem;margin-top:6px;"></div>
            </div>
            <button class="btn btn-ghost btn-sm msg-show-reply" data-id="${global.escapeAttr(msg.id)}" type="button">Reply</button>
          </div>` : ""}
        </div>`;
      }).join("");

      list.querySelectorAll(".msg-show-reply").forEach((btn) => {
        btn.addEventListener("click", () => {
          const form = list.querySelector(`.msg-reply-form[data-id="${btn.dataset.id}"]`);
          if (form) {
            form.style.display = "block";
            btn.style.display = "none";
          }
        });
      });

      list.querySelectorAll(".msg-cancel-reply").forEach((btn) => {
        btn.addEventListener("click", () => {
          const form = btn.closest(".msg-reply-form");
          const showBtn = form ? list.querySelector(`.msg-show-reply[data-id="${form.dataset.id}"]`) : null;
          if (form) form.style.display = "none";
          if (showBtn) showBtn.style.display = "";
        });
      });

      list.querySelectorAll(".msg-send-reply").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const form = btn.closest(".msg-reply-form");
          const textarea = form?.querySelector(".msg-reply-input");
          const resultEl = form?.querySelector(".msg-reply-result");
          const reply = textarea?.value.trim() || "";
          if (!reply) {
            if (resultEl) {
              resultEl.textContent = "Please enter a reply.";
              resultEl.style.color = "#f87171";
            }
            return;
          }
          btn.disabled = true;
          btn.textContent = "Sending…";
          try {
            const tok = await getAccessToken();
            const res = await fetch("/.netlify/functions/reply-customer-message", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
              body: JSON.stringify({ message_id: form?.dataset.id, reply_text: reply }),
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload.error || "Failed to send reply");
            if (resultEl) {
              resultEl.textContent = "Reply sent ✓";
              resultEl.style.color = "#4ade80";
            }
            setTimeout(() => fetchAndRenderMessages().catch(console.error), 1500);
          } catch (err) {
            if (resultEl) {
              resultEl.textContent = err.message || "Error";
              resultEl.style.color = "#f87171";
            }
            btn.disabled = false;
            btn.textContent = "Send reply";
          }
        });
      });
    } catch (err) {
      console.error("[fetchAndRenderMessages]", err);
      list.innerHTML = `<p class="muted" style="padding:12px 0;">Failed to load messages.</p>`;
    }
  }

  async function loadAIBriefing() {
    const briefEl = global.$?.("aiBriefContent");
    const statusEl = global.$?.("aiBriefStatus");
    const chipsEl = global.$?.("aiContextChips");
    if (!briefEl) return;
    if (statusEl) {
      statusEl.textContent = "Loading...";
      statusEl.style.display = "block";
    }
    briefEl.style.display = "none";
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/ai-brief", {
        method: "GET",
        headers: { Authorization: `Bearer ${tok}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to load briefing");
      if (statusEl) statusEl.style.display = "none";
      briefEl.style.display = "block";
      briefEl.innerHTML = payload.briefing
        ? payload.briefing.split("\n").map((line) => `<p style="margin:0 0 6px;">${global.escapeHtml(line) || "&nbsp;"}</p>`).join("")
        : "<p class='muted'>No briefing available.</p>";
      if (chipsEl && payload.context_summary) {
        const cs = payload.context_summary;
        const chips = [
          cs.today_appointments > 0 && `${cs.today_appointments} appt${cs.today_appointments > 1 ? "s" : ""} today`,
          cs.upcoming_jobs > 0 && `${cs.upcoming_jobs} job${cs.upcoming_jobs > 1 ? "s" : ""} this week`,
          cs.unpaid_orders > 0 && `${cs.unpaid_orders} unpaid`,
          cs.pending_quotes > 0 && `${cs.pending_quotes} pending quote${cs.pending_quotes > 1 ? "s" : ""}`,
          cs.unread_messages > 0 && `${cs.unread_messages} message${cs.unread_messages > 1 ? "s" : ""}`,
          cs.overdue_orders > 0 && `${cs.overdue_orders} overdue`,
          cs.reminders_needed > 0 && `${cs.reminders_needed} reminder${cs.reminders_needed > 1 ? "s" : ""} needed`,
          cs.multi_site_accounts > 0 && `${cs.multi_site_accounts} multi-site account${cs.multi_site_accounts > 1 ? "s" : ""}`,
        ].filter(Boolean);
        chipsEl.innerHTML = chips.map((chip) => `<span style="display:inline-block;background:rgba(200,75,47,.15);border:1px solid rgba(200,75,47,.3);border-radius:12px;padding:2px 10px;font-size:.75rem;color:rgba(255,255,255,.7);">${global.escapeHtml(chip)}</span>`).join(" ");
      }
    } catch (err) {
      console.error("[loadAIBriefing]", err);
      if (statusEl) statusEl.textContent = err.message || "Failed to load.";
      briefEl.style.display = "none";
    }
  }

  async function aiAskQuestion(question, specialist = "general") {
    const answerEl = global.$?.("aiAnswer");
    const errorEl = global.$?.("aiError");
    const btn = global.$?.("btnAskAI");
    if (!answerEl) return;
    if (btn) btn.disabled = true;
    if (errorEl) errorEl.style.display = "none";
    answerEl.style.display = "block";
    answerEl.textContent = "Thinking...";
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/ai-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ question, mode: "copilot", specialist }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to get answer");
      answerEl.textContent = payload.answer || "(no response)";
    } catch (err) {
      answerEl.style.display = "none";
      if (errorEl) {
        errorEl.textContent = err.message || "Error";
        errorEl.style.display = "block";
      }
    }
    if (btn) btn.disabled = false;
  }

  function buildDraftExtras(draftType) {
    const extras = {};
    const activeOrderId = getActiveOrderId();
    if (activeOrderId) {
      const order = getOrdersCache().find((row) => row.id === activeOrderId);
      if (order) {
        extras.customer_name = order.customer_name || order.email || "";
        extras.order_title = order.title || order.cart_summary || "";
        extras.amount = order.total_cents ? `$${(order.total_cents / 100).toFixed(2)}` : (order.total_amount || "");
        extras.status = order.status || "";
        extras.days_overdue = order.payment_due_date
          ? Math.max(0, Math.floor((Date.now() - new Date(order.payment_due_date).getTime()) / 86400000))
          : null;
      }
    }
    const activeBidId = getActiveBidId();
    if (activeBidId) {
      const bid = getBidsCache().find((row) => row.id === activeBidId);
      if (bid && !extras.customer_name) {
        extras.bid_title = bid.title || "";
      }
    }
    return extras;
  }

  async function requestAIDraft(draftType) {
    const areaEl = global.$?.("aiDraftArea");
    const outputEl = global.$?.("aiDraftText");
    const copyBtn = global.$?.("btnCopyDraft");
    if (!outputEl) return;
    if (areaEl) areaEl.style.display = "block";
    if (copyBtn) copyBtn.style.display = "none";
    outputEl.textContent = "Drafting...";
    try {
      const tok = await getAccessToken();
      const res = await fetch("/.netlify/functions/ai-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({
          question: draftType,
          mode: "draft",
          draft_type: draftType,
          draft_extras: buildDraftExtras(draftType),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to generate draft");
      outputEl.textContent = payload.answer || "(no draft generated)";
      if (copyBtn) copyBtn.style.display = "inline-flex";
    } catch (err) {
      outputEl.textContent = `Error: ${err.message || "Unknown error"}`;
    }
  }

  async function initAIPanel() {
    bindAssistantWorkspace();
    if (aiPanelLoaded) return;
    aiPanelLoaded = true;
    await loadAIBriefing();
  }

  function bindAssistantWorkspace() {
    if (bindingsReady) return;
    bindingsReady = true;

    global.$?.("btnRefreshMessages")?.addEventListener("click", () => {
      fetchAndRenderMessages().catch(console.error);
    });

    global.$?.("btnRefreshBrief")?.addEventListener("click", async () => {
      aiPanelLoaded = false;
      await loadAIBriefing();
      aiPanelLoaded = true;
    });

    global.$?.("btnAskAI")?.addEventListener("click", () => {
      const question = global.$?.("aiQuestion")?.value.trim();
      if (question) aiAskQuestion(question);
    });

    global.$?.("aiQuestion")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        global.$?.("btnAskAI")?.click();
      }
    });

    global.document.querySelectorAll(".ai-quick[data-q]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const question = btn.getAttribute("data-q") || "";
        const input = global.$?.("aiQuestion");
        if (input) input.value = question;
        aiAskQuestion(question, btn.getAttribute("data-specialist") || "general");
      });
    });

    global.document.querySelectorAll(".ai-draft[data-type]").forEach((btn) => {
      btn.addEventListener("click", () => requestAIDraft(btn.getAttribute("data-type")));
    });

    global.$?.("btnCopyDraft")?.addEventListener("click", () => {
      const text = global.$?.("aiDraftText")?.textContent || "";
      if (text) navigator.clipboard.writeText(text).catch(() => {});
    });

    global.$?.("btnCloseDraft")?.addEventListener("click", () => {
      const area = global.$?.("aiDraftArea");
      if (area) area.style.display = "none";
    });
  }

  const workspace = {
    bindAssistantWorkspace,
    fetchAndRenderMessages,
    initAIPanel,
    loadAIBriefing,
    aiAskQuestion,
    requestAIDraft,
  };

  global.PROOFLINK_OPERATOR_ASSISTANT_WORKSPACE = {
    ...(global.PROOFLINK_OPERATOR_ASSISTANT_WORKSPACE || {}),
    ...workspace,
  };
  Object.assign(global, {
    fetchAndRenderMessages,
    initAIPanel,
  });
  bindAssistantWorkspace();
})(window);
