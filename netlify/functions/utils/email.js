// netlify/functions/utils/email.js
// Resend-powered email utility for ProofLink.
// ENV: RESEND_API_KEY, FROM_EMAIL, REPLY_TO_EMAIL, SITE_URL

'use strict';

const RESEND_API_URL = 'https://api.resend.com/emails';
const FROM     = process.env.FROM_EMAIL     || 'ProofLink <hello@prooflink.co>';
const REPLY_TO = process.env.REPLY_TO_EMAIL || 'hello@prooflink.co';
const SITE_URL = (process.env.SITE_URL      || 'https://prooflink.co').replace(/\/$/, '');

async function sendEmail({ to, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn('[email] RESEND_API_KEY not set — skipping:', subject); return { skipped: true }; }
  try {
    const res = await fetch(RESEND_API_URL, {
      method : 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html, reply_to: replyTo || REPLY_TO }),
    });
    const data = await res.json();
    if (!res.ok) { console.error('[email] Resend error:', data); return { error: data }; }
    console.log('[email] Sent:', subject, '→', to);
    return { id: data.id };
  } catch (err) {
    console.error('[email] Network error:', err.message);
    return { error: err.message };
  }
}

const T = {
  bg:'#F4F1EC',card:'#FFFFFF',border:'#E2DDD6',ink:'#1A1A1A',muted:'#6B6560',hint:'#9C9490',
  red:'#C84B2F',redLight:'#FAF0ED',redBorder:'#F0C4B8',
  green:'#2E7D32',greenLt:'#F0F7F0',greenBd:'#B8D9BA',
  amber:'#B45309',amberLt:'#FFFBF0',amberBd:'#F0D9A0',
};

function layout(content, { preheader='' }={}) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>ProofLink</title>${preheader?`<div style="display:none;max-height:0;overflow:hidden;">${preheader}&nbsp;</div>`:''}</head><body style="margin:0;padding:0;background:${T.bg};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:${T.bg};padding:48px 20px;"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;"><tr><td style="padding-bottom:32px;"><a href="${SITE_URL}" style="text-decoration:none;"><span style="font-size:20px;font-weight:800;color:${T.ink};letter-spacing:-0.04em;">Proof<span style="color:${T.red};">Link</span></span></a></td></tr><tr><td style="background:${T.card};border:1px solid ${T.border};border-radius:10px;overflow:hidden;">${content}</td></tr><tr><td style="padding-top:28px;text-align:center;"><p style="margin:0 0 6px;font-size:12px;color:${T.hint};">ProofLink &nbsp;·&nbsp; <a href="${SITE_URL}" style="color:${T.hint};text-decoration:none;">${SITE_URL.replace('https://','')}</a></p><p style="margin:0;font-size:11px;color:${T.hint};">You received this because you applied to join ProofLink.</p></td></tr></table></td></tr></table></body></html>`;
}

function accentBar(color=T.red){return `<tr><td style="background:${color};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>`;}
function bodyWrap(c){return `<tr><td style="padding:40px 44px;">${c}</td></tr>`;}
function h1(t){return `<h1 style="margin:0 0 6px;font-size:28px;font-weight:800;color:${T.ink};letter-spacing:-0.04em;line-height:1.15;">${t}</h1>`;}
function sub(t){return `<p style="margin:0 0 28px;font-size:15px;color:${T.muted};line-height:1.65;">${t}</p>`;}
function p(t){return `<p style="margin:0 0 16px;font-size:14px;color:${T.muted};line-height:1.75;">${t}</p>`;}
function divider(){return `<div style="border-top:1px solid ${T.border};margin:32px 0;"></div>`;}
function badge(text,bg,color,bd){return `<span style="display:inline-block;background:${bg};border:1px solid ${bd};color:${color};border-radius:20px;padding:4px 14px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${text}</span>`;}
function cta(text,href,bg=T.red){return `<a href="${href}" style="display:inline-block;background:${bg};color:#ffffff;padding:14px 32px;border-radius:5px;font-size:15px;font-weight:700;text-decoration:none;">${text}</a>`;}
function callout(text,bg,bd,tc){return `<div style="background:${bg};border:1px solid ${bd};border-radius:6px;padding:16px 18px;margin:0 0 24px;"><p style="margin:0;font-size:14px;color:${tc};line-height:1.7;">${text}</p></div>`;}
function infoBox(rows){return `<table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ${T.border};border-radius:6px;overflow:hidden;margin:0 0 28px;">${rows.map(([l,v],i)=>`<tr><td style="padding:11px 16px;font-size:13px;color:${T.hint};width:120px;background:${i%2===0?T.bg:T.card};border-bottom:1px solid ${T.border};white-space:nowrap;">${l}</td><td style="padding:11px 16px;font-size:13px;color:${T.ink};font-weight:500;background:${i%2===0?T.bg:T.card};border-bottom:1px solid ${T.border};">${v}</td></tr>`).join('')}</table>`;}

