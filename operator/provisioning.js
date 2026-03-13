// operator/provisioning.js
//
// Thin runtime config injector for provisioning.html.
// Include this BEFORE provisioning.html's closing </body> when bundling,
// OR reference it as a separate script if your build process supports it.
//
// It reads Netlify environment variables that are exposed at build time
// and attaches them to window so the HTML can use them.
//
// If you are using a vanilla Netlify deploy (no build step),
// set these directly in the HTML <script> block inside provisioning.html.

(function () {
  // These variables must be set in your Netlify environment:
  //   SUPABASE_URL
  //   SUPABASE_ANON_KEY   (the public anon key — safe to expose in browser)
  //
  // Netlify injects NEXT_PUBLIC_ or plain env vars depending on your config.
  // For plain static sites, replace the values below with your project values,
  // or use a build plugin to inject them.

  // ── Detect build-time injection ──────────────────────────────────────────
  // If your build system (e.g. netlify-plugin-inline-env) has already set
  // window.__SUPABASE_URL__, this file is a no-op.
  if (window.__SUPABASE_URL__ && window.__SUPABASE_ANON_KEY__) return;

  // ── Fallback: set from meta tags (optional pattern) ──────────────────────
  // You can add <meta name="supabase-url" content="..."> to provisioning.html
  // and this script will pick them up.
  const urlMeta = document.querySelector('meta[name="supabase-url"]');
  const keyMeta = document.querySelector('meta[name="supabase-anon-key"]');

  if (urlMeta) window.__SUPABASE_URL__      = urlMeta.getAttribute('content');
  if (keyMeta) window.__SUPABASE_ANON_KEY__ = keyMeta.getAttribute('content');

  // ── Final fallback: warn in console ───────────────────────────────────────
  if (!window.__SUPABASE_URL__) {
    console.warn(
      '[ProofLink] window.__SUPABASE_URL__ is not set. ' +
      'Set SUPABASE_URL in Netlify environment variables and expose it to ' +
      'the browser, or hard-code it in provisioning.html for local testing.'
    );
  }
})();
