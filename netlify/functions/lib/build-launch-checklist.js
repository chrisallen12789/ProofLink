"use strict";

function countFromSettled(result) {
  if (!result || result.status !== "fulfilled") return 0;
  return Number(result.value?.count || 0);
}

function parseSiteSettings(result) {
  if (!result || result.status !== "fulfilled") return {};
  const raw = result.value?.data?.config_value;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function hasMeaningfulWebsiteShape(config) {
  return Boolean(
    config?.hero_heading ||
    config?.tagline ||
    config?.logo_url ||
    config?.hero_image_url ||
    config?.public_contact_email ||
    config?.public_business_phone
  );
}

function buildLaunchChecklist({
  tenant,
  customersResult,
  bidsResult,
  ordersResult,
  paymentsResult,
  productsResult,
  configResult,
}) {
  const customerCount = countFromSettled(customersResult);
  const bidCount = countFromSettled(bidsResult);
  const orderCount = countFromSettled(ordersResult);
  const paymentCount = countFromSettled(paymentsResult);
  const productCount = countFromSettled(productsResult);
  const siteSettings = parseSiteSettings(configResult);

  const websiteShaped = hasMeaningfulWebsiteShape(siteSettings);
  const websitePublished = String(siteSettings.site_publish_status || "").trim().toLowerCase() === "published";
  const workCount = bidCount + orderCount;

  const steps = [
    {
      id: "workspace_ready",
      label: "Account is ready",
      detail: tenant?.name
        ? `${tenant.name} is provisioned and ready for the first real customer flow.`
        : "The account is provisioned and ready for the first real customer flow.",
      complete: true,
    },
    {
      id: "first_offer",
      label: "Add your first service or rate sheet",
      detail: productCount > 0
        ? `${productCount} service${productCount === 1 ? "" : "s"} loaded so far.`
        : "Load at least one service, package, or rate so the team has something concrete to sell.",
      complete: productCount > 0,
      cta: { label: "Open services", href: "/operator/#products" },
    },
    {
      id: "first_customer",
      label: "Capture your first customer",
      detail: customerCount > 0
        ? `${customerCount} customer${customerCount === 1 ? "" : "s"} already in the system.`
        : "Create or import the first customer so work, notes, and payment history have a real home.",
      complete: customerCount > 0,
      cta: { label: "Open customers", href: "/operator/#customers" },
    },
    {
      id: "first_workflow",
      label: "Create your first quote or tracked job",
      detail: workCount > 0
        ? `${bidCount} quote${bidCount === 1 ? "" : "s"} and ${orderCount} tracked work item${orderCount === 1 ? "" : "s"} in motion.`
        : "Turn interest into something the business can follow through on: a quote, estimate, or tracked work record.",
      complete: workCount > 0,
      cta: { label: "Open work", href: "/operator/#orders" },
    },
    {
      id: "first_payment",
      label: "Record your first payment or deposit",
      detail: paymentCount > 0
        ? `${paymentCount} payment${paymentCount === 1 ? "" : "s"} recorded so far.`
        : "Close the loop by logging money received, even if the first payment is cash, check, or a deposit.",
      complete: paymentCount > 0,
      cta: { label: "Open payments", href: "/operator/#payments" },
    },
    {
      id: "website_shape",
      label: "Make the website feel like the business",
      detail: websiteShaped
        ? "The public-facing details are starting to reflect the business."
        : "Add the headline, contact details, and brand touches customers should recognize.",
      complete: websiteShaped,
      cta: { label: "Open website", href: "/operator/#setup" },
    },
    {
      id: "website_publish",
      label: "Publish when you're ready",
      detail: websitePublished
        ? "The website is live."
        : "Preview the public pages and publish once the business story feels right.",
      complete: websitePublished,
      cta: { label: "Open publish controls", href: "/operator/#setup" },
    },
  ];

  const completedCount = steps.filter((step) => step.complete).length;

  return {
    steps,
    completed: completedCount,
    total: steps.length,
    percent: Math.round((completedCount / steps.length) * 100),
    launch_ready: completedCount === steps.length,
  };
}

module.exports = {
  buildLaunchChecklist,
};
