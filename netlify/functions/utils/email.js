// netlify/functions/utils/email.js
// Resend-powered email helper.
// Set RESEND_API_KEY and FROM_EMAIL in your Netlify environment variables.
// FROM_EMAIL should be a domain you've verified in Resend, e.g. hello@prooflink.app
//
// Usage:
//   const { sendEmail, templates } = require('./utils/email');
//   await sendEmail(templates.submitted({ owner_name, business_name, owner_email }));

const RESEND_API_URL = 'https://api.resend.com/emails';

const FROM     = process.env.FROM_EMAIL    || 'ProofLink <hello@prooflink.app>';
const REPLY_TO = process.env.REPLY_TO_EMAIL || 'hello@prooflink.app';
const SITE_URL = process.env.SITE_URL       || 'https://prooflink.app';

// ── Send ──────────────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — email not sent:', subject);
    return { skipped: true };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({
        from    : FROM,
        to      : Array.isArray(to) ? to : [to],
        subject,
        html,
        reply_to: replyTo || REPLY_TO,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[email] Resend error:', data);
      return { error: data };
    }

    console.log('[email] Sent:', subject, '→', to);
    return { id: data.id };
  } catch (err) {
    console.error('[email] Network error:', err.message);
    return { error: err.message };
  }
}

// ── Shared layout ─────────────────────────────────────────────────────────────

