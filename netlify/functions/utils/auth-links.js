"use strict";

async function buildMagicLinkUrl(supabase, email, redirectTo) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (error) throw error;
  return data?.properties?.action_link || redirectTo;
}

async function buildPasswordSetupUrl(supabase, email, redirectTo) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  if (error) throw error;
  return data?.properties?.action_link || redirectTo;
}

module.exports = {
  buildMagicLinkUrl,
  buildPasswordSetupUrl,
};
