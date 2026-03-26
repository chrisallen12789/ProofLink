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
      <h1>Billing</h1>
      <div id="billingMessage" class="pl-billing-banner is-neutral" style="display:none;"></div>
      <p><strong>Plan:</strong> ${plan}</p>
      <p><strong>Billing status:</strong> ${tenant?.billing_status || "inactive"}</p>
      <p><strong>Connect status:</strong> ${tenant?.connect_status || "not_started"}</p>

      <div class="pl-billing-live__actions">
        <button type="button" data-upgrade-plan="growth">Upgrade to Growth</button>
        <button type="button" data-upgrade-plan="enterprise">Upgrade to Enterprise</button>
        <button type="button" data-open-portal="true">Manage billing</button>
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
    const upgradeButton = event.target.closest("[data-upgrade-plan]");
    const portalButton = event.target.closest("[data-open-portal='true']");

    try {
      if (upgradeButton) {
        const targetPlan = upgradeButton.getAttribute("data-upgrade-plan");
        const payload = await postJson("/.netlify/functions/create-billing-upgrade-session", {
          tenantId: tenant.id,
          targetPlan,
          featureKey: "manual_upgrade",
          customerEmail: tenant.owner_email || ""
        });

        if (payload.url) window.location.href = payload.url;
        return;
      }

      if (portalButton) {
        if (!tenant.stripe_customer_id) {
          setBillingMessage("Billing is not connected for this account yet. Reach out to support if you need help getting it set up.");
          return;
        }

        const payload = await postJson("/.netlify/functions/create-billing-portal-session", {
          customerId: tenant.stripe_customer_id
        });

        if (payload.url) window.location.href = payload.url;
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
