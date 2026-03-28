// netlify/functions/evaluate-onboarding.js
// Automated rule engine for ProofLink onboarding applications.
//
// Called by submit-onboarding after the request row is created,
// and available as an admin-triggered re-evaluation endpoint.
//
// POST { request_id: uuid }
// Returns { status, risk_level, reason_codes }
//
// Decision logic:
//   Any REJECT rule hit → status = 'rejected'
//   Any FLAG rule hit (no REJECT) → status = 'needs_review'
//   All clear → status = 'approved'  (provisioning triggered automatically)
//
// Rules are evaluated in order. Short-circuits to REJECT on first hard block.
// Hardcoded baseline rules are always active. DB rule tables extend them.
// DB rule tables are read with try/catch — missing tables don't break evaluation.

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { getConfiguredSiteUrl } = require('./utils/runtime-config');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTERNAL_SECRET      = process.env.INTERNAL_SECRET || '';

// ── Baseline reserved slugs ───────────────────────────────────────────────────
// DB table pl_reserved_slugs extends this list without code changes.
const RESERVED_SLUGS_BASELINE = new Set([
  'admin','api','app','auth','billing','blog','cdn','dashboard','demo',
  'docs','help','login','logout','mail','manage','operator','platform',
  'prooflink','register','secure','signup','static','status','support',
  'system','www','null','undefined','test','staging','prod','production',
  'webhooks','callback','oauth','verify','confirm','invite','join','about',
]);

// ── Baseline disposable email domains ────────────────────────────────────────
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com','guerrillamail.com','temp-mail.org','throwam.com',
  'yopmail.com','sharklasers.com','guerrillamail.info','guerrillamail.biz',
  'guerrillamail.de','guerrillamail.net','guerrillamail.org','spam4.me',
  'trashmail.com','trashmail.me','trashmail.net','trashmail.org','trashmail.at',
  'trashmail.io','dispostable.com','mailnull.com','maildrop.cc','getairmail.com',
  'filzmail.com','spamgourmet.com','trashmail.fr','armyspy.com','cuvox.de',
  'dayrep.com','einrot.com','fleckens.hu','gustr.com','jourrapide.com',
  'rhyta.com','superrito.com','teleworm.us','10minutemail.com','fakeinbox.com',
  'throwaway.email','tempinbox.com','emailondeck.com','mailnesia.com',
]);

// ── Baseline protected brands ─────────────────────────────────────────────────
// DB table pl_protected_brands extends this list.
const PROTECTED_BRANDS_BASELINE = [
  'amazon','apple','google','microsoft','facebook','instagram','twitter','x.com',
  'paypal','visa','mastercard','stripe','shopify','walmart','target','costco',
  'netflix','spotify','uber','lyft','doordash','venmo','cashapp','zelle',
  'prooflink', // always protect our own brand
];

// ── Baseline prohibited categories (hard reject) ──────────────────────────────
// These map to the policy in the system design document.
const PROHIBITED_CATEGORIES_BASELINE = [
  {
    name    : 'illegal_drugs',
    keywords: ['heroin','cocaine','meth','fentanyl','crack','opioid dealer','drug dealer',
               'illicit drugs','narcotics dealer'],
  },
  {
    name    : 'drug_paraphernalia',
    keywords: ['bong shop','head shop','paraphernalia store','pipe store','drug pipes'],
  },
  {
    name    : 'prescription_drugs',
    keywords: ['online pharmacy','rx without prescription','no prescription needed',
               'prescription drugs online','buy prescription','sell prescription'],
  },
  {
    name    : 'firearms',
    keywords: ['gun shop','firearms dealer','weapons dealer','ammo store',
               'ar-15 sales','ghost guns','silencer shop','suppressor shop'],
  },
  {
    name    : 'adult_services',
    keywords: ['escort service','adult entertainment','adult webcam','cam girls','erotic services',
               'adult content platform','xxx','sex work services'],
  },
  {
    name    : 'hate_extremist',
    keywords: ['white supremac','neo-nazi','kkk ','aryan nation','hate group',
               'extremist merch','nazi memorabilia'],
  },
  {
    name    : 'counterfeit',
    keywords: ['counterfeit','fake designer','replica watches','knockoff brand',
               'fake id','fake documents','forged'],
  },
  {
    name    : 'scam_fraud',
    keywords: ['guaranteed returns','get rich quick','ponzi','pyramid scheme',
               'miracle cure','work from home guaranteed','100% profit'],
  },
  {
    name    : 'illegal_finance',
    keywords: ['unlicensed lending','loan shark','unregistered investment fund',
               'unregulated crypto exchange','money laundering'],
  },
  {
    name    : 'alcohol',
    keywords: ['liquor store','alcohol delivery','beer distributor','winery sales',
               'spirits shop','wine shop','liquor delivery'],
  },
  {
    name    : 'tobacco_vape',
    keywords: ['vape shop','tobacco store','smoke shop','cigarette shop',
               'e-cigarette store','hookah lounge','vaping products'],
  },
];

