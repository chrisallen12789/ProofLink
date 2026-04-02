(function initProposalDocumentEngine(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.ProofLinkProposalDocuments = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createProposalDocumentEngine() {
  'use strict';

  var TEMPLATE_TYPES = {
    STANDARD_OPERATIONAL: 'standard_operational',
    FORMAL_VENDOR: 'formal_vendor',
  };

  var DEFAULT_PRIMARY_COLOR = '#1f5f4a';

  var SYSTEM_DEFAULT_TERMS = {
    general_service: [
      'Pricing is based on the visible conditions and scope described in this proposal.',
      'Additional work outside the approved scope requires written approval before it is performed.',
      'Scheduling remains subject to weather, site access, utility clearance, material availability, and any safety conditions that affect the crew.',
      'Unless a different payment schedule is listed in this proposal, payment is due according to the approved scope and any required deposit terms shown in this document.',
    ].join('\n\n'),
    formal_vendor: [
      'This proposal is based on the project information available at the time of issue.',
      'Client delays, site condition changes, third-party requirements, and regulatory requirements that change the effort or sequence may require a written change authorization.',
      'Fees are based on the schedule, mobilization assumptions, and deliverables stated in this document.',
      'Added work, standby time, disposal changes, permit changes, or after-hours requirements will be priced separately unless expressly included.',
    ].join('\n\n'),
  };

  var SYSTEM_DEFAULT_EXCLUSIONS = {
    general_service: [
      'Unless specifically listed in the approved scope, this proposal excludes concealed conditions, permit fees, engineering, utility charges, third-party inspections, hazardous material handling, landscape or finish restoration, and work caused by site conditions that were not reasonably visible during the initial review.',
    ].join('\n\n'),
    hydrovac_vactor: [
      'Unless specifically listed in the approved scope, this proposal excludes traffic control beyond normal crew setup, emergency utility response charges, after-hours owner standby, contaminated material handling, disposal fees that exceed the listed assumptions, and damage caused by inaccurate locate information supplied by others.',
    ].join('\n\n'),
  };

  function isBlank(value) {
    return String(value == null ? '' : value).trim() === '';
  }

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function normalizeColor(value) {
    var raw = clean(value);
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : DEFAULT_PRIMARY_COLOR;
  }

  function formatMoneyCents(cents) {
    var numeric = Number(cents || 0);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric / 100);
  }

  function formatDate(value) {
    if (!value) return '';
    var date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }

  function initialsForName(value) {
    var parts = clean(value).split(/\s+/).filter(Boolean);
    if (!parts.length) return 'PL';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function titleCase(value) {
    return clean(value)
      .toLowerCase()
      .replace(/\b[a-z]/g, function (letter) { return letter.toUpperCase(); });
  }

  function paragraphs(value) {
    return clean(value)
      .split(/\n{2,}/)
      .map(function (segment) { return clean(segment); })
      .filter(Boolean);
  }

  function renderParagraphHtml(value, fallbackText) {
    var rows = Array.isArray(value) ? value : paragraphs(value);
    if (!rows.length) {
      return fallbackText ? '<p>' + escapeHtml(fallbackText) + '</p>' : '';
    }
    return rows.map(function (row) {
      return '<p>' + escapeHtml(row).replace(/\n/g, '<br />') + '</p>';
    }).join('');
  }

  function parseBulletText(value) {
    if (Array.isArray(value)) {
      return value.map(function mapNode(item) {
        return {
          text: clean(item && item.text ? item.text : item),
          children: Array.isArray(item && item.children) ? item.children.map(mapNode) : [],
        };
      }).filter(function (item) { return item.text; });
    }

    var lines = String(value == null ? '' : value).split(/\r?\n/);
    var rootNodes = [];
    var stack = [{ level: -1, children: rootNodes }];

    lines.forEach(function (line) {
      var raw = String(line || '').replace(/\t/g, '  ');
      if (!raw.trim()) return;
      var match = raw.match(/^(\s*)([-*]|\d+\.)?\s*(.+)$/);
      var indent = match ? match[1].length : 0;
      var text = clean(match ? match[3] : raw);
      if (!text) return;

      var node = { text: text, children: [] };
      while (stack.length > 1 && indent <= stack[stack.length - 1].level) {
        stack.pop();
      }
      stack[stack.length - 1].children.push(node);
      stack.push({ level: indent, children: node.children });
    });

    return rootNodes;
  }

  function renderBulletList(nodes) {
    if (!Array.isArray(nodes) || !nodes.length) return '';
    return '<ul>' + nodes.map(function (node) {
      return '<li>' + escapeHtml(node.text) + renderBulletList(node.children) + '</li>';
    }).join('') + '</ul>';
  }

  function normalizeFeeRows(value) {
    if (!Array.isArray(value)) return [];
    return value.map(function (row) {
      return {
        label: clean(row && row.label),
        description: clean(row && row.description),
        amount_cents: Number(row && (row.amount_cents != null ? row.amount_cents : row.amountCents) || 0),
      };
    }).filter(function (row) {
      return row.label || row.description || row.amount_cents;
    });
  }

  function normalizeOption(option, fallbackTitle) {
    var priceCents = Number(
      option && (
        option.price_amount_cents != null
          ? option.price_amount_cents
          : option.priceAmountCents != null
            ? option.priceAmountCents
            : option.price_amount != null
              ? Math.round(Number(option.price_amount) * 100)
              : option.total_cents != null
                ? option.total_cents
                : 0
      )
    ) || 0;

    var feeRows = normalizeFeeRows(option && option.fee_rows);
    if (!feeRows.length && priceCents > 0) {
      feeRows = [{
        label: clean(option && option.pricing_label) || clean(option && option.option_title) || fallbackTitle || 'Fee',
        description: clean(option && option.notes),
        amount_cents: priceCents,
      }];
    }

    return {
      id: clean(option && option.id),
      optionType: clean(option && (option.option_type || option.optionType)) || 'option',
      optionTitle: clean(option && (option.option_title || option.optionTitle)) || fallbackTitle || 'Option',
      pricingLabel: clean(option && (option.pricing_label || option.pricingLabel)) || 'Investment',
      priceAmountCents: priceCents,
      priceUnit: clean(option && (option.price_unit || option.priceUnit)),
      notes: clean(option && option.notes),
      scopeContent: parseBulletText(option && (option.scope_content || option.scopeContent || option.scope_of_work || option.scopeOfWork)),
      feeRows: feeRows,
    };
  }

  function resolveSystemTerms(serviceType, templateType) {
    if (templateType === TEMPLATE_TYPES.FORMAL_VENDOR) return SYSTEM_DEFAULT_TERMS.formal_vendor;
    return SYSTEM_DEFAULT_TERMS[clean(serviceType)] || SYSTEM_DEFAULT_TERMS.general_service;
  }

  function resolveSystemExclusions(serviceType) {
    return SYSTEM_DEFAULT_EXCLUSIONS[clean(serviceType)] || SYSTEM_DEFAULT_EXCLUSIONS.general_service;
  }

  function buildBranding(input) {
    var brand = input || {};
    var legacyTenant = brand.legacyTenant || {};
    var setupConfig = brand.setupConfig || {};
    var profile = brand.profile || {};

    var companyName =
      clean(profile.company_name || profile.companyName)
      || clean(legacyTenant.company_name || legacyTenant.companyName)
      || clean(legacyTenant.name)
      || clean(setupConfig.company_name || setupConfig.companyName)
      || clean(setupConfig.legal_business_name || setupConfig.legalBusinessName)
      || 'Brand identity pending';

    var logoUrl =
      clean(profile.logo_image_url || profile.logo_image || profile.logoImageUrl || profile.logoUrl)
      || clean(legacyTenant.logo_image_url || legacyTenant.logo_image || legacyTenant.logoImageUrl)
      || clean(setupConfig.logo_image_url || setupConfig.logo_image || setupConfig.logo_url)
      || clean(legacyTenant.logo_url);

    var addressText =
      clean(profile.address_text || profile.address)
      || clean(legacyTenant.address_text || legacyTenant.address)
      || clean(setupConfig.address_text || setupConfig.address || setupConfig.city_state || legacyTenant.city_state);

    var phone =
      clean(profile.phone)
      || clean(setupConfig.public_business_phone || setupConfig.business_phone)
      || clean(legacyTenant.phone);

    var email =
      clean(profile.email)
      || clean(setupConfig.public_contact_email || setupConfig.contact_email)
      || clean(legacyTenant.notification_email || legacyTenant.email);

    var website =
      clean(profile.website)
      || clean(setupConfig.website)
      || clean(legacyTenant.website);

    return {
      companyName: companyName,
      logoUrl: logoUrl,
      hasLogo: !isBlank(logoUrl),
      logoPlaceholderLabel: 'Logo not configured',
      primaryColor: normalizeColor(profile.primary_color || profile.primaryColor || setupConfig.primary_color || setupConfig.accent_color || legacyTenant.primary_color || legacyTenant.accent_color),
      addressText: addressText,
      phone: phone,
      email: email,
      website: website,
      defaultTermsTemplateId: clean(profile.default_terms_template_id || profile.defaultTermsTemplateId),
      defaultExclusionsTemplateId: clean(profile.default_exclusions_template_id || profile.defaultExclusionsTemplateId),
      defaultSenderUserId: clean(profile.default_sender_user_id || profile.defaultSenderUserId),
    };
  }

  function buildSender(input) {
    var selected = (input && input.selected) || {};
    var tenantDefault = (input && input.tenantDefault) || {};
    var brand = (input && input.brand) || {};

    var fullName =
      clean(selected.full_name || selected.fullName || selected.name)
      || clean(tenantDefault.full_name || tenantDefault.fullName || tenantDefault.name)
      || 'Sender not configured';

    return {
      fullName: fullName,
      jobTitle:
        clean(selected.job_title || selected.jobTitle)
        || clean(tenantDefault.job_title || tenantDefault.jobTitle)
        || 'Authorized representative',
      phone:
        clean(selected.phone)
        || clean(tenantDefault.phone)
        || clean(brand.phone),
      email:
        clean(selected.email)
        || clean(tenantDefault.email)
        || clean(brand.email),
      signatureImageUrl:
        clean(selected.signature_image_url || selected.signature_image || selected.signatureImageUrl)
        || clean(tenantDefault.signature_image_url || tenantDefault.signature_image || tenantDefault.signatureImageUrl),
      initials:
        clean(selected.initials)
        || clean(tenantDefault.initials)
        || initialsForName(fullName),
      isFallback: isBlank(clean(selected.full_name || selected.fullName || selected.name)),
    };
  }

  function buildProposalViewModel(input) {
    var document = input && input.document ? input.document : {};
    var templateType = clean(document.template_type || document.templateType) || TEMPLATE_TYPES.STANDARD_OPERATIONAL;
    var serviceType = clean(document.service_type || document.serviceType || input.serviceType) || 'general_service';
    var branding = buildBranding({
      profile: input && input.tenantBrandingProfile,
      legacyTenant: input && input.tenant,
      setupConfig: input && input.setupConfig,
    });
    var sender = buildSender({
      selected: input && input.senderProfile,
      tenantDefault: input && input.defaultSenderProfile,
      brand: branding,
    });

    var termsTemplate = input && input.termsTemplate ? input.termsTemplate : {};
    var exclusionsTemplate = input && input.exclusionsTemplate ? input.exclusionsTemplate : {};

    var options = Array.isArray(input && input.options) ? input.options.map(function (option, index) {
      return normalizeOption(option, 'Option ' + String(index + 1));
    }) : [];

    if (!options.length) {
      options = [normalizeOption({
        option_title: clean(document.option_title) || clean(document.project_name || document.projectName) || 'Base scope',
        pricing_label: clean(document.pricing_label),
        price_amount_cents:
          document.price_amount_cents != null
            ? document.price_amount_cents
            : document.total_cents != null
              ? document.total_cents
              : 0,
        price_unit: clean(document.price_unit),
        scope_content: document.scope_content || document.scope_of_work || document.scopeOfWork || '',
        fee_rows: document.vendor_fee_rows || document.vendorFeeRows || [],
        notes: clean(document.notes_text || document.notesText),
      }, 'Base scope')];
    }

    var termsText =
      clean(document.terms_override || document.termsOverride)
      || clean(termsTemplate.body_text || termsTemplate.bodyText)
      || resolveSystemTerms(serviceType, templateType);

    var exclusionsText =
      clean(document.exclusions_override || document.exclusionsOverride)
      || clean(exclusionsTemplate.body_text || exclusionsTemplate.bodyText)
      || resolveSystemExclusions(serviceType);

    return {
      schemaVersion: 'proposal-document-engine/v1',
      id: clean(document.id),
      publicToken: clean(document.public_token || document.publicToken),
      templateType: templateType,
      serviceType: serviceType,
      status: clean(document.status) || 'draft',
      proposalDate: clean(document.proposal_date || document.proposalDate || document.created_at || document.createdAt) || '',
      expirationDate: clean(document.expiration_date || document.expirationDate || document.valid_until || document.validUntil),
      recipientName: clean(document.recipient_name || document.recipientName),
      recipientCompany: clean(document.recipient_company || document.recipientCompany),
      recipientAddress: clean(document.recipient_address || document.recipientAddress),
      attentionLine: clean(document.attention_line || document.attentionLine),
      subjectLine: clean(document.subject_line || document.subjectLine || document.title),
      projectName: clean(document.project_name || document.projectName || document.title),
      siteAddress: clean(document.site_address || document.siteAddress || document.service_address || document.serviceAddress),
      introText: clean(document.intro_text || document.introText || document.cover_note || document.coverNote),
      valuePropositionText: clean(document.value_proposition_text || document.valuePropositionText || document.project_summary || document.projectSummary),
      notesText: clean(document.notes_text || document.notesText || document.notes),
      termsText: termsText,
      exclusionsText: exclusionsText,
      options: options,
      branding: branding,
      sender: sender,
      preparedByUserId: clean(document.prepared_by_user_id || document.preparedByUserId),
      senderUserId: clean(document.sender_user_id || document.senderUserId),
      revisionNumber: Number(document.revision_number || document.revisionNumber || 1) || 1,
      acceptedAt: clean(document.accepted_at || document.acceptedAt),
      viewedAt: clean(document.viewed_at || document.viewedAt),
      sentAt: clean(document.sent_at || document.sentAt),
    };
  }

  function renderLogoBlock(model) {
    var branding = model.branding || {};
    if (branding.hasLogo) {
      return '<div class="pl-doc-logo"><img src="' + escapeAttr(branding.logoUrl) + '" alt="' + escapeAttr(branding.companyName) + ' logo" /></div>';
    }
    return '<div class="pl-doc-logo pl-doc-logo--placeholder"><span>' + escapeHtml(branding.logoPlaceholderLabel) + '</span></div>';
  }

  function renderCompanyContact(model) {
    var branding = model.branding || {};
    var lines = [
      branding.companyName,
      branding.addressText,
      [branding.phone, branding.email].filter(Boolean).join(' | '),
      branding.website,
    ].filter(Boolean);
    return lines.map(function (line) {
      return '<div class="pl-doc-letterhead__line">' + escapeHtml(line) + '</div>';
    }).join('');
  }

  function renderOptionSection(option) {
    var priceLine = formatMoneyCents(option.priceAmountCents) + (option.priceUnit ? ' ' + option.priceUnit : '');
    return [
      '<section class="pl-doc-option">',
      '  <div class="pl-doc-option__top">',
      '    <div>',
      '      <h3>' + escapeHtml(option.optionTitle) + '</h3>',
      '      <div class="pl-doc-option__label">' + escapeHtml(option.pricingLabel || 'Investment') + '</div>',
      '    </div>',
      '    <div class="pl-doc-price-box">',
      '      <div class="pl-doc-price-box__label">' + escapeHtml(option.pricingLabel || 'Investment') + '</div>',
      '      <div class="pl-doc-price-box__value">' + escapeHtml(priceLine) + '</div>',
      '    </div>',
      '  </div>',
      renderBulletList(option.scopeContent) || '<p class="pl-doc-empty">Scope details to be confirmed.</p>',
      option.notes ? '<div class="pl-doc-option__notes">' + renderParagraphHtml(option.notes) + '</div>' : '',
      '</section>',
    ].join('');
  }

  function renderVendorFeeTable(model) {
    var rows = [];
    model.options.forEach(function (option) {
      if (option.feeRows && option.feeRows.length) {
        option.feeRows.forEach(function (fee) {
          rows.push({
            label: fee.label || option.optionTitle,
            description: fee.description || option.notes || '',
            amount_cents: Number(fee.amount_cents || 0),
          });
        });
        return;
      }
      rows.push({
        label: option.optionTitle,
        description: option.notes || '',
        amount_cents: option.priceAmountCents,
      });
    });

    if (!rows.length) {
      return '<p class="pl-doc-empty">Fee schedule to be confirmed.</p>';
    }

    return [
      '<table class="pl-doc-fee-table">',
      '  <thead><tr><th>Fee item</th><th>Description</th><th>Amount</th></tr></thead>',
      '  <tbody>',
      rows.map(function (row) {
        return '<tr><td>' + escapeHtml(row.label) + '</td><td>' + escapeHtml(row.description || '-') + '</td><td>' + escapeHtml(formatMoneyCents(row.amount_cents)) + '</td></tr>';
      }).join(''),
      '  </tbody>',
      '</table>',
    ].join('');
  }

  function renderSenderBlock(model) {
    var sender = model.sender || {};
    var signatureMarkup = sender.signatureImageUrl
      ? '<img class="pl-doc-signature__image" src="' + escapeAttr(sender.signatureImageUrl) + '" alt="' + escapeAttr(sender.fullName) + ' signature" />'
      : '<div class="pl-doc-signature__typed">' + escapeHtml(sender.initials || initialsForName(sender.fullName)) + '</div>';

    return [
      '<div class="pl-doc-signature">',
      '  <div class="pl-doc-signature__line"></div>',
      '  ' + signatureMarkup,
      '  <div class="pl-doc-signature__name">' + escapeHtml(sender.fullName) + '</div>',
      '  <div class="pl-doc-signature__meta">' + escapeHtml(sender.jobTitle) + '</div>',
      sender.phone ? '  <div class="pl-doc-signature__meta">' + escapeHtml(sender.phone) + '</div>' : '',
      sender.email ? '  <div class="pl-doc-signature__meta">' + escapeHtml(sender.email) + '</div>' : '',
      '</div>',
    ].join('');
  }

  function renderOperationalTemplate(model) {
    return [
      '<article class="pl-doc pl-doc--operational" style="--pl-doc-accent:' + escapeAttr(model.branding.primaryColor) + ';">',
      '  <header class="pl-doc-header">',
      '    <div class="pl-doc-letterhead">',
      '      ' + renderLogoBlock(model),
      '      <div class="pl-doc-letterhead__copy">' + renderCompanyContact(model) + '</div>',
      '    </div>',
      '  </header>',
      '  <section class="pl-doc-body">',
      '    <div class="pl-doc-date">' + escapeHtml(formatDate(model.proposalDate) || '') + '</div>',
      '    <div class="pl-doc-recipient">',
      model.recipientName ? '      <div><strong>To:</strong> ' + escapeHtml(model.recipientName) + '</div>' : '',
      model.recipientCompany ? '      <div>' + escapeHtml(model.recipientCompany) + '</div>' : '',
      model.recipientAddress ? '      <div>' + escapeHtml(model.recipientAddress) + '</div>' : '',
      '    </div>',
      model.attentionLine ? '    <div class="pl-doc-meta-line"><strong>ATTN:</strong> ' + escapeHtml(model.attentionLine) + '</div>' : '',
      model.subjectLine ? '    <div class="pl-doc-meta-line"><strong>RE:</strong> ' + escapeHtml(model.subjectLine) + '</div>' : '',
      model.siteAddress ? '    <div class="pl-doc-meta-line"><strong>Project / Site Address:</strong> ' + escapeHtml(model.siteAddress) + '</div>' : '',
      model.introText ? '    <section class="pl-doc-section">' + renderParagraphHtml(model.introText) + '</section>' : '',
      '    <section class="pl-doc-section">',
      model.options.map(renderOptionSection).join(''),
      '    </section>',
      '    <section class="pl-doc-section">',
      '      <h2>Terms and Conditions</h2>',
      renderParagraphHtml(model.termsText, 'Terms will be confirmed with the final approved scope.'),
      '    </section>',
      '    <section class="pl-doc-section">',
      '      <h2>Scope Exclusions</h2>',
      renderParagraphHtml(model.exclusionsText, 'Exclusions will be confirmed with the final approved scope.'),
      '    </section>',
      model.notesText ? '    <section class="pl-doc-section"><h2>Additional Notes</h2>' + renderParagraphHtml(model.notesText) + '</section>' : '',
      '    <section class="pl-doc-section pl-doc-section--closing">',
      '      <p>We appreciate the opportunity to submit this proposal and would be glad to answer any questions.</p>',
      '      ' + renderSenderBlock(model),
      '    </section>',
      '  </section>',
      '</article>',
    ].join('');
  }

  function renderVendorTemplate(model) {
    return [
      '<article class="pl-doc pl-doc--vendor" style="--pl-doc-accent:' + escapeAttr(model.branding.primaryColor) + ';">',
      '  <header class="pl-doc-header pl-doc-header--vendor">',
      '    <div class="pl-doc-letterhead">',
      '      ' + renderLogoBlock(model),
      '      <div class="pl-doc-letterhead__copy">' + renderCompanyContact(model) + '</div>',
      '    </div>',
      '  </header>',
      '  <section class="pl-doc-body">',
      '    <section class="pl-doc-section pl-doc-section--metadata">',
      '      <h1>' + escapeHtml(model.projectName || model.subjectLine || 'Proposal') + '</h1>',
      '      <div class="pl-doc-metadata-grid">',
      '        <div><span>Proposal date</span><strong>' + escapeHtml(formatDate(model.proposalDate) || '-') + '</strong></div>',
      '        <div><span>Expiration</span><strong>' + escapeHtml(formatDate(model.expirationDate) || '-') + '</strong></div>',
      '        <div><span>Prepared for</span><strong>' + escapeHtml(model.recipientCompany || model.recipientName || '-') + '</strong></div>',
      '        <div><span>Attention</span><strong>' + escapeHtml(model.attentionLine || '-') + '</strong></div>',
      '        <div><span>Project</span><strong>' + escapeHtml(model.projectName || '-') + '</strong></div>',
      '        <div><span>Site address</span><strong>' + escapeHtml(model.siteAddress || '-') + '</strong></div>',
      '      </div>',
      '    </section>',
      model.introText ? '    <section class="pl-doc-section"><h2>Introduction</h2>' + renderParagraphHtml(model.introText) + '</section>' : '',
      model.valuePropositionText ? '    <section class="pl-doc-section"><h2>Value Proposition</h2>' + renderParagraphHtml(model.valuePropositionText) + '</section>' : '',
      '    <section class="pl-doc-section"><h2>Scope of Work</h2>' + model.options.map(function (option) {
        return '<div class="pl-doc-vendor-scope"><h3>' + escapeHtml(option.optionTitle) + '</h3>' + (renderBulletList(option.scopeContent) || '<p class="pl-doc-empty">Scope details to be confirmed.</p>') + '</div>';
      }).join('') + '</section>',
      '    <section class="pl-doc-section"><h2>Fee Schedule</h2>' + renderVendorFeeTable(model) + '</section>',
      model.notesText ? '    <section class="pl-doc-section"><h2>Regulatory / Add-On Fees</h2>' + renderParagraphHtml(model.notesText) + '</section>' : '',
      '    <section class="pl-doc-section"><h2>Terms and Conditions</h2>' + renderParagraphHtml(model.termsText, 'Terms will be confirmed with the final approved scope.') + '</section>',
      '    <section class="pl-doc-section"><h2>Exclusions</h2>' + renderParagraphHtml(model.exclusionsText, 'Exclusions will be confirmed with the final approved scope.') + '</section>',
      '    <section class="pl-doc-section pl-doc-section--acceptance">',
      '      <h2>Acceptance</h2>',
      '      <p>Approval of this proposal authorizes the work, fees, and terms described in this document.</p>',
      '      <div class="pl-doc-acceptance-grid">',
      '        <div class="pl-doc-acceptance-line"><span>Authorized client signature</span></div>',
      '        <div class="pl-doc-acceptance-line"><span>Date</span></div>',
      '      </div>',
      '      ' + renderSenderBlock(model),
      '    </section>',
      '  </section>',
      '</article>',
    ].join('');
  }

  function renderDocumentBody(model) {
    var normalized = buildProposalViewModel({
      document: model,
      options: model && model.options,
      tenantBrandingProfile: model && model.branding,
      senderProfile: model && model.sender,
    });
    return normalized.templateType === TEMPLATE_TYPES.FORMAL_VENDOR
      ? renderVendorTemplate(normalized)
      : renderOperationalTemplate(normalized);
  }

  function renderDocumentStyles() {
    return [
      ':root { color-scheme: light; }',
      '* { box-sizing: border-box; }',
      'body { margin: 0; background: #f3f3ef; color: #1f1f1f; font-family: "Georgia", "Times New Roman", serif; }',
      '.pl-doc-page { padding: 24px; }',
      '.pl-doc { width: 100%; max-width: 8.5in; min-height: 11in; margin: 0 auto; background: #ffffff; border: 1px solid #d7d2c8; box-shadow: 0 20px 60px rgba(0,0,0,.08); }',
      '.pl-doc-header { padding: 28px 36px 8px; }',
      '.pl-doc-body { padding: 0 36px 40px; }',
      '.pl-doc-letterhead { display: flex; align-items: flex-start; gap: 18px; }',
      '.pl-doc-logo { width: 118px; height: 84px; border: 1px solid #d3cec3; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #ffffff; }',
      '.pl-doc-logo img { width: 100%; height: 100%; object-fit: contain; }',
      '.pl-doc-logo--placeholder { border-style: dashed; background: #f7f4ed; color: #8b7f6d; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; text-align: center; padding: 12px; }',
      '.pl-doc-letterhead__copy { flex: 1; min-height: 84px; display: flex; flex-direction: column; justify-content: center; }',
      '.pl-doc-letterhead__line:first-child { font-size: 28px; font-weight: 700; color: var(--pl-doc-accent); margin-bottom: 8px; font-family: "Arial", sans-serif; }',
      '.pl-doc-letterhead__line { font-size: 13px; line-height: 1.5; }',
      '.pl-doc-date { margin: 8px 0 22px; font-size: 14px; }',
      '.pl-doc-recipient, .pl-doc-meta-line { margin-bottom: 10px; font-size: 14px; line-height: 1.6; }',
      '.pl-doc-section { margin-top: 26px; }',
      '.pl-doc-section h1 { margin: 0; font-size: 28px; color: var(--pl-doc-accent); font-family: "Arial", sans-serif; }',
      '.pl-doc-section h2 { margin: 0 0 10px; font-size: 16px; letter-spacing: .04em; text-transform: uppercase; font-family: "Arial", sans-serif; color: var(--pl-doc-accent); }',
      '.pl-doc-section h3 { margin: 0 0 8px; font-size: 16px; font-family: "Arial", sans-serif; }',
      '.pl-doc-section p { margin: 0 0 10px; font-size: 14px; line-height: 1.65; }',
      '.pl-doc-empty { color: #66625a; font-style: italic; }',
      '.pl-doc-option { border: 1px solid #d8d2c7; padding: 18px; margin-bottom: 16px; break-inside: avoid; }',
      '.pl-doc-option__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 12px; }',
      '.pl-doc-option__label { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6d665d; font-family: "Arial", sans-serif; }',
      '.pl-doc-option__notes { margin-top: 14px; }',
      '.pl-doc-price-box { min-width: 180px; border: 2px solid var(--pl-doc-accent); padding: 12px 14px; text-align: right; }',
      '.pl-doc-price-box__label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6d665d; font-family: "Arial", sans-serif; }',
      '.pl-doc-price-box__value { margin-top: 6px; font-size: 24px; font-weight: 700; color: var(--pl-doc-accent); font-family: "Arial", sans-serif; }',
      '.pl-doc ul { margin: 0; padding-left: 20px; }',
      '.pl-doc li { margin: 0 0 8px; line-height: 1.55; font-size: 14px; }',
      '.pl-doc li > ul { margin-top: 8px; }',
      '.pl-doc-signature { margin-top: 28px; max-width: 320px; }',
      '.pl-doc-signature__line { border-top: 1px solid #1f1f1f; margin-bottom: 12px; }',
      '.pl-doc-signature__image { max-width: 220px; max-height: 72px; display: block; margin-bottom: 8px; object-fit: contain; }',
      '.pl-doc-signature__typed { font-size: 24px; font-weight: 700; color: var(--pl-doc-accent); margin-bottom: 6px; font-family: "Brush Script MT", cursive; }',
      '.pl-doc-signature__name { font-size: 14px; font-weight: 700; }',
      '.pl-doc-signature__meta { font-size: 13px; line-height: 1.5; }',
      '.pl-doc-metadata-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; margin-top: 14px; }',
      '.pl-doc-metadata-grid div { border: 1px solid #d8d2c7; padding: 12px; }',
      '.pl-doc-metadata-grid span { display: block; margin-bottom: 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6d665d; font-family: "Arial", sans-serif; }',
      '.pl-doc-metadata-grid strong { display: block; font-size: 14px; line-height: 1.45; }',
      '.pl-doc-fee-table { width: 100%; border-collapse: collapse; font-size: 13px; }',
      '.pl-doc-fee-table th, .pl-doc-fee-table td { border: 1px solid #d8d2c7; padding: 10px 12px; vertical-align: top; }',
      '.pl-doc-fee-table th { background: #f4f0e7; text-align: left; font-family: "Arial", sans-serif; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }',
      '.pl-doc-vendor-scope + .pl-doc-vendor-scope { margin-top: 18px; }',
      '.pl-doc-acceptance-grid { display: grid; grid-template-columns: 1fr 180px; gap: 18px; margin: 24px 0 8px; }',
      '.pl-doc-acceptance-line { border-bottom: 1px solid #1f1f1f; min-height: 40px; position: relative; }',
      '.pl-doc-acceptance-line span { position: absolute; left: 0; bottom: -20px; font-size: 12px; color: #6d665d; }',
      '@page { size: letter; margin: .5in; }',
      '@media print { body { background: #ffffff; } .pl-doc-page { padding: 0; } .pl-doc { box-shadow: none; border: none; max-width: none; min-height: auto; } }',
      '@media (max-width: 820px) { .pl-doc-page { padding: 12px; } .pl-doc-header, .pl-doc-body { padding-left: 18px; padding-right: 18px; } .pl-doc-option__top, .pl-doc-letterhead { flex-direction: column; } .pl-doc-metadata-grid, .pl-doc-acceptance-grid { grid-template-columns: 1fr; } .pl-doc-price-box { width: 100%; text-align: left; } }',
    ].join('\n');
  }

  function renderDocumentPage(model, options) {
    var normalized = buildProposalViewModel({
      document: model,
      options: model && model.options,
      tenantBrandingProfile: model && model.branding,
      senderProfile: model && model.sender,
      termsTemplate: model && model.termsTemplate,
      exclusionsTemplate: model && model.exclusionsTemplate,
      serviceType: model && model.serviceType,
    });
    var title = clean(options && options.title) || clean(normalized.projectName) || 'Proposal';
    var body = normalized.templateType === TEMPLATE_TYPES.FORMAL_VENDOR
      ? renderVendorTemplate(normalized)
      : renderOperationalTemplate(normalized);

    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      '  <title>' + escapeHtml(title) + '</title>',
      '  <style>' + renderDocumentStyles() + '</style>',
      '</head>',
      '<body>',
      '  <div class="pl-doc-page">' + body + '</div>',
      '</body>',
      '</html>',
    ].join('');
  }

  return {
    TEMPLATE_TYPES: TEMPLATE_TYPES,
    SYSTEM_DEFAULT_TERMS: SYSTEM_DEFAULT_TERMS,
    SYSTEM_DEFAULT_EXCLUSIONS: SYSTEM_DEFAULT_EXCLUSIONS,
    buildBranding: buildBranding,
    buildSender: buildSender,
    buildProposalViewModel: buildProposalViewModel,
    parseBulletText: parseBulletText,
    normalizeOption: normalizeOption,
    renderDocumentBody: renderDocumentBody,
    renderDocumentPage: renderDocumentPage,
    renderDocumentStyles: renderDocumentStyles,
    renderOperationalTemplate: renderOperationalTemplate,
    renderVendorTemplate: renderVendorTemplate,
    renderVendorFeeTable: renderVendorFeeTable,
    renderBulletList: renderBulletList,
    formatMoneyCents: formatMoneyCents,
    formatDate: formatDate,
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    initialsForName: initialsForName,
    titleCase: titleCase,
  };
});