// ── Onboarding asset checklists by business type ──────────────────────────────

const CHECKLIST_BY_TYPE = {
  default:{
    info:[
      {label:'Business tagline',key:'tagline',hint:'One sentence that describes what you do.'},
      {label:'Phone number',key:'phone',hint:'Displayed on your storefront for customer contact.'},
      {label:'City & state',key:'city_state',hint:'Where you are based. E.g. "Detroit, MI"'},
      {label:'Accent color',key:'accent_color',hint:'A hex color for your brand. E.g. #C84B2F'},
    ],
    images:[
      {slot:'logo',label:'Business logo',hint:'Square or horizontal PNG. Transparent background preferred. Min 400×400px.'},
      {slot:'hero',label:'Hero image',hint:'Your best work photo. Landscape, minimum 1200×600px.'},
    ],
  },
  pressure_washing:{
    info:[
      {label:'Tagline',key:'tagline',hint:'E.g. "Professional exterior cleaning for homes and businesses."'},
      {label:'Service area',key:'city_state',hint:'City or region you serve.'},
      {label:'Phone number',key:'phone',hint:'Customers will call or text this number.'},
      {label:'Accent color',key:'accent_color',hint:'Blues and greens work well for exterior cleaning.'},
    ],
    images:[
      {slot:'logo',label:'Business logo',hint:'PNG, transparent preferred. Min 400×400px.'},
      {slot:'hero',label:'Hero / before-after photo',hint:'Dramatic before/after or clean result. Landscape 1200×600px min.'},
      {slot:'truck',label:'Truck / rig photo',hint:'Photo of your vehicle or equipment. Builds trust.'},
      {slot:'work_1',label:'Work sample #1',hint:'Completed job — driveway, house wash, deck, etc.'},
      {slot:'work_2',label:'Work sample #2',hint:'Second completed job photo.'},
    ],
  },
  cleaning:{
    info:[
      {label:'Tagline',key:'tagline',hint:'E.g. "Reliable recurring cleaning for homes and offices."'},
      {label:'Service area',key:'city_state',hint:'City or region you serve.'},
      {label:'Phone number',key:'phone',hint:'Customers will call or text this number.'},
      {label:'Accent color',key:'accent_color',hint:'Clean whites, light blues, or greens work well.'},
    ],
    images:[
      {slot:'logo',label:'Business logo',hint:'PNG, transparent preferred.'},
      {slot:'hero',label:'Hero image',hint:'Clean, bright interior or team photo. 1200×600px min.'},
      {slot:'team',label:'Team / staff photo',hint:'Photo of you or your team. Builds trust.'},
      {slot:'work_1',label:'Clean result #1',hint:'Spotless kitchen, bathroom, or living space.'},
      {slot:'work_2',label:'Clean result #2',hint:'Second clean result photo.'},
    ],
  },
  lawn_care:{
    info:[
      {label:'Tagline',key:'tagline',hint:'E.g. "Professional lawn care and landscaping year-round."'},
      {label:'Service area',key:'city_state',hint:'City or region you serve.'},
      {label:'Phone number',key:'phone',hint:'Customers will call or text this number.'},
      {label:'Accent color',key:'accent_color',hint:'Greens and earth tones work well.'},
    ],
    images:[
      {slot:'logo',label:'Business logo',hint:'PNG, transparent preferred.'},
      {slot:'hero',label:'Hero image',hint:'Beautifully maintained lawn or landscape. 1200×600px min.'},
      {slot:'equipment',label:'Equipment photo',hint:'Mower, trailer, or truck.'},
      {slot:'work_1',label:'Job result #1',hint:'Freshly mowed or landscaped property.'},
      {slot:'work_2',label:'Job result #2',hint:'Second completed job photo.'},
    ],
  },
  handyman:{
    info:[
      {label:'Tagline',key:'tagline',hint:'E.g. "Reliable repairs and installations for your home."'},
      {label:'Service area',key:'city_state',hint:'City or region you serve.'},
      {label:'Phone number',key:'phone',hint:'Customers will call or text this number.'},
      {label:'Accent color',key:'accent_color',hint:'Blues, grays, and earth tones are common in trades.'},
    ],
    images:[
      {slot:'logo',label:'Business logo',hint:'PNG, transparent preferred.'},
      {slot:'hero',label:'Hero image',hint:'Completed project or professional working photo. 1200×600px.'},
      {slot:'headshot',label:'Headshot / profile photo',hint:'Clear photo of you. Customers want to know who is coming to their home.'},
      {slot:'work_1',label:'Completed project #1',hint:'TV mount, shelf install, repair, or finished job.'},
      {slot:'work_2',label:'Completed project #2',hint:'Second completed job photo.'},
    ],
  },
  hvac:{
    info:[
      {label:'Tagline',key:'tagline',hint:'E.g. "HVAC service, repair, and installation you can count on."'},
      {label:'Service area',key:'city_state',hint:'City or region you serve.'},
      {label:'Phone number',key:'phone',hint:'Emergency calls come here — always answered.'},
      {label:'License number',key:'license_number',hint:'Contractor license number. Builds trust with homeowners.'},
      {label:'Accent color',key:'accent_color',hint:'Blues work well for HVAC.'},
    ],
    images:[
      {slot:'logo',label:'Business logo',hint:'PNG, transparent preferred.'},
      {slot:'hero',label:'Hero image',hint:'Technician working, van, or equipment. 1200×600px.'},
      {slot:'van',label:'Service van / truck',hint:'Photo of your branded vehicle.'},
      {slot:'work_1',label:'Job photo #1',hint:'Installed unit, completed repair, or service call.'},
    ],
  },
  plumbing:{
    info:[
      {label:'Tagline',key:'tagline',hint:'E.g. "Fast, reliable plumbing service for homes and businesses."'},
      {label:'Service area',key:'city_state',hint:'City or region you serve.'},
      {label:'Phone number',key:'phone',hint:'Emergency calls come here.'},
      {label:'License number',key:'license_number',hint:'Your plumbing license number.'},
      {label:'Accent color',key:'accent_color',hint:'Blues work well for plumbing.'},
    ],
    images:[
      {slot:'logo',label:'Business logo',hint:'PNG, transparent preferred.'},
      {slot:'hero',label:'Hero image',hint:'Technician, van, or completed job. 1200×600px.'},
      {slot:'van',label:'Service van / truck',hint:'Photo of your branded vehicle.'},
      {slot:'work_1',label:'Completed job #1',hint:'Finished installation, repair, or service.'},
    ],
  },
  photography:{
    info:[
      {label:'Tagline',key:'tagline',hint:'E.g. "Portrait and event photography that tells your story."'},
      {label:'City & state',key:'city_state',hint:'Where you are based and where you shoot.'},
      {label:'Phone / contact',key:'phone',hint:'How clients reach you to book.'},
      {label:'Instagram handle',key:'instagram',hint:'Your Instagram username (without @). Optional but builds credibility.'},
      {label:'Accent color',key:'accent_color',hint:'Brand color matching your portfolio aesthetic.'},
    ],
    images:[
      {slot:'logo',label:'Logo or wordmark',hint:'Photography brand logo. PNG, transparent preferred.'},
      {slot:'hero',label:'Hero / signature shot',hint:'Your absolute best image. First thing clients see. 1200×800px.'},
      {slot:'portfolio_1',label:'Portfolio image #1',hint:'Strong portfolio sample.'},
      {slot:'portfolio_2',label:'Portfolio image #2',hint:'Second sample, different from #1.'},
      {slot:'portfolio_3',label:'Portfolio image #3',hint:'Third sample.'},
      {slot:'headshot',label:'Photographer headshot',hint:'A photo of you. Clients connect with the person behind the lens.'},
    ],
  },
  pet_services:{
    info:[
      {label:'Tagline',key:'tagline',hint:'E.g. "Professional grooming and care for pets you love."'},
      {label:'Service area',key:'city_state',hint:'City or region you serve.'},
      {label:'Phone number',key:'phone',hint:'Pet parents want to be able to call quickly.'},
      {label:'Accent color',key:'accent_color',hint:'Bright, friendly colors work well for pet businesses.'},
    ],
    images:[
      {slot:'logo',label:'Business logo',hint:'PNG, transparent preferred.'},
      {slot:'hero',label:'Hero image',hint:'Happy pet or freshly groomed dog. 1200×600px.'},
      {slot:'facility',label:'Space / facility',hint:'Your grooming area, shop, or mobile setup.'},
      {slot:'work_1',label:'Happy pet #1',hint:'Groomed pet or happy customer photo.'},
      {slot:'work_2',label:'Happy pet #2',hint:'Second pet photo.'},
    ],
  },
  bakery:{
    info:[
      {label:'Tagline',key:'tagline',hint:'E.g. "Handcrafted cakes and pastries baked fresh to order."'},
      {label:'City & state',key:'city_state',hint:'Where you are located.'},
      {label:'Phone / contact',key:'phone',hint:'How customers place custom orders.'},
      {label:'Accent color',key:'accent_color',hint:'Warm tones work beautifully for bakeries.'},
    ],
    images:[
      {slot:'logo',label:'Bakery logo',hint:'PNG, transparent preferred.'},
      {slot:'hero',label:'Hero image',hint:'Your most beautiful creation. This sells the bakery. 1200×800px.'},
      {slot:'product_1',label:'Signature product #1',hint:'Close-up of a cake, cupcake, or pastry.'},
      {slot:'product_2',label:'Signature product #2',hint:'Second product close-up.'},
      {slot:'product_3',label:'Signature product #3',hint:'Third product or assortment flat lay.'},
    ],
  },
  events:{
    info:[
      {label:'Tagline',key:'tagline',hint:'E.g. "Full-service event planning and coordination."'},
      {label:'Service area',key:'city_state',hint:'City or region you serve.'},
      {label:'Phone / contact',key:'phone',hint:'Main contact for inquiries and bookings.'},
      {label:'Accent color',key:'accent_color',hint:'Brand color reflecting your event style.'},
    ],
    images:[
      {slot:'logo',label:'Business logo',hint:'PNG, transparent preferred.'},
      {slot:'hero',label:'Hero image',hint:'Stunning event setup — reception, styled table, or venue. 1200×800px.'},
      {slot:'event_1',label:'Event photo #1',hint:'Full room or venue setup you coordinated.'},
      {slot:'event_2',label:'Event photo #2',hint:'Detail shot — centerpiece, florals, lighting.'},
      {slot:'event_3',label:'Event photo #3',hint:'Third event or setup photo.'},
    ],
  },
  contractor:{
    info:[
      {label:'Tagline',key:'tagline',hint:'E.g. "Quality residential construction and renovation."'},
      {label:'Service area',key:'city_state',hint:'City or region you serve.'},
      {label:'Phone number',key:'phone',hint:'Main contact for estimates and jobs.'},
      {label:'License number',key:'license_number',hint:'Contractor license number. Builds trust with homeowners.'},
      {label:'Accent color',key:'accent_color',hint:'Blues, grays, and earth tones are standard in construction.'},
    ],
    images:[
      {slot:'logo',label:'Business logo',hint:'PNG, transparent preferred.'},
      {slot:'hero',label:'Hero image',hint:'Completed project exterior or interior. 1200×800px.'},
      {slot:'project_1',label:'Project #1',hint:'Completed deck, renovation, addition, or build.'},
      {slot:'project_2',label:'Project #2',hint:'Second completed project.'},
      {slot:'project_3',label:'Project #3',hint:'Before/after or third project.'},
    ],
  },
};

