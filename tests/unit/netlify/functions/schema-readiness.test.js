"use strict";

const {
  extractErrorCode,
  extractErrorMessage,
  isMissingSchemaError,
} = require("../../../../netlify/functions/utils/schema-readiness.js");

describe("netlify/functions/utils/schema-readiness", () => {
  test("extracts error code and message from common shapes", () => {
    expect(extractErrorCode({ code: "PGRST205" })).toBe("PGRST205");
    expect(extractErrorMessage({ error: { message: "missing table" } })).toBe("missing table");
  });

  test("classifies missing schema conditions consistently", () => {
    expect(isMissingSchemaError({ code: "42P01", message: 'relation "public.orders" does not exist' })).toBe(true);
    expect(isMissingSchemaError({ message: "Could not find the table 'public.leads' in the schema cache" })).toBe(true);
    expect(isMissingSchemaError(
      { message: "function public.generate_due_service_plans does not exist" },
      ["function public.generate_due_service_plans"]
    )).toBe(true);
    expect(isMissingSchemaError({ message: "timeout" })).toBe(false);
  });
});
