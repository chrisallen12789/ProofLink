#!/usr/bin/env node
// scripts/test-email.js
// Usage: RESEND_API_KEY=re_xxx FROM_EMAIL="ProofLink <support@prooflink.co>" node scripts/test-email.js
// Sends a real test email through Resend to verify the API key and sender are working.

'use strict';

const apiKey   = process.env.RESEND_API_KEY;
const from     = process.env.FROM_EMAIL || 'ProofLink <hello@prooflink.co>';
const to       = process.env.TEST_TO    || process.env.OPERATOR_ALERT_EMAIL || 'christopher@prooflink.co';

if (!apiKey) {
  console.error('ERROR: RESEND_API_KEY is not set.\n');
  console.error('Run as:');
  console.error('  RESEND_API_KEY=re_xxx node scripts/test-email.js\n');
  process.exit(1);
}

async function run() {
  console.log(`Sending test email via Resend...`);
  console.log(`  From : ${from}`);
  console.log(`  To   : ${to}`);

  const res = await fetch('https://api.resend.com/emails', {
    method : 'POST',
    headers: {
      Authorization  : `Bearer ${apiKey}`,
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify({
      from,
      to    : [to],
      subject: 'ProofLink — Email system test',
      html  : `
        <div style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:32px;border:1px solid #E2DDD6;border-radius:10px;background:#fff;">
          <h2 style="margin:0 0 12px;color:#1A1A1A;">Email system working ✓</h2>
          <p style="color:#444;margin:0 0 8px;">This is a live test from your ProofLink Resend configuration.</p>
          <p style="color:#444;margin:0;">If you received this, your <code>RESEND_API_KEY</code> and <code>FROM_EMAIL</code> are correctly set in Netlify and emails will send on signup.</p>
          <hr style="margin:24px 0;border:none;border-top:1px solid #E2DDD6;" />
          <p style="color:#9C9490;font-size:12px;margin:0;">Sent at ${new Date().toISOString()}</p>
        </div>
      `,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('\nRESEND ERROR:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`\nSUCCESS — Email sent!`);
  console.log(`  Resend ID : ${data.id}`);
  console.log(`\nCheck ${to} for the test message.`);
}

run().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