function getChecklist(businessType) {
  const key = String(businessType||'').toLowerCase().replace(/[\s\-]+/g,'_');
  return CHECKLIST_BY_TYPE[key] || CHECKLIST_BY_TYPE.default;
}

function buildChecklistSection(businessType, loginHref) {
  const cl = getChecklist(businessType);
  const uploadUrl = loginHref || `${SITE_URL}/operator/#setup`;

  const infoRows = cl.info.map(item=>`
    <tr><td style="padding:10px 0;border-bottom:1px solid ${T.border};vertical-align:top;">
      <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:${T.ink};">${item.label}</p>
      <p style="margin:0;font-size:13px;color:${T.hint};line-height:1.5;">${item.hint}</p>
    </td></tr>`).join('');

  const imgRows = cl.images.map(item=>`
    <tr><td style="padding:12px 0;border-bottom:1px solid ${T.border};vertical-align:top;">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="width:52px;vertical-align:top;padding-right:14px;">
          <div style="background:${T.bg};border:1px dashed ${T.border};border-radius:6px;width:44px;height:44px;text-align:center;line-height:44px;font-size:18px;">&#128247;</div>
        </td>
        <td>
          <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:${T.ink};">${item.label} <span style="font-size:11px;font-weight:400;color:${T.hint};background:${T.bg};border:1px solid ${T.border};border-radius:3px;padding:1px 6px;margin-left:4px;">slot: ${item.slot}</span></p>
          <p style="margin:0;font-size:13px;color:${T.hint};line-height:1.5;">${item.hint}</p>
        </td>
      </tr></table>
    </td></tr>`).join('');

  return `
    <div style="background:${T.bg};border:1px solid ${T.border};border-radius:8px;overflow:hidden;margin:0 0 28px;">
      <div style="padding:14px 20px;border-bottom:1px solid ${T.border};background:${T.card};">
        <p style="margin:0;font-size:12px;font-weight:700;color:${T.ink};letter-spacing:.05em;text-transform:uppercase;">Business information needed</p>
        <p style="margin:3px 0 0;font-size:12px;color:${T.hint};">Reply to this email with these details or update them in your dashboard.</p>
      </div>
      <table cellpadding="0" cellspacing="0" style="width:100%;padding:4px 20px 4px;">${infoRows}</table>
      <div style="padding:14px 20px;border-top:1px solid ${T.border};border-bottom:1px solid ${T.border};background:${T.card};margin-top:4px;">
        <p style="margin:0;font-size:12px;font-weight:700;color:${T.ink};letter-spacing:.05em;text-transform:uppercase;">Images & media needed</p>
        <p style="margin:3px 0 0;font-size:12px;color:${T.hint};">Upload in your dashboard under Settings → Branding. Each slot is labeled.</p>
      </div>
      <table cellpadding="0" cellspacing="0" style="width:100%;padding:4px 20px 4px;">${imgRows}</table>
      <div style="padding:14px 20px;border-top:1px solid ${T.border};">
        <p style="margin:0;font-size:12px;color:${T.hint};line-height:1.6;">
          <strong style="color:${T.ink};">Image tips:</strong> PNG or JPG under 2MB. Landscape for hero images, square for logos.
          Free compression: <a href="https://squoosh.app" style="color:${T.red};">squoosh.app</a>
        </p>
      </div>
    </div>
    <div style="text-align:center;margin:0 0 8px;">${cta('Upload images in dashboard →', uploadUrl)}</div>`;
}