// ── Baseline restricted categories (flag for manual review, not rejected) ─────
const RESTRICTED_CATEGORIES_BASELINE = [
  {
    name    : 'cannabis',
    keywords: ['cannabis','dispensary','marijuana','cbd store','thc products',
               'weed shop','pot shop','420 store','hemp flower','dispo',
               'recreational cannabis','medical marijuana'],
  },
];

// ── Baseline banned keywords (profanity, impersonation boilerplate) ───────────
const BANNED_KEYWORDS_BASELINE = [
  // Profanity (business name / description)
  'fuck','shit','bitch','cunt','dick','pussy','cock','whore','nigger','faggot',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function emailDomain(email) {
  return (email || '').toLowerCase().split('@')[1] || '';
}

function normalize(str) {
  if (typeof str !== 'string') return '';
  return str.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textContainsAny(text, keywords) {
  const n = normalize(text);
  return keywords.find(kw => n.includes(normalize(kw))) || null;
}

function logNonBlockingRuleError(stage, err) {
  console.warn('[evaluate-onboarding] non-blocking rule lookup failed:', {
    stage,
    error: err?.message || String(err),
  });
}

function slugIsValid(slug) {
  if (!slug || typeof slug !== 'string') return false;
  if (slug.length < 3 || slug.length > 63) return false;
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) return false;
  if (/--/.test(slug)) return false;
  return true;
}

// ── Core evaluation ───────────────────────────────────────────────────────────

async function runEvaluation(req, supabase) {
  const reasons    = []; // { code, verdict, detail }
  const searchText = [
    req.business_name        || '',
    req.business_description || '',
    req.description          || '',
    req.business_type        || '',
  ].join(' ');

  // ── 1. Email legitimacy ─────────────────────────────────────────────────────
  const domain = emailDomain(req.owner_email || '');
  if (!domain) {
    reasons.push({ code: 'INVALID_EMAIL', verdict: 'REJECT', detail: 'No valid email domain' });
  } else if (DISPOSABLE_DOMAINS.has(domain)) {
    reasons.push({ code: 'DISPOSABLE_EMAIL', verdict: 'REJECT', detail: domain });
  }

  // ── 2. Slug validation ──────────────────────────────────────────────────────
  const slug = ((req.business_slug || req.requested_subdomain || '')).toLowerCase().trim();
  if (!slug) {
    reasons.push({ code: 'MISSING_SLUG', verdict: 'REJECT', detail: 'No slug provided' });
  } else if (!slugIsValid(slug)) {
    reasons.push({ code: 'INVALID_SLUG_FORMAT', verdict: 'REJECT', detail: slug });
  } else if (RESERVED_SLUGS_BASELINE.has(slug)) {
    reasons.push({ code: 'RESERVED_SLUG', verdict: 'REJECT', detail: slug });
  } else {
    // Check slug uniqueness against active tenants
    try {
      const { data: existing } = await supabase
        .from('tenants')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (existing) {
        reasons.push({ code: 'DUPLICATE_SLUG', verdict: 'REJECT', detail: slug });
      }
    } catch (err) { logNonBlockingRuleError('tenant_slug_lookup', err); }
  }

  // ── 3. Duplicate application (same email, non-rejected) ────────────────────
  try {
    const { data: dupApp } = await supabase
      .from('tenant_onboarding_requests')
      .select('id, status')
      .eq('owner_email', req.owner_email)
      .neq('id', req.id)
      .not('status', 'in', '("rejected","terminated")')
      .maybeSingle();
    if (dupApp) {
      reasons.push({ code: 'DUPLICATE_APPLICATION', verdict: 'FLAG', detail: 'Existing request: ' + dupApp.status });
    }
  } catch (err) { logNonBlockingRuleError('duplicate_application_lookup', err); }

  // ── 4. Protected brand impersonation ───────────────────────────────────────
  const nameNorm  = normalize(req.business_name || '');
  const impBrand  = PROTECTED_BRANDS_BASELINE.find(b => nameNorm.includes(normalize(b)));
  if (impBrand) {
    reasons.push({ code: 'PROTECTED_BRAND', verdict: 'REJECT', detail: impBrand });
  }

  // ── 5. Baseline banned keywords (profanity) ─────────────────────────────────
  const profanityHit = textContainsAny(searchText, BANNED_KEYWORDS_BASELINE);
  if (profanityHit) {
    reasons.push({ code: 'BANNED_KEYWORD', verdict: 'REJECT', detail: profanityHit });
  }

  // ── 6. Prohibited categories (hard reject) ──────────────────────────────────
  for (const cat of PROHIBITED_CATEGORIES_BASELINE) {
    const hit = textContainsAny(searchText, cat.keywords);
    if (hit) {
      reasons.push({ code: 'PROHIBITED_CATEGORY', verdict: 'REJECT', detail: cat.name + ':' + hit });
      break; // one prohibited hit is sufficient to reject
    }
  }

  // ── 7. Restricted categories (needs_review) ─────────────────────────────────
  if (!reasons.some(r => r.verdict === 'REJECT')) {
    for (const cat of RESTRICTED_CATEGORIES_BASELINE) {
      const hit = textContainsAny(searchText, cat.keywords);
      if (hit) {
        reasons.push({ code: 'RESTRICTED_CATEGORY', verdict: 'FLAG', detail: cat.name + ':' + hit });
        break;
      }
    }
  }

  // ── 8. DB-managed rule tables (extend baseline, same verdict logic) ─────────
  // These are additive — DB rules never override a REJECT already on the stack.
  // Wrapped in try/catch so missing tables never break evaluation.

  // pl_banned_keywords
  try {
    const { data: dbKw } = await supabase
      .from('pl_banned_keywords')
      .select('keyword, category, verdict')
      .eq('active', true);
    if (dbKw && dbKw.length) {
      for (const rule of dbKw) {
        const hit = textContainsAny(searchText, [rule.keyword]);
        if (hit) {
          reasons.push({
            code   : rule.verdict === 'REJECT' ? 'BANNED_KEYWORD' : 'FLAGGED_KEYWORD',
            verdict: rule.verdict,
            detail : rule.keyword + ' (' + rule.category + ')',
          });
        }
      }
    }
  } catch (err) { logNonBlockingRuleError('pl_banned_keywords', err); }

  // pl_protected_brands
  try {
    const { data: dbBrands } = await supabase
      .from('pl_protected_brands')
      .select('name')
      .eq('active', true);
    if (dbBrands && dbBrands.length) {
      const hit = dbBrands.find(b => nameNorm.includes(normalize(b.name)));
      if (hit && !reasons.find(r => r.code === 'PROTECTED_BRAND')) {
        reasons.push({ code: 'PROTECTED_BRAND', verdict: 'REJECT', detail: hit.name });
      }
    }
  } catch (err) { logNonBlockingRuleError('pl_protected_brands', err); }

  // pl_reserved_slugs
  try {
    if (slug && !reasons.some(r => r.code === 'RESERVED_SLUG')) {
      const { data: dbRes } = await supabase
        .from('pl_reserved_slugs')
        .select('slug')
        .eq('slug', slug)
        .eq('active', true)
        .maybeSingle();
      if (dbRes) {
        reasons.push({ code: 'RESERVED_SLUG', verdict: 'REJECT', detail: slug });
      }
    }
  } catch (err) { logNonBlockingRuleError('pl_reserved_slugs', err); }

  // pl_prohibited_categories — DB-managed category rules (extends baseline)
  try {
    const { data: dbCats } = await supabase
      .from('pl_prohibited_categories')
      .select('name, keywords, verdict')
      .eq('active', true);
    if (dbCats && dbCats.length) {
      for (const cat of dbCats) {
        // keywords is stored as text[] in DB
        const kws = Array.isArray(cat.keywords) ? cat.keywords : [];
        if (!kws.length) continue;
        const hit = textContainsAny(searchText, kws);
        if (hit) {
          const alreadyRejected = reasons.some(r => r.verdict === 'REJECT');
          // If verdict is FLAG and we already have a REJECT, skip (REJECT takes priority)
          if (cat.verdict === 'FLAG' && alreadyRejected) continue;
          reasons.push({
            code   : cat.verdict === 'REJECT' ? 'PROHIBITED_CATEGORY' : 'RESTRICTED_CATEGORY',
            verdict: cat.verdict || 'FLAG',
            detail : cat.name + ':' + hit,
          });
        }
      }
    }
  } catch (err) { logNonBlockingRuleError('pl_prohibited_categories', err); }

  // ── Final decision ──────────────────────────────────────────────────────────
  const hasReject = reasons.some(r => r.verdict === 'REJECT');
  const hasFlag   = reasons.some(r => r.verdict === 'FLAG');

  let status;
  let riskLevel;

  if (hasReject) {
    status    = 'rejected';
    riskLevel = 'high';
  } else if (hasFlag) {
    status    = 'needs_review';
    riskLevel = reasons.length > 1 ? 'high' : 'medium';
  } else {
    status    = 'approved';
    riskLevel = 'low';
  }

  return {
    status,
    risk_level       : riskLevel,
    reason_codes     : reasons.map(r => r.code),
    evaluation_result: {
      reasons,
      evaluated_at: new Date().toISOString(),
      version     : 1,
    },
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Auth: accept admin Bearer token OR internal service-to-service header
  const authHeader   = (event.headers['authorization'] || '').replace('Bearer ', '').trim();
  const isInternal   = event.headers['x-prooflink-internal'] === INTERNAL_SECRET && INTERNAL_SECRET;

  if (!authHeader && !isInternal) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (_) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { request_id } = body;
  if (!request_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'request_id is required' }) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Admin token check (skip for internal calls)
  if (!isInternal && authHeader) {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader);
    if (authErr || !user) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
    }
    // Verify admin role via operators table (platform_admin or admin)
    const { data: operator } = await supabase
      .from('operators')
      .select('role')
      .ilike('email', user.email || '')
      .maybeSingle();
    const adminRoles = new Set(['admin', 'platform_admin']);
    if (!operator || !adminRoles.has(operator.role)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Admin access required' }) };
    }
  }

  // Fetch the onboarding request
  const { data: req, error: fetchErr } = await supabase
    .from('tenant_onboarding_requests')
    .select('*')
    .eq('id', request_id)
    .maybeSingle();

  if (fetchErr || !req) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Request not found' }) };
  }

  // Run the evaluation
  let result;
  try {
    result = await runEvaluation(req, supabase);
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Evaluation error: ' + err.message }) };
  }

  // Persist the decision
  const evalNow = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('tenant_onboarding_requests')
    .update({
      status           : result.status,
      risk_level       : result.risk_level,
      reason_codes     : result.reason_codes,
      evaluation_result: result.evaluation_result,
      evaluated_at     : evalNow,
      updated_at       : evalNow,
    })
    .eq('id', request_id);

  if (updateErr) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to save evaluation: ' + updateErr.message }),
    };
  }

  // Auto-provision approved applications asynchronously
  if (result.status === 'approved') {
    let siteUrl;
    try {
      siteUrl = getConfiguredSiteUrl();
    } catch (err) {
      return {
        statusCode: err.statusCode || 503,
        body: JSON.stringify({ error: err.code === 'configuration_error' ? 'configuration_error' : err.message }),
      };
    }

    fetch(siteUrl + '/.netlify/functions/provision-tenant', {
      method : 'POST',
      headers: {
        'Content-Type'           : 'application/json',
        'Authorization'          : 'Bearer ' + SUPABASE_SERVICE_KEY,
        'x-prooflink-internal'   : INTERNAL_SECRET,
      },
      body: JSON.stringify({ id: request_id, auto: true }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {}); // fire and forget — provision-tenant handles its own errors
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      status      : result.status,
      risk_level  : result.risk_level,
      reason_codes: result.reason_codes,
    }),
  };
};
