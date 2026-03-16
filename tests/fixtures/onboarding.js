"use strict";

const ONBOARDING_FIXTURES = {
  approved: {
    business_name: "pltest-approved-onboarding",
    business_slug: "pltest-approved-onboarding",
    owner_name: "PL Test Approved Owner",
    owner_email: "pltest.approved.owner@example.com",
    business_type: "contractor",
    city_state: "Fenton, MI",
    seed_template_key: "contractor",
    status: "approved",
  },
  submitted: {
    business_name: "pltest-submitted-onboarding",
    business_slug: "pltest-submitted-onboarding",
    owner_name: "PL Test Submitted Owner",
    owner_email: "pltest.submitted.owner@example.com",
    business_type: "bakery",
    city_state: "Ann Arbor, MI",
    seed_template_key: "bakery",
    status: "submitted",
  },
};

module.exports = { ONBOARDING_FIXTURES };
