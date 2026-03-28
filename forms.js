// FILE: forms.js
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const cfg = window.PROOFLINK_CONFIG || {};
  const tenant = cfg.tenant || {};

  function initAntiSpam(form) {
    if (!form) return;
    const started = Date.now();
    const startedInput = form.querySelector('input[name="startedAt"]');
    if (startedInput) startedInput.value = String(started);
  }

  const API_BASE = (window.HTC_EMAIL_API_BASE || "").replace(/\/+$/, "");

  function apiUrl(path) {
    if (API_BASE) return `${API_BASE}${path}`;
    return path;
  }

  async function postJson(path, payload) {
    const res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let data = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      data = await res.json().catch(() => null);
    } else {
      const text = await res.text().catch(() => "");
      data = text ? { message: text } : null;
    }

    if (!res.ok) {
      const msg =
        (data && (data.error || data.message)) ||
        `Request failed (${res.status})`;
      throw new Error(msg);
    }

    return data;
  }

  function setStatus(form, type, message) {
    const box = form.querySelector("[data-status]");
    if (!box) return;
    box.className = `status status--${type}`;
    box.textContent = message;
    box.style.display = "block";
  }

  function clearStatus(form) {
    const box = form.querySelector("[data-status]");
    if (!box) return;
    box.style.display = "none";
    box.textContent = "";
    box.className = "status";
  }

  function formToObject(form) {
    const fd = new FormData(form);
    const obj = {};
    for (const [k, v] of fd.entries()) obj[k] = String(v ?? "").trim();

    if (form && form.id === "orderForm") {
      const fulfillmentEl = $("#orderFulfillment");
      const requestedDateEl = $("#orderRequestedDate");
      const requestedTimeEl = $("#orderRequestedTime");
      const deliveryZipEl = $("#orderDeliveryZip");

      if (fulfillmentEl) obj.fulfillment = String(fulfillmentEl.value || "").trim();
      if (requestedDateEl) obj.requestedDate = String(requestedDateEl.value || "").trim();
      if (requestedTimeEl) obj.requestedTime = String(requestedTimeEl.value || "").trim();
      if (deliveryZipEl) obj.deliveryZip = String(deliveryZipEl.value || "").trim();
    }

    return obj;
  }

  function buildTenantMeta() {
    return {
      tenantId: tenant.id || "default",
      tenantSlug: tenant.slug || "default",
      tenantBusinessName: tenant.businessName || "Tenant",
      platformName: (cfg.platform && cfg.platform.name) || "ProofLink",
    };
  }

  function buildOrderPayload(raw) {
    const cartApi = window.HTC_CART;
    if (!cartApi || typeof cartApi.getCheckoutContext !== "function") {
      throw new Error("Cart is not ready yet. Refresh and try again.");
    }

    const cartContext = cartApi.getCheckoutContext();
    if (!cartContext.items || !cartContext.items.length) {
      throw new Error("Your cart is empty. Add items before submitting an order request.");
    }

    if (raw.fulfillment === "delivery" && !cartContext.deliveryValid) {
      throw new Error(cartContext.deliveryMessage || "Delivery is not available for this selection.");
    }

    const noteParts = [];
    if (raw.notes) noteParts.push(String(raw.notes).trim());
    if (cartContext.deliveryMessage) noteParts.push(String(cartContext.deliveryMessage).trim());

    return {
      payload: {
        ...raw,
        ...buildTenantMeta(),
        customer_name: raw.name || "",
        scheduled_date: raw.requestedDate || null,
        scheduled_time: raw.requestedTime || null,
        cartSummary: typeof cartApi.toSummaryText === "function" ? cartApi.toSummaryText() : "",
        cart_summary: typeof cartApi.toSummaryText === "function" ? cartApi.toSummaryText() : "",
        items: cartContext.items,
        subtotalCents: cartContext.subtotalCents,
        subtotal_cents: cartContext.subtotalCents,
        deliveryFeeCents: cartContext.deliveryFeeCents,
        delivery_fee_cents: cartContext.deliveryFeeCents,
        totalCents: cartContext.totalCents,
        total_cents: cartContext.totalCents,
        estimatedTotalCents: cartContext.totalCents,
        estimated_total_cents: cartContext.totalCents,
        unpricedCount: cartContext.unpricedCount,
        unpriced_count: cartContext.unpricedCount,
        itemCount: cartContext.itemCount,
        item_count: cartContext.itemCount,
        deliveryMessage: cartContext.deliveryMessage,
        notes: noteParts.filter(Boolean).join("\n") || null,
        turnstileToken: raw["cf-turnstile-response"] || raw.turnstileToken || "",
        fax: "",
      },
      cartContext,
    };
  }

  function buildContactPayload(raw) {
    return {
      ...raw,
      ...buildTenantMeta(),
      turnstileToken: raw["cf-turnstile-response"] || raw.turnstileToken || "",
      fax: "",
    };
  }

  function ensureTurnstileToken(form, raw) {
    const widget = form.querySelector(".cf-turnstile");
    if (!widget) return;
    const token = raw["cf-turnstile-response"] || raw.turnstileToken || "";
    if (!token) {
      throw new Error("Spam protection is still loading. Please wait a moment, then try again.");
    }
  }

  function bind(formSelector, endpoint, requiredKeys, options = {}) {
    const form = $(formSelector);
    if (!form) return;

    initAntiSpam(form);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearStatus(form);

      const raw = formToObject(form);

      if (raw.fax) {
        setStatus(form, "error", "Submission rejected.");
        return;
      }

      try {
        ensureTurnstileToken(form, raw);
      } catch (err) {
        setStatus(form, "error", err.message || "Spam protection is still loading. Please try again.");
        return;
      }

      if (options.requireCart) {
        try {
          const built = buildOrderPayload(raw);
          void built;
        } catch (err) {
          setStatus(form, "error", err.message || "Please review your cart before submitting.");
          return;
        }
      }

      if (raw.deliveryZip && !/^\d{5}$/.test(raw.deliveryZip)) {
        setStatus(form, "error", "Please enter a valid 5-digit ZIP code.");
        return;
      }

      const FIELD_LABELS = {
        fulfillment: 'Delivery preference',
        name: 'Your name',
        email: 'Email address',
        phone: 'Phone number',
        address: 'Street address',
        city: 'City',
        state: 'State',
        zip: 'ZIP code',
        message: 'Message',
        service: 'Service type',
        date: 'Preferred date',
        subject: 'Subject',
      };

      for (const k of requiredKeys) {
        if (!raw[k]) {
          setStatus(form, "error", `Please fill out: ${FIELD_LABELS[k] || k}`);
          return;
        }
      }

      let payload = { ...raw };
      let cartContext = null;

      try {
        if (options.requireCart) {
          const built = buildOrderPayload(raw);
          payload = built.payload;
          cartContext = built.cartContext;
        } else {
          payload = buildContactPayload(raw);
        }

        delete payload["cf-turnstile-response"];
      } catch (err) {
        setStatus(form, "error", err.message || "Please review your cart before submitting.");
        return;
      }

      const submitBtn =
        form.querySelector('button[type="submit"]') ||
        form.querySelector('input[type="submit"]');

      if (submitBtn) submitBtn.disabled = true;

      try {
        setStatus(form, "info", "Sending...");
        const response = await postJson(endpoint, payload);

        if (options.requireCart && cartContext) {
          if (window.HTC_CART && typeof window.HTC_CART.clear === "function") {
            window.HTC_CART.clear();
          }
        }

        const orderId = response && response.orderId ? ` Order ID: ${response.orderId}.` : "";
        const orderSuccessMessage = response && response.email_warning
          ? `Sent. Your request was saved.${orderId} We could not send an email confirmation just now, but the business still has your request.`
          : `Sent. Check your email for confirmation.${orderId}`;
        setStatus(form, "success", orderSuccessMessage);
        form.reset();

        if (typeof window.turnstile !== "undefined") {
          const widget = form.querySelector(".cf-turnstile");
          if (widget) {
            try { window.turnstile.reset(widget); } catch {}
          }
        }
      } catch (err) {
        setStatus(form, "error", err.message || "Failed to send.");
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  bind("#contactForm", "/api/contact", ["name", "email", "subject", "message"]);
  bind("#orderForm", "/api/order", ["name", "email", "phone", "fulfillment"], { requireCart: true });
})();
