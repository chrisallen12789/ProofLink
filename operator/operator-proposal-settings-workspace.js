// Proposal defaults workspace so proposal branding, signer profiles,
// and reusable defaults have a permanent home in More tools.
(function attachProposalSettingsWorkspace(global) {
  let PROPOSAL_SETTINGS_STATE = {
    loaded: false,
    brandingProfile: null,
    senderProfiles: [],
    teamMembers: [],
    termsTemplates: [],
    exclusionsTemplates: [],
    currentUser: null,
  };
  let PROPOSAL_SETTINGS_LOADING = null;
  let PROPOSAL_SETTINGS_BOUND = false;
  let PROPOSAL_SETTINGS_PENDING_FOCUS = '';

  const FOCUS_TARGETS = {
    companyName: 'proposalBrandingCompanyName',
    logo: 'proposalBrandingLogoUrl',
    defaultTerms: 'proposalBrandingDefaultTerms',
    defaultExclusions: 'proposalBrandingDefaultExclusions',
    defaultSigner: 'proposalBrandingDefaultSenderUser',
    defaultSignerSignature: 'proposalSenderSignatureImageUrl',
  };

  function proposalSettingsApi() {
    return global.PROOFLINK_OPERATOR_PROPOSAL_DOCUMENTS || null;
  }

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function panelElement(id) {
    return document.getElementById(id);
  }

  function titleCase(value) {
    const raw = clean(value).replace(/[_-]+/g, ' ');
    return raw ? raw.replace(/\b\w/g, (match) => match.toUpperCase()) : '';
  }

  function setProposalSettingsMessage(id, message = '', tone = '') {
    const element = panelElement(id);
    if (!element) return;
    element.className = `msg${tone ? ` ${tone}` : ''}`;
    element.textContent = message;
  }

  function setProposalSettingsCopy(id, message = '') {
    const element = panelElement(id);
    if (!element) return;
    element.textContent = message;
  }

  async function fetchProposalSettingsTeamMembers() {
    const runtime = global.PROOFLINK_OPERATOR_RUNTIME || {};
    const token = typeof runtime.getAccessToken === 'function'
      ? await runtime.getAccessToken().catch(() => '')
      : '';
    const response = await fetch('/.netlify/functions/manage-operator-members', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load team members.');
    return Array.isArray(data.members) ? data.members : [];
  }

  async function fetchProposalSettingsSupport(force = false) {
    if (PROPOSAL_SETTINGS_STATE.loaded && !force) return PROPOSAL_SETTINGS_STATE;
    if (PROPOSAL_SETTINGS_LOADING && !force) return PROPOSAL_SETTINGS_LOADING;

    PROPOSAL_SETTINGS_LOADING = (async () => {
      if (proposalSettingsApi()?.loadSupport) {
        try {
          await proposalSettingsApi().loadSupport(force);
        } catch (_) {
          // The dedicated settings panel still queries the source tables directly.
        }
      }

      const [brandingRes, senderRes, termsRes, exclusionsRes, currentUser, teamMembers] = await Promise.all([
        sb.from('tenant_branding_profiles').select('*').eq('tenant_id', TENANT_ID).maybeSingle(),
        sb.from('user_document_profiles').select('*').eq('tenant_id', TENANT_ID).order('updated_at', { ascending: false }),
        sb.from('reusable_terms_templates').select('*').order('name', { ascending: true }),
        sb.from('reusable_exclusions_templates').select('*').order('name', { ascending: true }),
        typeof getUser === 'function' ? getUser().catch(() => null) : Promise.resolve(null),
        fetchProposalSettingsTeamMembers().catch(() => []),
      ]);

      [brandingRes, senderRes, termsRes, exclusionsRes].forEach((result) => {
        if (result?.error) throw result.error;
      });

      PROPOSAL_SETTINGS_STATE = {
        loaded: true,
        brandingProfile: brandingRes?.data || null,
        senderProfiles: Array.isArray(senderRes?.data) ? senderRes.data : [],
        teamMembers: Array.isArray(teamMembers) ? teamMembers : [],
        termsTemplates: Array.isArray(termsRes?.data) ? termsRes.data : [],
        exclusionsTemplates: Array.isArray(exclusionsRes?.data) ? exclusionsRes.data : [],
        currentUser: currentUser || null,
      };

      return PROPOSAL_SETTINGS_STATE;
    })();

    try {
      return await PROPOSAL_SETTINGS_LOADING;
    } finally {
      PROPOSAL_SETTINGS_LOADING = null;
    }
  }

  function brandingSnapshot() {
    const api = proposalSettingsApi();
    return api?.brandSetupStatus?.() || {};
  }

  function termsChoices() {
    return (PROPOSAL_SETTINGS_STATE.termsTemplates || []).filter((row) => row?.active !== false);
  }

  function exclusionsChoices() {
    return (PROPOSAL_SETTINGS_STATE.exclusionsTemplates || []).filter((row) => row?.active !== false);
  }

  function senderProfileForUser(userId) {
    const target = clean(userId);
    if (!target) return null;
    return (PROPOSAL_SETTINGS_STATE.senderProfiles || []).find((row) => clean(row.user_id) === target) || null;
  }

  function teamMemberForUser(userId) {
    const target = clean(userId);
    if (!target) return null;
    return (PROPOSAL_SETTINGS_STATE.teamMembers || []).find((row) => clean(row.user_id) === target) || null;
  }

  function currentUserId() {
    return clean(PROPOSAL_SETTINGS_STATE.currentUser?.id);
  }

  function currentUserEmail() {
    return clean(PROPOSAL_SETTINGS_STATE.currentUser?.email);
  }

  function senderChoices() {
    const ids = new Set();
    const rows = [];
    const defaultSenderUserId = clean(PROPOSAL_SETTINGS_STATE.brandingProfile?.default_sender_user_id);
    const currentId = currentUserId();

    (PROPOSAL_SETTINGS_STATE.teamMembers || []).forEach((member) => {
      const userId = clean(member.user_id);
      if (userId) ids.add(userId);
    });
    (PROPOSAL_SETTINGS_STATE.senderProfiles || []).forEach((profile) => {
      const userId = clean(profile.user_id);
      if (userId) ids.add(userId);
    });
    if (defaultSenderUserId) ids.add(defaultSenderUserId);
    if (currentId) ids.add(currentId);

    ids.forEach((userId) => {
      const profile = senderProfileForUser(userId);
      const member = teamMemberForUser(userId);
      const isCurrent = userId === currentId;
      const label = clean(profile?.full_name)
        || clean(member?.name)
        || (isCurrent ? currentUserEmail() : '')
        || userId;
      const detail = clean(profile?.job_title) || clean(member?.role) || (isCurrent ? 'Current user' : '');
      rows.push({
        value: userId,
        label,
        detail,
      });
    });

    return rows.sort((left, right) => {
      if (left.value === defaultSenderUserId) return -1;
      if (right.value === defaultSenderUserId) return 1;
      return left.label.localeCompare(right.label);
    });
  }

  function selectHtml(options, selectedValue, placeholder) {
    const selected = clean(selectedValue);
    const rows = [
      `<option value="">${escapeHtml(placeholder || 'Select')}</option>`,
      ...(options || []).map((option) => {
        const value = clean(option?.value ?? option?.id);
        const label = clean(option?.label || option?.name || value);
        const detail = clean(option?.detail);
        const suffix = detail ? ` - ${detail}` : '';
        return `<option value="${escapeAttr(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(`${label}${suffix}`)}</option>`;
      }),
    ];
    return rows.join('');
  }

  function validateOptionalUrl(rawValue, label) {
    const raw = clean(rawValue);
    if (!raw) return null;
    const normalized = typeof cleanUrl === 'function' ? cleanUrl(raw) : raw;
    if (!normalized) throw new Error(`${label} needs a valid http or https URL.`);
    return normalized;
  }

  function preferredSenderUserId() {
    return clean(panelElement('proposalSenderProfileUser')?.value)
      || clean(panelElement('proposalBrandingDefaultSenderUser')?.value)
      || clean(PROPOSAL_SETTINGS_STATE.brandingProfile?.default_sender_user_id)
      || clean(senderChoices()[0]?.value);
  }

  function fillSenderProfileFields(userId) {
    const nextUserId = clean(userId) || clean(senderChoices()[0]?.value);
    const profile = senderProfileForUser(nextUserId);
    const member = teamMemberForUser(nextUserId);
    const isCurrentUser = nextUserId && nextUserId === currentUserId();

    if (panelElement('proposalSenderProfileUser')) {
      panelElement('proposalSenderProfileUser').value = nextUserId;
    }
    if (panelElement('proposalSenderFullName')) {
      panelElement('proposalSenderFullName').value = clean(profile?.full_name) || clean(member?.name);
    }
    if (panelElement('proposalSenderJobTitle')) {
      panelElement('proposalSenderJobTitle').value = clean(profile?.job_title) || titleCase(member?.role || '') || 'Authorized representative';
    }
    if (panelElement('proposalSenderEmail')) {
      panelElement('proposalSenderEmail').value = clean(profile?.email) || (isCurrentUser ? currentUserEmail() : '');
    }
    if (panelElement('proposalSenderPhone')) {
      panelElement('proposalSenderPhone').value = clean(profile?.phone);
    }
    if (panelElement('proposalSenderSignatureImageUrl')) {
      panelElement('proposalSenderSignatureImageUrl').value = clean(profile?.signature_image_url);
    }
    if (panelElement('proposalSenderInitials')) {
      panelElement('proposalSenderInitials').value = clean(profile?.initials);
    }
    if (panelElement('proposalSenderIsDefault')) {
      panelElement('proposalSenderIsDefault').checked = !!profile?.is_default_signer || nextUserId === clean(PROPOSAL_SETTINGS_STATE.brandingProfile?.default_sender_user_id);
    }
  }

  function renderProposalSettingsStatus() {
    const element = panelElement('proposalSettingsStatus');
    if (!element) return;
    const status = brandingSnapshot();
    const rows = [
      { label: 'Company name', ready: !!status.companyName },
      { label: 'Logo', ready: !!status.logo },
      { label: 'Default terms', ready: !!status.defaultTerms },
      { label: 'Default exclusions', ready: !!status.defaultExclusions },
      { label: 'Default signer', ready: !!status.defaultSigner },
      { label: 'Signer signature image', ready: !!status.defaultSignerSignature },
    ];

    element.innerHTML = rows.map((row) => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0;">
        <span>${escapeHtml(row.label)}</span>
        <span class="pill ${row.ready ? 'pill-on' : 'pill-muted'}">${row.ready ? 'Ready' : 'Needs setup'}</span>
      </div>
    `).join('');
  }

  function renderProposalSettingsWorkspace(options = {}) {
    const brandingProfile = PROPOSAL_SETTINGS_STATE.brandingProfile || {};
    const brand = brandingSnapshot().branding || {};
    const senderOptions = senderChoices();
    const defaultSenderUserId = clean(brandingProfile.default_sender_user_id) || clean(senderOptions[0]?.value);
    const nextSenderUserId = clean(options.focusSenderUserId) || preferredSenderUserId() || defaultSenderUserId;

    if (panelElement('proposalBrandingCompanyName')) {
      const fallbackName = clean(brand.companyName) === 'Brand identity pending' ? '' : clean(brand.companyName);
      panelElement('proposalBrandingCompanyName').value = clean(brandingProfile.company_name) || fallbackName;
    }
    if (panelElement('proposalBrandingLogoUrl')) {
      panelElement('proposalBrandingLogoUrl').value = clean(brandingProfile.logo_image_url) || clean(brand.logoUrl);
    }
    if (panelElement('proposalBrandingDefaultTerms')) {
      panelElement('proposalBrandingDefaultTerms').innerHTML = selectHtml(
        termsChoices().map((row) => ({
          value: row.id,
          label: row.name,
          detail: clean(row.service_type) ? titleCase(row.service_type) : 'All proposals',
        })),
        brandingProfile.default_terms_template_id,
        'Choose default terms'
      );
    }
    if (panelElement('proposalBrandingDefaultExclusions')) {
      panelElement('proposalBrandingDefaultExclusions').innerHTML = selectHtml(
        exclusionsChoices().map((row) => ({
          value: row.id,
          label: row.name,
          detail: clean(row.service_type) ? titleCase(row.service_type) : 'All proposals',
        })),
        brandingProfile.default_exclusions_template_id,
        'Choose default exclusions'
      );
    }
    if (panelElement('proposalBrandingDefaultSenderUser')) {
      panelElement('proposalBrandingDefaultSenderUser').innerHTML = selectHtml(senderOptions, defaultSenderUserId, 'Choose default signer');
      panelElement('proposalBrandingDefaultSenderUser').value = defaultSenderUserId;
    }
    if (panelElement('proposalSenderProfileUser')) {
      panelElement('proposalSenderProfileUser').innerHTML = selectHtml(senderOptions, nextSenderUserId, 'Choose a team member');
      panelElement('proposalSenderProfileUser').value = nextSenderUserId;
    }

    fillSenderProfileFields(nextSenderUserId);
    renderProposalSettingsStatus();
  }

  async function ensureSenderProfile(userId) {
    const nextUserId = clean(userId);
    if (!nextUserId) return null;
    const existing = senderProfileForUser(nextUserId);
    if (existing) return existing;

    const member = teamMemberForUser(nextUserId);
    const payload = {
      tenant_id: TENANT_ID,
      user_id: nextUserId,
      full_name: clean(member?.name) || (nextUserId === currentUserId() ? currentUserEmail() : '') || nextUserId,
      job_title: titleCase(member?.role || '') || 'Authorized representative',
      active: true,
      updated_by_user_id: currentUserId() || null,
      created_by_user_id: currentUserId() || null,
    };
    const { data, error } = await sb
      .from('user_document_profiles')
      .upsert(payload, { onConflict: 'tenant_id,user_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data || null;
  }

  async function refreshProposalSettingsWorkspace(options = {}) {
    await fetchProposalSettingsSupport(true);
    if (proposalSettingsApi()?.loadSupport) {
      try {
        await proposalSettingsApi().loadSupport(true);
      } catch (_) {
        // Keep the settings panel usable even if the lightweight helper is unavailable.
      }
    }
    renderProposalSettingsWorkspace(options);
    if (typeof renderBids === 'function') {
      renderBids(panelElement('bidSearch')?.value || '', { preserveForm: true });
    }
  }

  async function saveProposalBrandingSettings(event) {
    event?.preventDefault?.();
    setProposalSettingsMessage('proposalBrandingSettingsMsg', 'Saving proposal defaults...');

    try {
      const companyName = clean(panelElement('proposalBrandingCompanyName')?.value) || null;
      const logoImageUrl = validateOptionalUrl(panelElement('proposalBrandingLogoUrl')?.value, 'Logo URL');
      const defaultTermsTemplateId = clean(panelElement('proposalBrandingDefaultTerms')?.value) || null;
      const defaultExclusionsTemplateId = clean(panelElement('proposalBrandingDefaultExclusions')?.value) || null;
      const defaultSenderUserId = clean(panelElement('proposalBrandingDefaultSenderUser')?.value) || null;

      if (defaultSenderUserId) {
        await ensureSenderProfile(defaultSenderUserId);
      }

      const payload = {
        tenant_id: TENANT_ID,
        company_name: companyName,
        logo_image_url: logoImageUrl,
        default_terms_template_id: defaultTermsTemplateId,
        default_exclusions_template_id: defaultExclusionsTemplateId,
        default_sender_user_id: defaultSenderUserId,
        updated_by_user_id: currentUserId() || null,
        ...(PROPOSAL_SETTINGS_STATE.brandingProfile ? {} : { created_by_user_id: currentUserId() || null }),
      };

      const { error } = await sb.from('tenant_branding_profiles').upsert(payload, { onConflict: 'tenant_id' });
      if (error) throw error;

      await refreshProposalSettingsWorkspace({ focusSenderUserId: defaultSenderUserId });
      setProposalSettingsMessage('proposalBrandingSettingsMsg', 'Proposal defaults saved.', 'good');
    } catch (error) {
      setProposalSettingsMessage('proposalBrandingSettingsMsg', error.message || String(error), 'bad');
    }
  }

  async function saveProposalSenderProfile(event) {
    event?.preventDefault?.();
    setProposalSettingsMessage('proposalSenderProfileMsg', 'Saving signer profile...');

    try {
      const userId = clean(panelElement('proposalSenderProfileUser')?.value);
      if (!userId) throw new Error('Choose a team member first.');

      const signatureImageUrl = validateOptionalUrl(panelElement('proposalSenderSignatureImageUrl')?.value, 'Signature image URL');
      const makeDefault = !!panelElement('proposalSenderIsDefault')?.checked;

      if (makeDefault) {
        const { error: clearError } = await sb
          .from('user_document_profiles')
          .update({ is_default_signer: false, updated_by_user_id: currentUserId() || null })
          .eq('tenant_id', TENANT_ID)
          .eq('is_default_signer', true)
          .neq('user_id', userId);
        if (clearError) throw clearError;
      }

      const payload = {
        tenant_id: TENANT_ID,
        user_id: userId,
        full_name: clean(panelElement('proposalSenderFullName')?.value) || null,
        job_title: clean(panelElement('proposalSenderJobTitle')?.value) || null,
        email: clean(panelElement('proposalSenderEmail')?.value) || null,
        phone: clean(panelElement('proposalSenderPhone')?.value) || null,
        signature_image_url: signatureImageUrl,
        initials: clean(panelElement('proposalSenderInitials')?.value) || null,
        is_default_signer: makeDefault,
        active: true,
        updated_by_user_id: currentUserId() || null,
        ...(senderProfileForUser(userId) ? {} : { created_by_user_id: currentUserId() || null }),
      };

      const { error } = await sb.from('user_document_profiles').upsert(payload, { onConflict: 'tenant_id,user_id' });
      if (error) throw error;

      if (makeDefault) {
        const { error: brandingError } = await sb.from('tenant_branding_profiles').upsert({
          tenant_id: TENANT_ID,
          default_sender_user_id: userId,
          updated_by_user_id: currentUserId() || null,
          ...(PROPOSAL_SETTINGS_STATE.brandingProfile ? {} : { created_by_user_id: currentUserId() || null }),
        }, { onConflict: 'tenant_id' });
        if (brandingError) throw brandingError;
      }

      await refreshProposalSettingsWorkspace({ focusSenderUserId: userId });
      if (panelElement('proposalBrandingDefaultSenderUser')) {
        panelElement('proposalBrandingDefaultSenderUser').value = makeDefault ? userId : clean(panelElement('proposalBrandingDefaultSenderUser').value);
      }
      setProposalSettingsMessage('proposalSenderProfileMsg', 'Signer profile saved.', 'good');
    } catch (error) {
      setProposalSettingsMessage('proposalSenderProfileMsg', error.message || String(error), 'bad');
    }
  }

  async function uploadProposalSettingsAsset(fileInputId, urlInputId, statusId, slot) {
    const file = panelElement(fileInputId)?.files?.[0];
    if (!file) {
      setProposalSettingsCopy(statusId, 'Choose a file first.');
      return;
    }
    const uploader = global.PROOFLINK_OPERATOR_SETUP_WORKSPACE?.uploadSetupAsset || global.uploadSetupAsset;
    if (typeof uploader !== 'function') {
      setProposalSettingsCopy(statusId, 'Upload tools are not ready yet.');
      return;
    }
    try {
      setProposalSettingsCopy(statusId, 'Uploading...');
      const uploadedUrl = await uploader(file, slot);
      if (panelElement(urlInputId)) panelElement(urlInputId).value = uploadedUrl;
      setProposalSettingsCopy(statusId, 'Upload finished. Save to keep it.');
    } catch (error) {
      setProposalSettingsCopy(statusId, error.message || String(error));
    }
  }

  function focusProposalSettingsField(focusKey = '') {
    const targetId = FOCUS_TARGETS[clean(focusKey)] || clean(focusKey);
    const target = targetId ? panelElement(targetId) : null;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('setup-focus-flash');
    window.setTimeout(() => target.classList.remove('setup-focus-flash'), 900);
    if (typeof target.focus === 'function') target.focus({ preventScroll: true });
  }

  async function loadProposalSettingsWorkspace(options = {}) {
    const statusElement = panelElement('proposalSettingsStatus');
    if (statusElement && !PROPOSAL_SETTINGS_STATE.loaded) {
      statusElement.textContent = 'Loading proposal settings...';
    }
    await fetchProposalSettingsSupport(!!options.force);
    renderProposalSettingsWorkspace(options);
    const focusKey = clean(options.focusKey) || clean(PROPOSAL_SETTINGS_PENDING_FOCUS);
    if (focusKey) {
      PROPOSAL_SETTINGS_PENDING_FOCUS = '';
      window.setTimeout(() => focusProposalSettingsField(focusKey), 60);
    }
  }

  async function openProposalSettingsPanel(focusKey = '') {
    PROPOSAL_SETTINGS_PENDING_FOCUS = clean(focusKey);
    if (typeof setSidebarMoreOpen === 'function' && typeof isSidebarMoreOpen === 'function' && !isSidebarMoreOpen()) {
      setSidebarMoreOpen(true);
    }
    if (typeof switchTab === 'function') {
      const changed = await switchTab('proposal-settings');
      if (changed === false) return false;
    }
    await loadProposalSettingsWorkspace({ focusKey: PROPOSAL_SETTINGS_PENDING_FOCUS });
    return true;
  }

  function initProposalSettingsWorkspaceBindings() {
    if (PROPOSAL_SETTINGS_BOUND) return;
    PROPOSAL_SETTINGS_BOUND = true;

    panelElement('btnRefreshProposalSettings')?.addEventListener('click', () => {
      loadProposalSettingsWorkspace({ force: true }).catch((error) => {
        setProposalSettingsMessage('proposalBrandingSettingsMsg', error.message || String(error), 'bad');
      });
    });

    panelElement('proposalBrandingSettingsForm')?.addEventListener('submit', saveProposalBrandingSettings);
    panelElement('proposalSenderProfileForm')?.addEventListener('submit', saveProposalSenderProfile);

    panelElement('proposalBrandingDefaultSenderUser')?.addEventListener('change', () => {
      const nextUserId = clean(panelElement('proposalBrandingDefaultSenderUser')?.value);
      if (panelElement('proposalSenderProfileUser')) {
        panelElement('proposalSenderProfileUser').value = nextUserId;
      }
      fillSenderProfileFields(nextUserId);
    });

    panelElement('proposalSenderProfileUser')?.addEventListener('change', () => {
      fillSenderProfileFields(clean(panelElement('proposalSenderProfileUser')?.value));
    });

    panelElement('btnUploadProposalBrandLogo')?.addEventListener('click', () => {
      uploadProposalSettingsAsset('proposalBrandingLogoFile', 'proposalBrandingLogoUrl', 'proposalBrandingLogoStatus', 'proposal_logo').catch(console.error);
    });

    panelElement('btnUploadProposalSenderSignature')?.addEventListener('click', () => {
      uploadProposalSettingsAsset('proposalSenderSignatureFile', 'proposalSenderSignatureImageUrl', 'proposalSenderSignatureStatus', 'proposal_signature').catch(console.error);
    });
  }

  initProposalSettingsWorkspaceBindings();
  if (document.querySelector('.panel[data-panel="proposal-settings"]') && !document.querySelector('.panel[data-panel="proposal-settings"]')?.classList.contains('hidden')) {
    loadProposalSettingsWorkspace().catch(console.error);
  }

  const helpers = {
    loadProposalSettingsWorkspace,
    openProposalSettingsPanel,
    refreshProposalSettingsWorkspace,
    focusProposalSettingsField,
    initProposalSettingsWorkspaceBindings,
  };

  global.PROOFLINK_OPERATOR_PROPOSAL_SETTINGS_WORKSPACE = {
    ...(global.PROOFLINK_OPERATOR_PROPOSAL_SETTINGS_WORKSPACE || {}),
    ...helpers,
  };

  Object.assign(global, helpers);
})(window);