// ── Templates ─────────────────────────────────────────────────────────────────

const templates = {

  submitted({ owner_name, business_name, owner_email, business_slug }) {
    return {
      to: owner_email,
      subject: `We received your application — ${business_name}`,
      html: layout(`<table width="100%" cellpadding="0" cellspacing="0">${accentBar(T.green)}${bodyWrap(`
        ${badge('Application received',T.greenLt,T.green,T.greenBd)}<br/><br/>
        ${h1(`Hey ${owner_name}, you're in the queue.`)}
        ${sub('Thanks for applying to ProofLink. We review every application and will be in touch within 24 hours.')}
        ${infoBox([['Business',business_name],['Store URL',`prooflink.co/${business_slug||'...'}`],['Email',owner_email],['Review time','Within 24 hours']])}
        ${divider()}
        ${p("You don't need to do anything else right now. When your application is approved we'll send you a link to set up your store.")}
        ${p(`<span style="color:${T.hint};">Questions? Just reply to this email.</span>`)}
      `)}</table>`, { preheader: `Your ProofLink application for ${business_name} is in review.` }),
    };
  },

  approved({ owner_name, business_name, owner_email }) {
    return {
      to: owner_email,
      subject: `Your application is approved — ${business_name}`,
      html: layout(`<table width="100%" cellpadding="0" cellspacing="0">${accentBar(T.green)}${bodyWrap(`
        ${badge('Approved ✓',T.greenLt,T.green,T.greenBd)}<br/><br/>
        ${h1(`Good news, ${owner_name}.`)}
        ${sub(`Your application for ${business_name} has been approved. We're setting up your store now.`)}
        ${callout(`<strong style="color:${T.ink};">What's next:</strong><br/>You'll receive one more email in the next few minutes with your login link to access your dashboard and go live.`,T.amberLt,T.amberBd,T.amber)}
        ${divider()}
        ${p(`<strong style="color:${T.ink};">Quick start once you're in:</strong><br/>1. Set your password and log in<br/>2. Add your products and services<br/>3. Connect Stripe to accept payments<br/>4. Share your storefront link`)}
      `)}</table>`, { preheader: `${business_name} has been approved on ProofLink.` }),
    };
  },

  provisioned({ owner_name, business_name, owner_email, login_url, store_slug, business_type }) {
    const loginHref = login_url || `${SITE_URL}/operator/`;
    return {
      to: owner_email,
      subject: `Your ProofLink store is ready — ${business_name}`,
      html: layout(`<table width="100%" cellpadding="0" cellspacing="0">${accentBar(T.red)}${bodyWrap(`
        ${badge('Store ready',T.redLight,T.red,T.redBorder)}<br/><br/>
        ${h1(`Your store is live, ${owner_name}.`)}
        ${sub(`${business_name} is set up on ProofLink. Click below to log in and start building.`)}
        <div style="text-align:center;margin:0 0 32px;">${cta('Log in to my dashboard →', loginHref)}</div>
        ${infoBox([...(store_slug?[['Your store URL',`prooflink.co/${store_slug}`]]:[]),['Dashboard',`${SITE_URL}/operator/`]])}
        ${divider()}
        <p style="margin:0 0 20px;font-size:15px;font-weight:700;color:${T.ink};">Complete your store setup</p>
        ${p('Your store is live but needs your branding, photos, and business details to look its best. Here is exactly what to gather.')}
        ${buildChecklistSection(business_type, loginHref)}
        ${divider()}
        ${p(`<span style="color:${T.hint};">Need help? Reply to this email and we'll walk you through setup personally.</span>`)}
      `)}</table>`, { preheader: `Your ProofLink store for ${business_name} is ready. Log in to get started.` }),
    };
  },

  rejected({ owner_name, business_name, owner_email, rejection_reason }) {
    return {
      to: owner_email,
      subject: `Update on your ProofLink application — ${business_name}`,
      html: layout(`<table width="100%" cellpadding="0" cellspacing="0">${accentBar(T.border)}${bodyWrap(`
        ${h1(`Hi ${owner_name},`)}
        ${sub('Thank you for your interest in ProofLink.')}
        ${p(`After reviewing the application for <strong style="color:${T.ink};">${business_name}</strong>, we're unable to approve it at this time.`)}
        ${rejection_reason?callout(`<strong style="color:${T.ink};">Note from our team:</strong><br/>${rejection_reason}`,T.bg,T.border,T.muted):''}
        ${divider()}
        ${p(`<span style="color:${T.hint};">If you believe this is an error or your situation has changed, just reply to this email. We're happy to take another look.</span>`)}
      `)}</table>`, { preheader: `An update on your ProofLink application for ${business_name}.` }),
    };
  },

  operatorNewRequest({ operator_email, owner_name, business_name, business_type, city_state, owner_email }) {
    return {
      to: operator_email,
      subject: `New application — ${business_name}`,
      html: layout(`<table width="100%" cellpadding="0" cellspacing="0">${accentBar(T.amber)}${bodyWrap(`
        ${badge('New application',T.amberLt,T.amber,T.amberBd)}<br/><br/>
        ${h1('New business application')}
        ${sub('A business just applied to join ProofLink.')}
        ${infoBox([['Business',business_name],['Owner',owner_name],['Email',owner_email],['Type',business_type||'—'],['Location',city_state||'—']])}
        <div style="text-align:left;">${cta('Review in admin dashboard →',`${SITE_URL}/admin/`)}</div>
      `)}</table>`, { preheader: `${business_name} just applied to join ProofLink.` }),
    };
  },

};

module.exports = { sendEmail, templates, getChecklist, CHECKLIST_BY_TYPE };
