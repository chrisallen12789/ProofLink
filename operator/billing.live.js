async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body || {})
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

function readQueryState() {
  const params = new URLSearchParams(window.location.search);
  return {
    upgrade: params.get("upgrade")
  };
}

function renderBanner(state) {
  if (state.upgrade === "success") {
    return '<section class="pl-billing-banner is-success"><p>Upgrade completed. Billing state will refresh automatically after webhook confirmation.</p></section>';
  }

  if (state.upgrade === "cancelled") {
    return '<section class="pl-billing-banner is-neutral"><p>Upgrade cancelled. No billing change was made.</p></section>';
  }

  return "";
}

async function getTenantPaymentStatus() {
  const response = await fetch("/.netlify/functions/tenant-payment-status", {
    credentials: "include"
  });
  if (!response.ok) throw new Error("Failed to load billing state");
  return response.json();
}

function render(root, tenant, bannerHtml) {
  const plan = tenant?.prooflink_plan_key || "starter";
  root.innerHTML = `
    ${bannerHtml}
    <section class="pl-billing-live">
      <h1>Billing and payments</h1>
      <div id="billingMessage" class="pl-billing-banner is-neutral" style="display:none;"></div>
      <p><strong>Plan:</strong> ${plan}</p>
      <p><strong>Billing mode:</strong> Manual</p>
      <p><strong>Online checkout:</strong> Disabled</p>
      <p><strong>Collection options:</strong> Invoice, cash, check, Zelle, Cash App</p>

      <div class="pl-billing-live__actions">
        <button type="button" data-open-manual-guide="true">Open payment guide</button>
      </div>
    </section>
  `;

  root.addEventListener("click", async (event) => {
    const messageEl = root.querySelector("#billingMessage");
    const setBillingMessage = (message, tone = "neutral") => {
      if (!messageEl) return;
      messageEl.innerHTML = `<p>${message}</p>`;
      messageEl.className = `pl-billing-banner is-${tone}`;
      messageEl.style.display = "block";
    };
    const manualGuideButton = event.target.closest("[data-open-manual-guide='true']");

    try {
      if (manualGuideButton) {
        setBillingMessage("Manual-payments mode is active. Use invoices and offline collection methods until a replacement provider is chosen.");
      }
    } catch (error) {
      setBillingMessage(error.message || "Something went wrong while opening billing.");
    }
  });
}

async function init() {
  const root = document.getElementById("billingRoot");
  if (!root) return;

  root.innerHTML = "<p>Loading billing...</p>";

  try {
    const state = readQueryState();
    const payload = await getTenantPaymentStatus();
    const tenant = payload?.tenant || payload || {};
    render(root, tenant, renderBanner(state));
  } catch (error) {
    root.innerHTML = `<p>Unable to load billing page: ${error.message}</p>`;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
