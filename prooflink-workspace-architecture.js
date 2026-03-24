(function () {
  const TIER_ORDER = ["starter", "growth", "enterprise"];

  const CORE_MODULES = {
    crm: {
      label: "Customers / CRM",
      description: "The system of record for people, companies, contacts, notes, and relationship history.",
    },
    intake: {
      label: "Leads / Intake",
      description: "The first record that captures why the customer reached out and what needs to happen next.",
    },
    bids: {
      label: "Bids / Proposals",
      description: "Structured offers with scope, pricing, proof, approvals, and client-facing delivery.",
    },
    orders_jobs: {
      label: "Orders / Jobs",
      description: "Live work records that operations, scheduling, fulfillment, and closeout can manage.",
    },
    payments: {
      label: "Payments",
      description: "Deposits, full payments, refunds, and reconciliation across online and offline methods.",
    },
    expenses: {
      label: "Expenses / Job Costs",
      description: "Costs tied to overhead, vendors, customers, and specific jobs so margin is visible.",
    },
    inventory_materials: {
      label: "Inventory / Materials",
      description: "Product stock, ingredients, truck stock, warehouse supply, and overage tracking.",
    },
    schedule: {
      label: "Scheduling / Availability",
      description: "When work can be booked, when crews can deliver, and what is already committed.",
    },
    proof: {
      label: "Proof / Photos / Documents",
      description: "Before-and-after photos, walkthrough evidence, signed documents, and job memory.",
    },
    reporting: {
      label: "Reporting / Guidance",
      description: "The teaching layer that turns activity into insight, accountability, and next-best action.",
    },
    automation: {
      label: "Automation / Integrations",
      description: "Rules, approvals, exports, and system hooks that remove repetitive operator work.",
    },
  };

  const FEATURE_CATALOG = {
    guided_onboarding: "Guided onboarding and setup",
    business_setup: "Business setup and branding",
    customer_crm: "Customer CRM and interaction history",
    orders: "Orders and job tracking",
    availability: "Availability and scheduling",
    expenses: "Expenses and cost tracking",
    manual_payments: "Manual and offline payment logging",
    hosted_checkout: "Hosted online checkout",
    walkthrough_bids: "Walkthrough bids and proposals",
    photo_proof: "Photo capture and proof records",
    custom_fields: "Custom fields and business-specific records",
    rate_sheets: "Rate sheets and advanced pricing",
    inventory_basic: "Basic inventory or material tracking",
    inventory_advanced: "Truck stock, warehouse, overage, and returns",
    reporting_basic: "Basic reporting and operator guidance",
    reporting_advanced: "Advanced reporting, margins, and team accountability",
    multi_operator: "Multi-operator depth",
    approvals: "Approval chains and change control",
    automations: "Automation and integrations",
    audit_log: "Audit trail and enterprise controls",
    multi_location: "Multi-location management",
    api_access: "API and external system integrations",
    white_glove: "Priority rollout and support",
  };

  const TIER_CAPABILITIES = {
    starter: {
      key: "starter",
      label: "Starter",
      promise: "Fix the basics and stop running on memory.",
      enabledFeatures: [
        "guided_onboarding",
        "business_setup",
        "customer_crm",
        "orders",
        "availability",
        "expenses",
        "manual_payments",
        "inventory_basic",
        "reporting_basic",
      ],
      advancedFeatures: [],
      priorityOutcomes: [
        "Stop losing customer and order history",
        "Create one source of truth for work and payments",
        "Give the operator a clean daily operating system",
      ],
    },
    growth: {
      key: "growth",
      label: "Growth",
      promise: "Run a busier business without chaos compounding.",
      enabledFeatures: [
        "guided_onboarding",
        "business_setup",
        "customer_crm",
        "orders",
        "availability",
        "expenses",
        "manual_payments",
        "inventory_basic",
        "reporting_basic",
        "hosted_checkout",
        "walkthrough_bids",
        "photo_proof",
        "rate_sheets",
        "reporting_advanced",
        "multi_operator",
      ],
      advancedFeatures: [
        "custom_fields",
        "inventory_advanced",
        "automations",
      ],
      priorityOutcomes: [
        "Standardize how work is sold and fulfilled",
        "See where jobs, money, and follow-up are stalling",
        "Give the team shared visibility instead of tribal knowledge",
      ],
    },
    enterprise: {
      key: "enterprise",
      label: "Enterprise",
      promise: "Give a larger operation advanced control without losing clarity.",
      enabledFeatures: [
        "guided_onboarding",
        "business_setup",
        "customer_crm",
        "orders",
        "availability",
        "expenses",
        "manual_payments",
        "inventory_basic",
        "reporting_basic",
        "hosted_checkout",
        "walkthrough_bids",
        "photo_proof",
        "rate_sheets",
        "reporting_advanced",
        "multi_operator",
        "custom_fields",
        "inventory_advanced",
        "automations",
        "approvals",
        "audit_log",
        "multi_location",
        "api_access",
        "white_glove",
      ],
      advancedFeatures: [],
      priorityOutcomes: [
        "Control complexity across teams, locations, and workflows",
        "Keep approvals, accountability, and data integrity tight",
        "Fit ProofLink into a broader operating stack when needed",
      ],
    },
  };

  const BUSINESS_PROFILES = {
    service_business: {
      key: "service_business",
      label: "Service Business",
      family: "field_service",
      workspaceMode: "walkthrough_to_job",
      pricingModel: "scope + labor + material allowance + optional upsells",
      inventoryModel: "truck stock + shop supply + leftovers + overage return",
      proofModel: "walkthrough notes, proposal, photos, and completion proof",
      bidProfile: "general_service",
      priorityViews: ["bids", "orders_jobs", "expenses", "payments", "crm"],
      hiddenByDefault: [],
      defaultFeatures: ["walkthrough_bids", "photo_proof", "manual_payments"],
      advancedFeatures: ["rate_sheets", "custom_fields", "inventory_advanced"],
      operatorNeeds: [
        "Build scope, pricing, and follow-up without relying on memory",
        "Carry the customer record from first visit through payment",
        "Keep service proof, expenses, and real-world job notes tied together",
      ],
    },
    bakery: {
      key: "bakery",
      label: "Bakery / Food",
      family: "retail_production",
      workspaceMode: "catalog_and_orders",
      pricingModel: "item + quantity + batch economics",
      inventoryModel: "ingredients + prep + finished goods",
      proofModel: "order accuracy, production timing, and inventory reconciliation",
      bidProfile: null,
      priorityViews: ["orders_jobs", "inventory_materials", "payments", "crm"],
      hiddenByDefault: ["bids"],
      defaultFeatures: ["inventory_basic"],
      advancedFeatures: ["inventory_advanced", "reporting_advanced"],
      operatorNeeds: [
        "Track products, prep, orders, and pickup windows",
        "Understand ingredient cost and stock pressure",
        "See customer order history and repeat behavior",
      ],
    },
    pressure_washing: {
      key: "pressure_washing",
      label: "Pressure Washing",
      family: "field_service",
      workspaceMode: "walkthrough_to_job",
      pricingModel: "scope + surface + access + optional upsells",
      inventoryModel: "truck stock + chemicals + reusable equipment + overage return",
      proofModel: "walkthrough photos, proposal, before/after proof, and client approval",
      bidProfile: "pressure_washing",
      priorityViews: ["bids", "orders_jobs", "proof", "expenses", "payments"],
      hiddenByDefault: ["inventory_materials"],
      defaultFeatures: ["walkthrough_bids", "photo_proof", "manual_payments"],
      advancedFeatures: ["rate_sheets", "inventory_advanced", "custom_fields"],
      operatorNeeds: [
        "Build a bid on site without leaving the phone",
        "Track chemicals, access conditions, and upsells",
        "Carry proof from walkthrough through completion",
      ],
    },
    contractor: {
      key: "contractor",
      label: "Contractor / Remodeling",
      family: "project_trade",
      workspaceMode: "estimate_to_project",
      pricingModel: "base scope + allowances + alternates + change control",
      inventoryModel: "ordered materials + reserved stock + leftovers + returns",
      proofModel: "site photos, scope detail, allowances, selections, and change approvals",
      bidProfile: "contractor_remodeling",
      priorityViews: ["bids", "orders_jobs", "expenses", "proof", "payments"],
      hiddenByDefault: [],
      defaultFeatures: ["walkthrough_bids", "photo_proof", "manual_payments"],
      advancedFeatures: ["rate_sheets", "inventory_advanced", "approvals", "custom_fields"],
      operatorNeeds: [
        "Price projects with discipline instead of loose notes",
        "Control hidden conditions and selection allowances",
        "Tie materials and costs back to the job margin",
      ],
    },
    lawn_care: {
      key: "lawn_care",
      label: "Lawn Care",
      family: "recurring_field_service",
      workspaceMode: "route_and_recurring_work",
      pricingModel: "recurring visit + property size + add-on treatments",
      inventoryModel: "truck consumables + seasonal supply + route equipment",
      proofModel: "service logs, property notes, and before/after exceptions",
      bidProfile: "general_service",
      priorityViews: ["orders_jobs", "schedule", "crm", "payments"],
      hiddenByDefault: ["inventory_materials"],
      defaultFeatures: ["manual_payments"],
      advancedFeatures: ["photo_proof", "custom_fields", "inventory_advanced"],
      operatorNeeds: [
        "Manage recurring service cleanly",
        "Track property-specific notes and seasonal changes",
        "Keep payment and schedule visibility simple",
      ],
    },
    cleaning: {
      key: "cleaning",
      label: "Cleaning",
      family: "field_service",
      workspaceMode: "quote_or_route",
      pricingModel: "flat rate + frequency + site conditions + extras",
      inventoryModel: "consumables + equipment + supply restock",
      proofModel: "scope confirmation, photos when needed, and completion notes",
      bidProfile: "general_service",
      priorityViews: ["orders_jobs", "crm", "payments", "schedule"],
      hiddenByDefault: [],
      defaultFeatures: ["manual_payments"],
      advancedFeatures: ["walkthrough_bids", "photo_proof", "custom_fields"],
      operatorNeeds: [
        "Handle recurring and one-time work in one system",
        "Keep scope and extras clear before disputes happen",
        "Make payment follow-up easy for the office",
      ],
    },
    photography: {
      key: "photography",
      label: "Photography",
      family: "creative_service",
      workspaceMode: "booking_and_delivery",
      pricingModel: "package + session + add-ons + usage rights",
      inventoryModel: "gear availability + deliverables, not stock-heavy inventory",
      proofModel: "contracts, session details, shot lists, and delivery records",
      bidProfile: null,
      priorityViews: ["crm", "orders_jobs", "payments", "schedule"],
      hiddenByDefault: ["inventory_materials"],
      defaultFeatures: ["manual_payments"],
      advancedFeatures: ["custom_fields", "approvals"],
      operatorNeeds: [
        "Track bookings, deliverables, and payment milestones",
        "Keep session details organized without admin drag",
        "Store proof around scope, timing, and delivery",
      ],
    },
    pet_services: {
      key: "pet_services",
      label: "Pet Services",
      family: "appointment_service",
      workspaceMode: "booking_and_repeat_clients",
      pricingModel: "service + duration + pet profile + add-ons",
      inventoryModel: "light consumables and appointment supplies",
      proofModel: "care notes, pet profile, waivers, and visit history",
      bidProfile: null,
      priorityViews: ["crm", "orders_jobs", "schedule", "payments"],
      hiddenByDefault: ["inventory_materials", "bids"],
      defaultFeatures: ["manual_payments"],
      advancedFeatures: ["custom_fields", "photo_proof"],
      operatorNeeds: [
        "Keep pet-specific notes tied to the customer record",
        "Track repeat visits and service preferences",
        "Reduce missed details during handoffs",
      ],
    },
    events: {
      key: "events",
      label: "Events",
      family: "event_service",
      workspaceMode: "proposal_to_execution",
      pricingModel: "package + custom add-ons + event timeline",
      inventoryModel: "rental items, staff planning, and event materials",
      proofModel: "proposal, contract, run-of-show, and post-event reconciliation",
      bidProfile: null,
      priorityViews: ["bids", "orders_jobs", "payments", "crm"],
      hiddenByDefault: [],
      defaultFeatures: ["manual_payments"],
      advancedFeatures: ["custom_fields", "approvals", "reporting_advanced"],
      operatorNeeds: [
        "Move from quote to booked event cleanly",
        "Track timeline, inclusions, and client approvals",
        "Keep deposits and balance due visible",
      ],
    },
    handyman: {
      key: "handyman",
      label: "Handyman",
      family: "field_service",
      workspaceMode: "walkthrough_to_job",
      pricingModel: "scope + labor + material allowance",
      inventoryModel: "truck stock + purchased materials + leftover return",
      proofModel: "walkthrough photos, task list, and completion proof",
      bidProfile: "general_service",
      priorityViews: ["bids", "orders_jobs", "expenses", "payments"],
      hiddenByDefault: [],
      defaultFeatures: ["walkthrough_bids", "manual_payments"],
      advancedFeatures: ["photo_proof", "rate_sheets", "inventory_advanced"],
      operatorNeeds: [
        "Document a punch list quickly on site",
        "Price labor and materials without forgetting details",
        "Carry the bid forward into live tracked work",
      ],
    },
    hvac: {
      key: "hvac",
      label: "HVAC",
      family: "field_service",
      workspaceMode: "diagnostic_to_job",
      pricingModel: "diagnostic + repair scope + equipment/parts allowance",
      inventoryModel: "truck stock + ordered parts + warranty returns",
      proofModel: "equipment findings, photos, proposal, and completion notes",
      bidProfile: "hvac",
      priorityViews: ["bids", "orders_jobs", "inventory_materials", "payments"],
      hiddenByDefault: [],
      defaultFeatures: ["walkthrough_bids", "photo_proof", "manual_payments"],
      advancedFeatures: ["rate_sheets", "inventory_advanced", "custom_fields"],
      operatorNeeds: [
        "Capture equipment-specific facts during the visit",
        "Quote repairs or replacements professionally",
        "Track parts, labor, and follow-up cleanly",
      ],
    },
    plumbing: {
      key: "plumbing",
      label: "Plumbing",
      family: "field_service",
      workspaceMode: "walkthrough_to_job",
      pricingModel: "repair scope + fixture/material allowance + restoration extras",
      inventoryModel: "truck stock + fittings + purchased fixtures + leftover return",
      proofModel: "visible conditions, repair scope, and completion proof",
      bidProfile: "plumbing",
      priorityViews: ["bids", "orders_jobs", "expenses", "payments"],
      hiddenByDefault: [],
      defaultFeatures: ["walkthrough_bids", "photo_proof", "manual_payments"],
      advancedFeatures: ["rate_sheets", "inventory_advanced", "custom_fields"],
      operatorNeeds: [
        "Record the real condition before opening walls or fixtures",
        "Separate the repair from optional restoration",
        "Track material usage and leftovers against the job",
      ],
    },
    hydrovac: {
      label: 'Hydrovac / Vactor',
      family: 'field_service',
      bidProfile: 'contractor_remodeling',
      workspaceMode: 'job_execution',
      inventoryModel: 'truck_stock_and_disposal',
      priorityViews: ['jobs', 'orders', 'customers', 'equipment'],
      hiddenByDefault: ['products', 'plans'],
      defaultFeatures: ['online_payments', 'job_tracking', 'time_tracking', 'expense_tracking', 'inventory', 'equipment'],
      advancedFeatures: [],
    },
    property_maintenance: {
      key: "property_maintenance",
      label: "Property Maintenance",
      family: "mixed_scope_service",
      workspaceMode: "walkthrough_to_job",
      pricingModel: "task groups + recurring scope + variable site extras",
      inventoryModel: "truck stock + consumables + site leftovers + warehouse return",
      proofModel: "site photos, punch list, recurrence notes, and closeout proof",
      bidProfile: "property_maintenance",
      priorityViews: ["bids", "orders_jobs", "schedule", "expenses", "payments"],
      hiddenByDefault: [],
      defaultFeatures: ["walkthrough_bids", "photo_proof", "manual_payments"],
      advancedFeatures: ["custom_fields", "inventory_advanced", "reporting_advanced"],
      operatorNeeds: [
        "Handle mixed-scope sites without chaos",
        "Track recurring and one-off tasks in one record",
        "Keep materials, haul-off, and labor visible by property",
      ],
    },
    other: {
      key: "other",
      label: "Other",
      family: "general_business",
      workspaceMode: "guided_generalist",
      pricingModel: "depends on profile setup",
      inventoryModel: "depends on profile setup",
      proofModel: "depends on the business process being loaded",
      bidProfile: "general_service",
      priorityViews: ["crm", "orders_jobs", "payments", "reporting"],
      hiddenByDefault: [],
      defaultFeatures: [],
      advancedFeatures: ["custom_fields"],
      operatorNeeds: [
        "Start from a clean backbone instead of a bad fit",
        "Add the missing specificity through profile settings and custom fields",
        "Avoid locking the business into the wrong model too early",
      ],
    },
  };

  const BUSINESS_TYPE_ALIASES = {
    contractor_remodeling: "contractor",
    general_service: "service_business",
    service: "service_business",
    vactor: "hydrovac",
  };

  function dedupe(values) {
    return [...new Set((values || []).filter(Boolean))];
  }

  function sanitizeTier(value) {
    const key = String(value || "").trim().toLowerCase();
    return TIER_CAPABILITIES[key] ? key : "starter";
  }

  function sanitizeBusinessType(value) {
    const key = String(value || "").trim().toLowerCase();
    const aliased = BUSINESS_TYPE_ALIASES[key] || key;
    return BUSINESS_PROFILES[aliased] ? aliased : "other";
  }

  function getTierCapabilities(planKey) {
    return TIER_CAPABILITIES[sanitizeTier(planKey)];
  }

  function getBusinessProfile(businessType) {
    return BUSINESS_PROFILES[sanitizeBusinessType(businessType)];
  }

  function resolveBidProfileForBusinessType(businessType) {
    return getBusinessProfile(businessType).bidProfile || "general_service";
  }

  function isFeatureEnabled(planKey, businessType, featureKey) {
    const tier = getTierCapabilities(planKey);
    const business = getBusinessProfile(businessType);
    return dedupe([...tier.enabledFeatures, ...business.defaultFeatures]).includes(featureKey);
  }

  function resolveWorkspaceBlueprint(planKey, businessType) {
    const tier = getTierCapabilities(planKey);
    const business = getBusinessProfile(businessType);
    const enabledFeatures = dedupe([...tier.enabledFeatures, ...business.defaultFeatures]);
    const deferredFeatures = dedupe(
      [...tier.advancedFeatures, ...business.advancedFeatures].filter((featureKey) => !enabledFeatures.includes(featureKey))
    );

    return {
      tier,
      business,
      enabledFeatures,
      deferredFeatures,
      priorityViews: business.priorityViews || [],
      hiddenByDefault: business.hiddenByDefault || [],
      recommendedModules: dedupe([
        "crm",
        "orders_jobs",
        "payments",
        ...business.priorityViews,
      ]),
      bidProfile: resolveBidProfileForBusinessType(businessType),
    };
  }

  window.PROOFLINK_WORKSPACE_ARCHITECTURE = {
    TIER_ORDER,
    CORE_MODULES,
    FEATURE_CATALOG,
    TIER_CAPABILITIES,
    BUSINESS_PROFILES,
    BUSINESS_TYPE_ALIASES,
    sanitizeTier,
    sanitizeBusinessType,
    getTierCapabilities,
    getBusinessProfile,
    resolveBidProfileForBusinessType,
    isFeatureEnabled,
    resolveWorkspaceBlueprint,
  };
})();
