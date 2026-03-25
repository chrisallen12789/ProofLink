"use strict";

const path = require("path");

describe("netlify/functions/utils/auth-links", () => {
  const modulePath = path.resolve(process.cwd(), "netlify/functions/utils/auth-links.js");

  test("buildPasswordSetupUrl requests a recovery link", async () => {
    const { buildPasswordSetupUrl } = require(modulePath);
    const generateLink = vi.fn(async () => ({
      data: { properties: { action_link: "https://example.com/recovery" } },
      error: null,
    }));
    const supabase = { auth: { admin: { generateLink } } };

    const result = await buildPasswordSetupUrl(supabase, "owner@example.com", "https://prooflink.co/operator/");

    expect(result).toBe("https://example.com/recovery");
    expect(generateLink).toHaveBeenCalledWith({
      type: "recovery",
      email: "owner@example.com",
      options: { redirectTo: "https://prooflink.co/operator/" },
    });
  });
});