function layout(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>ProofLink</title>
</head>
<body style="margin:0;padding:0;background:#f5f2eb;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2eb;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Logo -->
        <tr><td style="padding-bottom:28px;">
          <a href="${SITE_URL}" style="text-decoration:none;">
            <span style="font-size:22px;font-weight:800;color:#0d0d0d;letter-spacing:-0.03em;">Proof<span style="color:#c84b2f;">Link</span></span>
          </a>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#ffffff;border:1px solid #d9d4c9;border-radius:8px;padding:36px 40px;">
          ${content}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding-top:24px;text-align:center;font-size:12px;color:#9c9490;">
          ProofLink &nbsp;·&nbsp; <a href="${SITE_URL}" style="color:#9c9490;">prooflink.app</a>
          <br/>You received this because you applied to join ProofLink.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function heading(text) {
  return `<h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#0d0d0d;letter-spacing:-0.03em;line-height:1.15;">${text}</h1>`;
}

function subheading(text) {
  return `<p style="margin:0 0 24px;font-size:15px;color:#6b6560;line-height:1.6;">${text}</p>`;
}

function divider() {
  return `<hr style="border:none;border-top:1px solid #d9d4c9;margin:28px 0;"/>`;
}

function pill(text, color = '#c84b2f') {
  return `<span style="display:inline-block;background:${color}10;border:1px solid ${color}30;color:${color};border-radius:20px;padding:3px 12px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">${text}</span>`;
}

function infoRow(label, value) {
  return `<tr>
    <td style="padding:7px 0;font-size:13px;color:#9c9490;width:130px;vertical-align:top;">${label}</td>
    <td style="padding:7px 0;font-size:13px;color:#0d0d0d;font-weight:500;vertical-align:top;">${value}</td>
  </tr>`;
}

function ctaButton(text, href) {
  return `<a href="${href}" style="display:inline-block;background:#c84b2f;color:#ffffff;padding:13px 28px;border-radius:4px;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.01em;">${text}</a>`;
}

// ── Templates ─────────────────────────────────────────────────────────────────

const templates = {

  // ── 1. Sent to applicant immediately on submit
  submitted({ owner_name, business_name, owner_email, business_slug }) {
    return {
      to     : owner_email,
      subject: `We got your application — ${business_name}`,
      html   : layout(`
        ${pill('Application received', '#2e7d32')}
        <br/><br/>
        ${heading(`Hey ${owner_name}, you're in the queue.`)}
        ${subheading('Thanks for applying to ProofLink. We review every application personally and will be in touch soon.')}
        <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
          ${infoRow('Business', business_name)}
          ${infoRow('Store URL', `prooflink.app/${business_slug || '...'}`)}
          ${infoRow('Email', owner_email)}
          ${infoRow('Review time', 'Within 24 hours')}
        </table>
        ${divider()}
        <p style="font-size:14px;color:#6b6560;margin:0 0 20px;line-height:1.7;">
          While you wait, you don't need to do anything else. When your application is approved
          we'll send you another email with a link to set up your store.
        </p>
        <p style="font-size:13px;color:#9c9490;margin:0;">Questions? Reply to this email and we'll get back to you.</p>
      `),
    };
  },

  // ── 2. Sent to applicant when operator approves
  approved({ owner_name, business_name, owner_email }) {
    return {
      to     : owner_email,
      subject: `Your ProofLink application is approved — ${business_name}`,
      html   : layout(`
        ${pill('Approved ✓', '#2e7d32')}
        <br/><br/>
        ${heading(`Great news, ${owner_name}!`)}
        ${subheading('Your application has been approved. We\'re setting up your ProofLink store right now.')}
        <p style="font-size:14px;color:#6b6560;margin:0 0 28px;line-height:1.7;">
          You'll receive one more email shortly with your login link so you can
          add your products, connect payments, and go live.
        </p>
        ${divider()}
        <p style="font-size:13px;color:#9c9490;margin:0;">
          <strong style="color:#0d0d0d;">What's next:</strong><br/>
          1. Watch for your setup email (usually arrives within minutes)<br/>
          2. Set your password and log in to your dashboard<br/>
          3. Add your products and connect Stripe to get paid
        </p>
      `),
    };
  },

  // ── 3. Sent to business owner when tenant is provisioned (with login link)
  provisioned({ owner_name, business_name, owner_email, login_url, store_slug }) {
    const loginHref = login_url || `${SITE_URL}/operator/`;
    return {
      to     : owner_email,
      subject: `Your ProofLink store is ready — ${business_name}`,
      html   : layout(`
        ${pill('Store ready 🎉', '#c84b2f')}
        <br/><br/>
        ${heading(`Your store is live, ${owner_name}.`)}
        ${subheading(`${business_name} is ready on ProofLink. Click below to set your password and start building.`)}
        <div style="text-align:center;margin:32px 0;">
          ${ctaButton('Set Up My Store →', loginHref)}
        </div>
        <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:8px;">
          ${store_slug ? infoRow('Your store URL', `prooflink.app/${store_slug}`) : ''}
          ${infoRow('Dashboard', `${SITE_URL}/operator/`)}
        </table>
        ${divider()}
        <p style="font-size:13px;color:#9c9490;margin:0;line-height:1.7;">
          <strong style="color:#0d0d0d;">Quick start checklist:</strong><br/>
          ☐ Set your password via the link above<br/>
          ☐ Add your first product or service<br/>
          ☐ Connect your Stripe account for direct payouts<br/>
          ☐ Share your storefront link with customers
        </p>
      `),
    };
  },

  // ── 4. Sent to applicant when rejected
  rejected({ owner_name, business_name, owner_email, rejection_reason }) {
    return {
      to     : owner_email,
      subject: `Update on your ProofLink application — ${business_name}`,
      html   : layout(`
        ${heading(`Hi ${owner_name},`)}
        ${subheading(`Thanks for your interest in joining ProofLink.`)}
        <p style="font-size:14px;color:#6b6560;margin:0 0 20px;line-height:1.7;">
          After reviewing your application for <strong style="color:#0d0d0d;">${business_name}</strong>,
          we're unable to approve it at this time.
        </p>
        ${rejection_reason ? `
        <div style="background:#f5f2eb;border:1px solid #d9d4c9;border-radius:4px;padding:16px 18px;margin-bottom:24px;">
          <p style="font-size:13px;color:#6b6560;margin:0 0 4px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Note from our team</p>
          <p style="font-size:14px;color:#0d0d0d;margin:0;line-height:1.6;">${rejection_reason}</p>
        </div>` : ''}
        ${divider()}
        <p style="font-size:13px;color:#9c9490;margin:0;line-height:1.7;">
          If you believe this is an error or have questions, simply reply to this email.
          We're happy to reconsider when circumstances change.
        </p>
      `),
    };
  },

  // ── 5. Internal: notify platform operator of new submission
  operatorNewRequest({ operator_email, owner_name, business_name, business_type, city_state, owner_email }) {
    const reviewUrl = `${SITE_URL}/operator/provisioning.html`;
    return {
      to     : operator_email,
      subject: `New ProofLink application — ${business_name}`,
      html   : layout(`
        ${pill('New application', '#d4a843')}
        <br/><br/>
        ${heading('New business application')}
        ${subheading('A business just applied to join ProofLink. Review it in your dashboard.')}
        <table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:28px;">
          ${infoRow('Business', business_name)}
          ${infoRow('Owner', owner_name)}
          ${infoRow('Email', owner_email)}
          ${infoRow('Type', business_type || '—')}
          ${infoRow('Location', city_state || '—')}
        </table>
        <div style="text-align:left;">
          ${ctaButton('Review Application →', reviewUrl)}
        </div>
      `),
    };
  },
};

module.exports = { sendEmail, templates };
