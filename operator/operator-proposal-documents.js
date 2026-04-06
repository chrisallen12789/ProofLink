(function initOperatorProposalDocuments(global) {
  'use strict';

  var engine = global.ProofLinkProposalDocuments;
  if (!engine) {
    global.PROOFLINK_OPERATOR_PROPOSAL_DOCUMENTS = {
      loadSupport: function () { return Promise.resolve({ ready: false }); },
      buildViewModelForBid: function () { return null; },
      syncFromBidDraft: function (draft) { return Promise.resolve(draft); },
      brandSetupStatus: function () { return null; },
      templateChoices: function () { return []; },
      termsChoices: function () { return []; },
      exclusionsChoices: function () { return []; },
      senderChoices: function () { return []; },
      mergeDraftDefaults: function (draft) { return draft; },
    };
    return;
  }

  var state = {
    ready: false,
    loadPromise: null,
    templates: [],
    templateVersions: [],
    termsTemplates: [],
    exclusionsTemplates: [],
    brandingProfile: null,
    senderProfiles: [],
    teamMembers: [],
    currentUser: null,
  };

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function createLocalId(prefix) {
    if (typeof global.createLocalId === 'function') return global.createLocalId(prefix || 'proposal');
    return [prefix || 'proposal', Date.now(), Math.random().toString(16).slice(2, 8)].join('_');
  }

  function currentTenantId() {
    return typeof TENANT_ID !== 'undefined' ? TENANT_ID : '';
  }

  function isMissingFeature(error) {
    return typeof global.isMissingDatabaseFeatureError === 'function'
      && global.isMissingDatabaseFeatureError(error, [
        'document_templates',
        'document_template_versions',
        'reusable_terms_templates',
        'reusable_exclusions_templates',
        'tenant_branding_profiles',
        'user_document_profiles',
        'proposal_documents',
        'proposal_document_versions',
        'proposal_options',
      ]);
  }

  async function fetchTeamMembers() {
    if (typeof getAccessToken !== 'function' || typeof fetch !== 'function') return [];
    const token = await getAccessToken().catch(function () { return ''; });
    if (!token) return [];
    const response = await fetch('/.netlify/functions/manage-operator-members', {
      headers: { Authorization: 'Bearer ' + token },
    });
    const data = await response.json().catch(function () { return {}; });
    return response.ok && Array.isArray(data.members) ? data.members : [];
  }

  async function loadSupport(force) {
    if (state.ready && !force) return state;
    if (state.loadPromise && !force) return state.loadPromise;

    state.loadPromise = (async function () {
      if (typeof sb === 'undefined' || !currentTenantId()) {
        state.ready = false;
        return state;
      }

      try {
        var results = await Promise.all([
          sb.from('document_templates').select('*').order('name', { ascending: true }),
          sb.from('document_template_versions').select('*').order('version_number', { ascending: false }),
          sb.from('reusable_terms_templates').select('*').order('name', { ascending: true }),
          sb.from('reusable_exclusions_templates').select('*').order('name', { ascending: true }),
          sb.from('tenant_branding_profiles').select('*').eq('tenant_id', currentTenantId()).maybeSingle(),
          sb.from('user_document_profiles').select('*').eq('tenant_id', currentTenantId()).order('updated_at', { ascending: false }),
          typeof getUser === 'function' ? getUser() : Promise.resolve(null),
          fetchTeamMembers(),
        ]);

        var templateRes = results[0];
        var versionRes = results[1];
        var termsRes = results[2];
        var exclusionsRes = results[3];
        var brandingRes = results[4];
        var senderRes = results[5];

        [templateRes, versionRes, termsRes, exclusionsRes, brandingRes, senderRes].forEach(function (result) {
          if (result && result.error && !isMissingFeature(result.error)) {
            throw result.error;
          }
        });

        state.templates = templateRes && Array.isArray(templateRes.data) ? templateRes.data : [];
        state.templateVersions = versionRes && Array.isArray(versionRes.data) ? versionRes.data : [];
        state.termsTemplates = termsRes && Array.isArray(termsRes.data) ? termsRes.data : [];
        state.exclusionsTemplates = exclusionsRes && Array.isArray(exclusionsRes.data) ? exclusionsRes.data : [];
        state.brandingProfile = brandingRes && brandingRes.data ? brandingRes.data : null;
        state.senderProfiles = senderRes && Array.isArray(senderRes.data) ? senderRes.data : [];
        state.currentUser = results[6] || null;
        state.teamMembers = Array.isArray(results[7]) ? results[7] : [];
        state.ready = true;
        return state;
      } catch (error) {
        state.ready = false;
        if (!isMissingFeature(error)) throw error;
        return state;
      } finally {
        state.loadPromise = null;
      }
    })();

    return state.loadPromise;
  }

  function senderProfileForUser(userId) {
    var id = clean(userId);
    if (!id) return null;
    return state.senderProfiles.find(function (row) { return clean(row.user_id) === id; }) || null;
  }

  function preferredTemplate(templateType) {
    var type = clean(templateType) || engine.TEMPLATE_TYPES.STANDARD_OPERATIONAL;
    return state.templates.find(function (row) {
      return clean(row.family) === type && clean(row.tenant_id) === currentTenantId();
    }) || state.templates.find(function (row) {
      return clean(row.family) === type && clean(row.tenant_id) === '';
    }) || null;
  }

  function preferredTemplateVersion(templateId) {
    return state.templateVersions.find(function (row) {
      return clean(row.template_id) === clean(templateId) && clean(row.status) === 'published';
    }) || state.templateVersions.find(function (row) {
      return clean(row.template_id) === clean(templateId);
    }) || null;
  }

  function defaultTermsTemplateForService(serviceType) {
    var type = clean(serviceType);
    return state.termsTemplates.find(function (row) {
      return clean(row.tenant_id) === currentTenantId() && clean(row.service_type) === type;
    }) || state.termsTemplates.find(function (row) {
      return clean(row.tenant_id) === '' && clean(row.service_type) === type;
    }) || state.termsTemplates.find(function (row) {
      return clean(row.tenant_id) === '' && clean(row.template_key) === 'system_default_terms';
    }) || state.termsTemplates[0] || null;
  }

  function defaultExclusionsTemplateForService(serviceType) {
    var type = clean(serviceType);
    return state.exclusionsTemplates.find(function (row) {
      return clean(row.tenant_id) === currentTenantId() && clean(row.service_type) === type;
    }) || state.exclusionsTemplates.find(function (row) {
      return clean(row.tenant_id) === '' && clean(row.service_type) === type;
    }) || state.exclusionsTemplates.find(function (row) {
      return clean(row.tenant_id) === '' && clean(row.template_key) === 'system_default_exclusions_general';
    }) || state.exclusionsTemplates[0] || null;
  }

  function defaultOptionFromBid(draft) {
    var totalCents = typeof calculateBidTotals === 'function'
      ? calculateBidTotals(draft || {}).total
      : Number(draft && draft.total_cents || 0);

    return {
      id: createLocalId('proposal_option'),
      option_type: 'option',
      option_title: clean(draft && draft.project_name) || clean(draft && draft.title) || 'Base scope',
      pricing_label: 'Investment',
      price_amount_cents: totalCents,
      price_unit: '',
      scope_content: clean(draft && draft.scope_of_work) || clean(draft && draft.proposed_solution) || clean(draft && draft.project_summary),
      fee_rows: [],
      notes: '',
      metadata: {
        auto_generated_from_bid: true,
      },
    };
  }

  function isAutoGeneratedProposalOption(option) {
    return !!(option
      && option.metadata
      && typeof option.metadata === 'object'
      && option.metadata.auto_generated_from_bid);
  }

  function syncAutoGeneratedProposalOption(option, draft) {
    var fallback = defaultOptionFromBid(draft);
    return Object.assign({}, fallback, {
      id: clean(option && option.id) || fallback.id,
      metadata: Object.assign({}, fallback.metadata, option && option.metadata && typeof option.metadata === 'object' ? option.metadata : {}),
    });
  }

  function normalizeProposalOptionDraft(option, index) {
    var normalized = engine.normalizeOption(option || {}, 'Option ' + String(index + 1));
    return {
      id: clean(option && option.id) || createLocalId('proposal_option'),
      option_type: clean(option && (option.option_type || option.optionType)) || normalized.optionType || 'option',
      option_title: clean(option && (option.option_title || option.optionTitle)) || normalized.optionTitle,
      pricing_label: clean(option && (option.pricing_label || option.pricingLabel)) || normalized.pricingLabel,
      price_amount_cents: Number(
        option && (
          option.price_amount_cents != null
            ? option.price_amount_cents
            : option.priceAmountCents != null
              ? option.priceAmountCents
              : normalized.priceAmountCents
        )
      ) || 0,
      price_unit: clean(option && (option.price_unit || option.priceUnit)) || normalized.priceUnit,
      scope_content: Array.isArray(option && option.scope_content)
        ? option.scope_content
        : Array.isArray(normalized.scopeContent) ? normalized.scopeContent : [],
      fee_rows: Array.isArray(option && option.fee_rows) ? option.fee_rows : normalized.feeRows,
      notes: clean(option && option.notes) || normalized.notes,
      metadata: option && option.metadata && typeof option.metadata === 'object'
        ? Object.assign({}, option.metadata)
        : {},
    };
  }

  function mapBidStatusToProposalStatus(statusValue) {
    var status = clean(statusValue).toLowerCase();
    if (status === 'sent') return 'sent';
    if (status === 'approved') return 'accepted';
    if (status === 'declined') return 'rejected';
    return 'draft';
  }

  function mergeDraftDefaults(draft) {
    var currentUserId = clean(state.currentUser && state.currentUser.id);
    var customer = typeof findBidCustomer === 'function' ? findBidCustomer(draft && draft.customer_id) : null;
    var defaultSenderId = clean(draft && draft.sender_user_id)
      || clean(draft && draft.prepared_by_user_id)
      || clean(state.brandingProfile && state.brandingProfile.default_sender_user_id)
      || currentUserId;
    var termsTemplate = defaultTermsTemplateForService(draft && draft.profile);
    var exclusionsTemplate = defaultExclusionsTemplateForService(draft && draft.profile);

    return Object.assign({}, draft || {}, {
      template_type: clean(draft && draft.template_type) || engine.TEMPLATE_TYPES.STANDARD_OPERATIONAL,
      prepared_by_user_id: clean(draft && draft.prepared_by_user_id) || currentUserId,
      sender_user_id: defaultSenderId,
      proposal_status: clean(draft && draft.proposal_status) || mapBidStatusToProposalStatus(draft && draft.status),
      proposal_revision_number: Number(draft && draft.proposal_revision_number || 1) || 1,
      project_name: clean(draft && draft.project_name) || clean(draft && draft.title) || (typeof defaultBidTitleFromDraft === 'function' ? defaultBidTitleFromDraft(draft) : 'Proposal'),
      subject_line: clean(draft && draft.subject_line) || clean(draft && draft.title),
      recipient_company: clean(draft && draft.recipient_company) || clean(customer && customer.company_name),
      recipient_address: clean(draft && draft.recipient_address) || clean(customer && (customer.service_address || customer.address)),
      attention_line: clean(draft && draft.attention_line) || clean(customer && customer.name) || clean(draft && draft.site_contact),
      intro_text: clean(draft && draft.intro_text) || clean(draft && draft.cover_note),
      value_proposition_text: clean(draft && draft.value_proposition_text) || clean(draft && draft.project_summary),
      proposal_notes: clean(draft && draft.proposal_notes),
      terms_override: clean(draft && draft.terms_override),
      exclusions_override: clean(draft && draft.exclusions_override),
      terms_template_id: clean(draft && draft.terms_template_id) || clean(state.brandingProfile && state.brandingProfile.default_terms_template_id) || clean(termsTemplate && termsTemplate.id),
      exclusions_template_id: clean(draft && draft.exclusions_template_id) || clean(state.brandingProfile && state.brandingProfile.default_exclusions_template_id) || clean(exclusionsTemplate && exclusionsTemplate.id),
      proposal_options: (Array.isArray(draft && draft.proposal_options) && draft.proposal_options.length
        ? draft.proposal_options.map(function (option) {
            return isAutoGeneratedProposalOption(option) ? syncAutoGeneratedProposalOption(option, draft) : option;
          })
        : [defaultOptionFromBid(draft)]).map(normalizeProposalOptionDraft),
    });
  }

  function buildViewModelForBid(draft) {
    var nextDraft = mergeDraftDefaults(draft);
    var customer = typeof findBidCustomer === 'function' ? findBidCustomer(nextDraft.customer_id) : null;
    var senderProfile = senderProfileForUser(nextDraft.sender_user_id);
    var defaultSenderProfile = senderProfileForUser(state.brandingProfile && state.brandingProfile.default_sender_user_id);
    var termsTemplate = state.termsTemplates.find(function (row) { return clean(row.id) === clean(nextDraft.terms_template_id); }) || null;
    var exclusionsTemplate = state.exclusionsTemplates.find(function (row) { return clean(row.id) === clean(nextDraft.exclusions_template_id); }) || null;

    return engine.buildProposalViewModel({
      document: {
        id: nextDraft.proposal_document_id,
        public_token: nextDraft.proposal_public_token,
        template_type: nextDraft.template_type,
        service_type: nextDraft.profile,
        status: nextDraft.proposal_status,
        proposal_date: nextDraft.walkthrough_at || nextDraft.created_at,
        expiration_date: nextDraft.valid_until,
        recipient_name: clean(customer && customer.name) || clean(nextDraft.site_contact),
        recipient_company: nextDraft.recipient_company,
        recipient_address: nextDraft.recipient_address,
        attention_line: nextDraft.attention_line,
        subject_line: nextDraft.subject_line,
        project_name: nextDraft.project_name,
        site_address: nextDraft.service_address,
        intro_text: nextDraft.intro_text,
        value_proposition_text: nextDraft.value_proposition_text,
        notes_text: nextDraft.proposal_notes,
        terms_override: nextDraft.terms_override,
        exclusions_override: nextDraft.exclusions_override,
        revision_number: nextDraft.proposal_revision_number,
      },
      options: nextDraft.proposal_options,
      tenantBrandingProfile: state.brandingProfile || {},
      tenant: (typeof SETUP_STATE !== 'undefined' && (SETUP_STATE.locked_record || SETUP_STATE.tenant)) || {},
      setupConfig: (typeof SETUP_STATE !== 'undefined' && SETUP_STATE.config) || {},
      senderProfile: senderProfile || {},
      defaultSenderProfile: defaultSenderProfile || {},
      termsTemplate: termsTemplate || {},
      exclusionsTemplate: exclusionsTemplate || {},
      serviceType: nextDraft.profile,
    });
  }

  function templateChoices() {
    return [
      { value: engine.TEMPLATE_TYPES.STANDARD_OPERATIONAL, label: 'Standard operational proposal' },
      { value: engine.TEMPLATE_TYPES.FORMAL_VENDOR, label: 'Formal vendor proposal' },
    ];
  }

  function senderChoices() {
    var profilesByUser = new Map(state.senderProfiles.map(function (row) { return [clean(row.user_id), row]; }));
    return state.teamMembers.map(function (member) {
      var userId = clean(member.user_id);
      var profile = profilesByUser.get(userId);
      var label = clean(profile && profile.full_name) || clean(profile && profile.name) || clean(member.name) || clean(member.email) || userId;
      return {
        value: userId,
        label: label,
        detail: clean(profile && profile.job_title) || clean(member.role),
      };
    }).filter(function (row) { return row.value; });
  }

  function termsChoices(serviceType) {
    var normalizedService = clean(serviceType);
    return state.termsTemplates.filter(function (row) {
      return !normalizedService || !clean(row.service_type) || clean(row.service_type) === normalizedService || clean(row.service_type) === engine.TEMPLATE_TYPES.FORMAL_VENDOR;
    });
  }

  function exclusionsChoices(serviceType) {
    var normalizedService = clean(serviceType);
    return state.exclusionsTemplates.filter(function (row) {
      return !normalizedService || !clean(row.service_type) || clean(row.service_type) === normalizedService;
    });
  }

  function brandSetupStatus() {
    var branding = engine.buildBranding({
      profile: state.brandingProfile || {},
      legacyTenant: (typeof SETUP_STATE !== 'undefined' && (SETUP_STATE.locked_record || SETUP_STATE.tenant)) || {},
      setupConfig: (typeof SETUP_STATE !== 'undefined' && SETUP_STATE.config) || {},
    });
    var defaultSender = senderProfileForUser(state.brandingProfile && state.brandingProfile.default_sender_user_id);
    var termsTemplate = state.termsTemplates.find(function (row) {
      return clean(row.id) === clean(state.brandingProfile && state.brandingProfile.default_terms_template_id);
    });
    var exclusionsTemplate = state.exclusionsTemplates.find(function (row) {
      return clean(row.id) === clean(state.brandingProfile && state.brandingProfile.default_exclusions_template_id);
    });

    return {
      companyName: !clean(branding.companyName).match(/^Brand identity pending$/),
      logo: !!branding.hasLogo,
      defaultTerms: !!termsTemplate,
      defaultExclusions: !!exclusionsTemplate,
      defaultSigner: !!defaultSender,
      defaultSignerSignature: !!clean(defaultSender && defaultSender.signature_image_url),
      branding: branding,
    };
  }

  async function hydrateDrafts(drafts) {
    await loadSupport();
    var rows = Array.isArray(drafts) ? drafts.map(function (draft) { return mergeDraftDefaults(draft); }) : [];
    var bidIds = rows.map(function (draft) {
      return typeof bidRecordId === 'function' ? bidRecordId(draft) : clean(draft.record_id);
    }).filter(Boolean);
    if (!bidIds.length || typeof sb === 'undefined') return rows;

    var documentsRes = await sb.from('proposal_documents').select('*').in('bid_id', bidIds);
    if (documentsRes.error && !isMissingFeature(documentsRes.error)) throw documentsRes.error;
    var documents = Array.isArray(documentsRes.data) ? documentsRes.data : [];
    var documentIds = documents.map(function (row) { return row.id; }).filter(Boolean);
    var optionsByDocumentId = new Map();

    if (documentIds.length) {
      var optionsRes = await sb.from('proposal_options').select('*').in('proposal_document_id', documentIds).order('sort_order', { ascending: true });
      if (optionsRes.error && !isMissingFeature(optionsRes.error)) throw optionsRes.error;
      (Array.isArray(optionsRes.data) ? optionsRes.data : []).forEach(function (row) {
        var key = clean(row.proposal_document_id);
        var bucket = optionsByDocumentId.get(key) || [];
        bucket.push(row);
        optionsByDocumentId.set(key, bucket);
      });
    }

    var documentsByBidId = new Map(documents.map(function (row) { return [clean(row.bid_id), row]; }));
    return rows.map(function (draft) {
      var recordId = typeof bidRecordId === 'function' ? bidRecordId(draft) : clean(draft.record_id);
      var doc = documentsByBidId.get(clean(recordId));
      if (!doc) return mergeDraftDefaults(draft);
      return mergeDraftDefaults(Object.assign({}, draft, {
        proposal_document_id: doc.id,
        proposal_public_token: clean(doc.public_token),
        proposal_status: clean(doc.status),
        proposal_revision_number: Number(doc.revision_number || 1),
        template_type: clean(doc.template_type),
        prepared_by_user_id: clean(doc.prepared_by_user_id),
        sender_user_id: clean(doc.sender_user_id),
        recipient_company: clean(doc.recipient_company),
        recipient_address: clean(doc.recipient_address),
        attention_line: clean(doc.attention_line),
        subject_line: clean(doc.subject_line),
        project_name: clean(doc.project_name),
        intro_text: clean(doc.intro_text),
        value_proposition_text: clean(doc.value_proposition_text),
        proposal_notes: clean(doc.notes_text),
        terms_template_id: clean(doc.terms_template_id),
        exclusions_template_id: clean(doc.exclusions_template_id),
        terms_override: clean(doc.terms_override),
        exclusions_override: clean(doc.exclusions_override),
        proposal_options: (optionsByDocumentId.get(clean(doc.id)) || []).map(function (row, index) {
          return normalizeProposalOptionDraft(row, index);
        }),
      }));
    });
  }

  async function syncFromBidDraft(draft, options) {
    var nextDraft = mergeDraftDefaults(draft);
    var recordId = typeof bidRecordId === 'function' ? bidRecordId(nextDraft) : clean(nextDraft.record_id);
    if (!recordId || typeof sb === 'undefined') return nextDraft;

    await loadSupport();

    var customer = typeof findBidCustomer === 'function' ? findBidCustomer(nextDraft.customer_id) : null;
    var viewModel = buildViewModelForBid(nextDraft);
    var template = preferredTemplate(nextDraft.template_type);
    var templateVersion = preferredTemplateVersion(template && template.id);
    var currentUserId = clean(state.currentUser && state.currentUser.id);
    var existing = null;

    if (clean(nextDraft.proposal_document_id)) {
      var existingById = await sb.from('proposal_documents')
        .select('id, revision_number, public_token, created_by_user_id')
        .eq('id', nextDraft.proposal_document_id)
        .maybeSingle();
      existing = existingById && existingById.data ? existingById.data : null;
    }
    if (!existing) {
      var existingByBid = await sb.from('proposal_documents')
        .select('id, revision_number, public_token, created_by_user_id')
        .eq('bid_id', recordId)
        .maybeSingle();
      existing = existingByBid && existingByBid.data ? existingByBid.data : null;
    }

    var shouldCreateVersion = !!(options && options.createVersion);
    var revisionNumber = existing ? Number(existing.revision_number || 1) : Number(nextDraft.proposal_revision_number || 1);
    if (shouldCreateVersion) revisionNumber += existing ? 1 : 0;

    var documentPayload = {
      tenant_id: currentTenantId(),
      bid_id: recordId,
      customer_id: nextDraft.customer_id || null,
      job_id: nextDraft.job_id || null,
      created_by_user_id: clean(existing && existing.created_by_user_id) || currentUserId || null,
      prepared_by_user_id: nextDraft.prepared_by_user_id || currentUserId || null,
      sender_user_id: nextDraft.sender_user_id || currentUserId || null,
      template_id: clean(template && template.id) || null,
      template_version_id: clean(templateVersion && templateVersion.id) || null,
      template_type: nextDraft.template_type,
      service_type: nextDraft.profile || null,
      proposal_date: nextDraft.walkthrough_at ? String(nextDraft.walkthrough_at).slice(0, 10) : String(new Date().toISOString()).slice(0, 10),
      expiration_date: nextDraft.valid_until || null,
      recipient_name: clean(customer && customer.name) || clean(nextDraft.site_contact) || null,
      recipient_company: nextDraft.recipient_company || null,
      recipient_address: nextDraft.recipient_address || null,
      attention_line: nextDraft.attention_line || null,
      subject_line: nextDraft.subject_line || null,
      project_name: nextDraft.project_name || null,
      site_address: nextDraft.service_address || null,
      intro_text: nextDraft.intro_text || null,
      value_proposition_text: nextDraft.value_proposition_text || null,
      notes_text: nextDraft.proposal_notes || null,
      terms_template_id: nextDraft.terms_template_id || null,
      exclusions_template_id: nextDraft.exclusions_template_id || null,
      terms_override: nextDraft.terms_override || null,
      exclusions_override: nextDraft.exclusions_override || null,
      status: nextDraft.proposal_status || 'draft',
      revision_number: revisionNumber,
      render_state: viewModel,
      rendered_html_snapshot: engine.renderDocumentBody(viewModel),
      updated_at: new Date().toISOString(),
    };

    var savedDoc;
    if (existing && clean(existing.id)) {
      var updateResult = await sb.from('proposal_documents')
        .update(documentPayload)
        .eq('id', existing.id)
        .select('*')
        .single();
      if (updateResult.error) throw updateResult.error;
      savedDoc = updateResult.data;
    } else {
      var insertResult = await sb.from('proposal_documents')
        .insert(documentPayload)
        .select('*')
        .single();
      if (insertResult.error) throw insertResult.error;
      savedDoc = insertResult.data;
    }

    var optionRows = nextDraft.proposal_options.map(function (option, index) {
      var normalized = normalizeProposalOptionDraft(option, index);
      return {
        proposal_document_id: savedDoc.id,
        tenant_id: currentTenantId(),
        sort_order: index,
        option_type: normalized.option_type,
        option_title: normalized.option_title,
        pricing_label: normalized.pricing_label || null,
        price_amount_cents: Number(normalized.price_amount_cents || 0),
        price_unit: normalized.price_unit || null,
        scope_content: normalized.scope_content || [],
        fee_rows: normalized.fee_rows || [],
        notes: normalized.notes || null,
        metadata: normalized.metadata || {},
      };
    });

    var deleteResult = await sb.from('proposal_options')
      .delete()
      .eq('proposal_document_id', savedDoc.id);
    if (deleteResult.error) throw deleteResult.error;

    if (optionRows.length) {
      var optionInsertResult = await sb.from('proposal_options').insert(optionRows);
      if (optionInsertResult.error) throw optionInsertResult.error;
    }

    if (shouldCreateVersion) {
      var versionInsertResult = await sb.from('proposal_document_versions').insert({
        proposal_document_id: savedDoc.id,
        tenant_id: currentTenantId(),
        revision_number: Number(savedDoc.revision_number || revisionNumber),
        created_by_user_id: currentUserId || null,
        trigger_event: options && options.triggerEvent ? options.triggerEvent : 'manual_save',
        status: savedDoc.status,
        template_version_id: savedDoc.template_version_id,
        render_state: viewModel,
        rendered_html_snapshot: savedDoc.rendered_html_snapshot,
        branding_snapshot: viewModel.branding || {},
        sender_snapshot: viewModel.sender || {},
        options_snapshot: viewModel.options || [],
      });
      if (versionInsertResult.error) throw versionInsertResult.error;
    }

    return Object.assign({}, nextDraft, {
      proposal_document_id: savedDoc.id,
      proposal_public_token: clean(savedDoc.public_token),
      proposal_revision_number: Number(savedDoc.revision_number || revisionNumber),
      proposal_status: clean(savedDoc.status) || nextDraft.proposal_status,
      proposal_options: nextDraft.proposal_options.map(normalizeProposalOptionDraft),
    });
  }

  global.PROOFLINK_OPERATOR_PROPOSAL_DOCUMENTS = {
    loadSupport: loadSupport,
    buildViewModelForBid: buildViewModelForBid,
    syncFromBidDraft: syncFromBidDraft,
    hydrateDrafts: hydrateDrafts,
    brandSetupStatus: brandSetupStatus,
    templateChoices: templateChoices,
    termsChoices: termsChoices,
    exclusionsChoices: exclusionsChoices,
    senderChoices: senderChoices,
    mergeDraftDefaults: mergeDraftDefaults,
    senderProfileForUser: senderProfileForUser,
    defaultTermsTemplateForService: defaultTermsTemplateForService,
    defaultExclusionsTemplateForService: defaultExclusionsTemplateForService,
  };
})(window);
