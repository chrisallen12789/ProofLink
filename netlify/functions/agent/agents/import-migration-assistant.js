'use strict';

const ImportTools = require('../../../../operator/components/import-tools.js');
const { buildRecordRef, createEvidenceBuilder } = require('../evidence');

function compact(value) {
  return String(value || '').trim();
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .slice(0, 40);
}

function importField(row, importKind, fieldKey, profiles = []) {
  const aliases = typeof ImportTools.resolveFieldAliases === 'function'
    ? ImportTools.resolveFieldAliases(importKind, fieldKey, profiles)
    : (ImportTools.FIELD_ALIASES?.[ImportTools.normalizeImportKind(importKind)]?.[fieldKey] || []);
  return ImportTools.getValue(row, aliases);
}

function rowRef(rowNumber) {
  return buildRecordRef('import_row', `row_${rowNumber}`, `CSV row ${rowNumber}`);
}

function normalizeWorkStage(value, row) {
  const raw = compact(value || row.status).toLowerCase().replace(/[\s-]+/g, '_');
  const totalCents = Number(row.totalCents || 0);
  if (['lead', 'new', 'contacted', 'qualified'].includes(raw)) return { recordType: 'lead', leadStatus: raw === 'lead' ? 'new' : raw };
  if (['quote', 'quoted', 'proposal', 'bid', 'ready_to_send', 'sent', 'approved'].includes(raw)) {
    return { recordType: 'bid', leadStatus: 'quoted', bidStatus: ['quote', 'quoted', 'proposal', 'bid'].includes(raw) ? 'ready_to_send' : raw };
  }
  if (['booked', 'scheduled', 'confirmed'].includes(raw)) return { recordType: 'order', orderStatus: 'confirmed', jobStatus: 'scheduled', createJob: true };
  if (['dispatched'].includes(raw)) return { recordType: 'order', orderStatus: 'confirmed', jobStatus: 'dispatched', createJob: true };
  if (['in_progress', 'active'].includes(raw)) return { recordType: 'order', orderStatus: 'confirmed', jobStatus: 'in_progress', createJob: true };
  if (['fulfilled', 'completed'].includes(raw)) return { recordType: 'order', orderStatus: 'completed', jobStatus: 'completed', createJob: true };
  if (['paid'].includes(raw)) return { recordType: 'order', orderStatus: 'paid', jobStatus: 'completed', createJob: true, paymentState: 'paid' };
  if (['overdue'].includes(raw)) return { recordType: 'order', orderStatus: 'completed', jobStatus: 'completed', createJob: true, paymentState: 'overdue' };
  if (['cancelled', 'canceled'].includes(raw)) return totalCents > 0
    ? { recordType: 'order', orderStatus: 'cancelled', jobStatus: 'cancelled' }
    : { recordType: 'lead', leadStatus: 'lost' };
  return totalCents > 0 ? { recordType: 'bid', leadStatus: 'quoted', bidStatus: 'ready_to_send' } : { recordType: 'lead', leadStatus: 'new' };
}

function buildSuggestedProfile({ fileName, importKind, mappedFields, headers, confidenceScore, matchedPreset = null }) {
  const kindLabel = String(importKind || 'customers').replace(/_/g, ' ');
  const baseName = compact(fileName).replace(/\.[a-z0-9]+$/i, '') || `legacy-${kindLabel}`;
  const systemLabel = compact(matchedPreset?.system_label || matchedPreset?.label || '');
  const profileKey = `${baseName}-${kindLabel}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const fieldAliases = {};
  mappedFields
    .filter((item) => item.header)
    .forEach((item) => {
      fieldAliases[item.field_key] = [item.header];
    });

  return {
    key: profileKey || `${importKind}-import-profile`,
    label: `${systemLabel ? `${systemLabel} ` : ''}${baseName || 'Legacy export'} ${kindLabel} profile`.replace(/\s+/g, ' ').trim(),
    import_kind: ImportTools.normalizeImportKind(importKind),
    field_aliases: fieldAliases,
    sample_headers: headers,
    source_hint: systemLabel
      ? `Learned from ${systemLabel}${fileName ? ` export ${fileName}` : ' import review'}`
      : (fileName ? `Learned from ${fileName}` : 'Learned from import review'),
    confidence_score: Number(Math.max(0, Math.min(1, confidenceScore || 0)).toFixed(2)),
    source_system: compact(matchedPreset?.source_system || ''),
    source_preset: compact(matchedPreset?.source_preset || matchedPreset?.key || ''),
  };
}

async function runImportMigrationAssistant({ tenantId, input }) {
  const headers = Array.isArray(input.headers) ? input.headers : [];
  const normalizedHeaders = headers.map((header) => ImportTools.normalizeHeader(header)).filter(Boolean).slice(0, 80);
  if (!normalizedHeaders.length) {
    const err = new Error('headers is required for import_migration_assistant');
    err.statusCode = 400;
    throw err;
  }

  const sampleRows = normalizeRows(input.sample_rows || input.sampleRows);
  const fileName = compact(input.file_name || input.fileName);
  const activeProfile = input.active_profile && typeof input.active_profile === 'object' ? input.active_profile : null;
  const activePreset = input.active_preset && typeof input.active_preset === 'object' ? input.active_preset : null;
  const rawLearnedGuidance = {
    notes: Array.isArray(activeProfile?.learning_notes || activeProfile?.learningNotes)
      ? (activeProfile.learning_notes || activeProfile.learningNotes)
      : [],
    correction_fields: Array.isArray(activeProfile?.correction_fields || activeProfile?.correctionFields)
      ? (activeProfile.correction_fields || activeProfile.correctionFields)
      : [],
    walkthrough_summary: activeProfile?.walkthrough_summary || activeProfile?.walkthroughSummary || '',
  };
  const learnedGuidance = {
    notes: (Array.isArray(rawLearnedGuidance.notes) ? rawLearnedGuidance.notes : [])
    .map((value) => compact(value))
    .filter(Boolean)
    .slice(0, 6),
    correction_fields: (Array.isArray(rawLearnedGuidance.correction_fields) ? rawLearnedGuidance.correction_fields : [])
      .map((value) => compact(value))
      .filter(Boolean)
      .slice(0, 8),
    walkthrough_summary: compact(rawLearnedGuidance.walkthrough_summary),
  };
  const profiles = [activeProfile, activePreset].filter(Boolean);
  const requestedKind = ImportTools.normalizeImportKind(input.import_kind || input.importKind || '');
  const recommendedKind = ImportTools.detectImportKind(normalizedHeaders, { profiles }) || requestedKind;
  const matchedPreset = activePreset?.import_kind === recommendedKind
    ? activePreset
    : (typeof ImportTools.chooseImportPreset === 'function'
      ? ImportTools.chooseImportPreset(normalizedHeaders, recommendedKind, { fileName })
      : null);
  const fieldAliases = typeof ImportTools.mergeFieldAliases === 'function'
    ? ImportTools.mergeFieldAliases(recommendedKind, profiles)
    : (ImportTools.FIELD_ALIASES?.[recommendedKind] || {});
  const evidence = createEvidenceBuilder();
  const findings = [];
  const blockers = [];
  const missingData = [];
  const actions = [];

  const usedHeaders = new Set();
  const mappedFields = Object.keys(fieldAliases).map((fieldKey) => {
    const aliases = Array.isArray(fieldAliases[fieldKey]) ? fieldAliases[fieldKey] : [];
    const header = aliases.find((alias) => normalizedHeaders.includes(ImportTools.normalizeHeader(alias))) || '';
    if (header) usedHeaders.add(header);
    return {
      field_key: fieldKey,
      header,
      alias_count: aliases.length,
    };
  });
  const unknownHeaders = normalizedHeaders.filter((header) => !usedHeaders.has(header));

  const headerCoverageEvidence = evidence.add({
    record_type: 'import_file',
    record_id: fileName || 'import_preview',
    field: 'headers',
    label: 'Import header coverage',
    value: `${mappedFields.filter((item) => item.header).length} mapped field(s) across ${normalizedHeaders.length} header(s).`,
  });

  if (requestedKind && requestedKind !== recommendedKind) {
    findings.push({
      id: 'import_kind_shift',
      severity: 'warning',
      category: 'import_mapping',
      title: 'The file looks closer to a different import lane',
      detail: `The current request said ${requestedKind.replace(/_/g, ' ')}, but the available headers align more strongly with ${recommendedKind.replace(/_/g, ' ')}.`,
      evidence_ids: [headerCoverageEvidence],
      record_refs: [],
    });
  }

  if (matchedPreset?.system_label) {
    findings.push({
      id: 'source_system_match',
      severity: 'info',
      category: 'import_mapping',
      title: `The file looks like a ${matchedPreset.system_label} export`,
      detail: activePreset?.key === matchedPreset.key
        ? `The review used the active ${matchedPreset.system_label} preset while mapping the file.`
        : `The header shape lines up with the ${matchedPreset.system_label} preset, so ProofLink can route the file more safely if that source system is correct.`,
      evidence_ids: [headerCoverageEvidence],
      record_refs: [],
    });
  }

  if (learnedGuidance.notes.length || learnedGuidance.walkthrough_summary) {
    findings.push({
      id: 'profile_walkthrough_guidance',
      severity: 'info',
      category: 'import_learning',
      title: 'ProofLink has prior walkthrough guidance for this export shape',
      detail: learnedGuidance.walkthrough_summary
        || `The active import profile carries ${learnedGuidance.notes.length} learned operator note(s) from prior migration walkthroughs.`,
      evidence_ids: [headerCoverageEvidence],
      record_refs: [],
    });
  }

  if (unknownHeaders.length) {
    const unknownHeadersEvidence = evidence.add({
      record_type: 'import_file',
      record_id: fileName || 'import_preview',
      field: 'unknown_headers',
      label: 'Headers that are not mapped yet',
      value: unknownHeaders.join(', '),
    });
    findings.push({
      id: 'unknown_import_headers',
      severity: unknownHeaders.length >= 4 ? 'warning' : 'info',
      category: 'import_mapping',
      title: 'Some columns are not being placed yet',
      detail: `${unknownHeaders.length} header(s) are not part of the current mapping and may need a saved import profile or manual review.`,
      evidence_ids: [unknownHeadersEvidence],
      record_refs: [],
    });
  }

  const routeCounts = {
    customers: 0,
    leads: 0,
    bids: 0,
    orders: 0,
    jobs: 0,
    payments: 0,
  };
  let reviewRowCount = 0;
  let readyRowCount = 0;
  let missingIdentityCount = 0;
  let missingAmountCount = 0;
  let scheduledWithoutDateCount = 0;
  let amountConflictCount = 0;
  let attachmentRowCount = 0;
  let attachmentImageCount = 0;
  let attachmentDocumentCount = 0;

  sampleRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const attachmentRefs = ImportTools.getValue(row, fieldAliases.attachment_links || []);
    const attachmentTokens = String(attachmentRefs || '')
      .split(/[\n;,|]+/)
      .map((value) => compact(value))
      .filter(Boolean);
    if (attachmentTokens.length) {
      attachmentRowCount += 1;
      attachmentImageCount += attachmentTokens.filter((value) => /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif|svg)(\?.*)?$/i.test(value)).length;
      attachmentDocumentCount += attachmentTokens.filter((value) => /\.(pdf|doc|docx|xls|xlsx|csv|txt|rtf)(\?.*)?$/i.test(value)).length;
    }
    if (recommendedKind === 'customers') {
      routeCounts.customers += 1;
      const identity = [
        compact(importField(row, 'customers', 'name', profiles)),
        compact(importField(row, 'customers', 'email', profiles)),
        compact(importField(row, 'customers', 'phone', profiles)),
      ].filter(Boolean);
      if (!identity.length) {
        missingIdentityCount += 1;
        reviewRowCount += 1;
        if (missingIdentityCount <= 3) {
          const rowEvidence = evidence.add({
            record_type: 'import_row',
            record_id: `row_${rowNumber}`,
            field: 'identity',
            label: `Customer row ${rowNumber} is missing identity`,
            value: 'No name, email, or phone value was found on this row.',
          });
          findings.push({
            id: `customer_row_identity_${rowNumber}`,
            severity: 'warning',
            category: 'import_rows',
            title: `Customer row ${rowNumber} needs identity fields`,
            detail: 'ProofLink needs at least a name, email, or phone number before the row can become a real customer record.',
            evidence_ids: [rowEvidence],
            record_refs: [rowRef(rowNumber)],
          });
        }
      } else {
        readyRowCount += 1;
      }
      return;
    }

    if (recommendedKind === 'open_work') {
      const customerIdentity = [
        compact(importField(row, 'open_work', 'customer_name', profiles)),
        compact(importField(row, 'open_work', 'customer_email', profiles)),
        compact(importField(row, 'open_work', 'customer_phone', profiles)),
      ].filter(Boolean);
      const totalCents = ImportTools.toCents(importField(row, 'open_work', 'total_amount', profiles));
      const amountPaidCents = ImportTools.toCents(importField(row, 'open_work', 'amount_paid', profiles));
      const stageRaw = importField(row, 'open_work', 'stage', profiles);
      const scheduledDate = compact(importField(row, 'open_work', 'scheduled_date', profiles));
      const stage = normalizeWorkStage(stageRaw, { totalCents });
      if (stage.recordType === 'lead') routeCounts.leads += 1;
      if (stage.recordType === 'bid') routeCounts.bids += 1;
      if (stage.recordType === 'order') {
        routeCounts.orders += 1;
        if (stage.createJob) routeCounts.jobs += 1;
      }

      let rowNeedsReview = false;
      if (!customerIdentity.length) {
        missingIdentityCount += 1;
        rowNeedsReview = true;
      }
      if (stage.createJob && !scheduledDate) {
        scheduledWithoutDateCount += 1;
        rowNeedsReview = true;
      }
      if (totalCents > 0 && amountPaidCents > totalCents) {
        amountConflictCount += 1;
        rowNeedsReview = true;
      }
      if ((stage.recordType === 'bid' || stage.recordType === 'order') && totalCents <= 0) {
        missingAmountCount += 1;
        rowNeedsReview = true;
      }

      if (rowNeedsReview) {
        reviewRowCount += 1;
      } else {
        readyRowCount += 1;
      }
      return;
    }

    routeCounts.payments += 1;
    const amountCents = ImportTools.toCents(importField(row, 'payments', 'amount', profiles));
    const hasCustomerOrWorkLink = [
      compact(importField(row, 'payments', 'customer_name', profiles)),
      compact(importField(row, 'payments', 'customer_email', profiles)),
      compact(importField(row, 'payments', 'customer_phone', profiles)),
      compact(importField(row, 'payments', 'order_external_id', profiles)),
    ].some(Boolean);
    const rowNeedsReview = amountCents <= 0 || !hasCustomerOrWorkLink;
    if (amountCents <= 0) missingAmountCount += 1;
    if (!hasCustomerOrWorkLink) missingIdentityCount += 1;
    if (rowNeedsReview) reviewRowCount += 1;
    else readyRowCount += 1;
  });

  if (attachmentRowCount) {
    findings.push({
      id: 'import_attachment_refs',
      severity: attachmentRowCount >= 3 ? 'warning' : 'info',
      category: 'import_attachments',
      title: 'The file includes attachment or proof references',
      detail: `${attachmentRowCount} sample row(s) include attachment references. Those rows should stay visible in reconciliation and post-import cleanup so photos, documents, or proof links land in the right ProofLink records.`,
      evidence_ids: [headerCoverageEvidence],
      record_refs: [],
    });
  }

  if (!mappedFields.filter((item) => item.header).length) {
    blockers.push({
      id: 'import_no_mapped_fields',
      title: 'The current file does not map cleanly into ProofLink yet',
      detail: 'No expected fields were matched from the provided headers, so the operator should not import this file until the mapping is corrected.',
      evidence_ids: [headerCoverageEvidence],
      record_refs: [],
    });
  }

  if (missingIdentityCount) {
    missingData.push({
      id: 'import_missing_identity',
      label: 'Some rows are missing customer identity',
      detail: `${missingIdentityCount} row(s) still need a name, email, phone, or work link before they can land on a real ProofLink record.`,
      field: recommendedKind === 'payments' ? 'customer_name / order_external_id' : 'customer identity',
      required_for: 'record_routing',
    });
  }

  if (missingAmountCount) {
    missingData.push({
      id: 'import_missing_amount',
      label: 'Some rows are missing a usable amount',
      detail: `${missingAmountCount} row(s) still need an amount before pricing or payment history can be trusted.`,
      field: recommendedKind === 'payments' ? 'amount' : 'total_amount',
      required_for: 'financial_import',
    });
  }

  if (scheduledWithoutDateCount) {
    findings.push({
      id: 'scheduled_rows_missing_date',
      severity: 'warning',
      category: 'schedule',
      title: 'Some scheduled work rows do not include a service date',
      detail: `${scheduledWithoutDateCount} scheduled or booked row(s) would create work records without a clear date, which will weaken dispatch and scheduling follow-through.`,
      evidence_ids: [headerCoverageEvidence],
      record_refs: [],
    });
  }

  if (amountConflictCount) {
    blockers.push({
      id: 'import_amount_conflicts',
      title: 'Some payment values conflict with the imported total',
      detail: `${amountConflictCount} row(s) show more paid than the total amount on file. Those rows should be corrected before import so ProofLink does not inherit contradictory money history.`,
      evidence_ids: [headerCoverageEvidence],
      record_refs: [],
    });
  }

  const mappingCoverage = mappedFields.length
    ? mappedFields.filter((item) => item.header).length / mappedFields.length
    : 0;
  const readinessRatio = sampleRows.length ? readyRowCount / sampleRows.length : 0.5;
  const confidenceScore = Number(Math.max(0.1, Math.min(0.97, ((mappingCoverage * 0.65) + (readinessRatio * 0.35)))).toFixed(2));
  const profileSuggestion = buildSuggestedProfile({
    fileName,
    importKind: recommendedKind,
    mappedFields,
    headers: normalizedHeaders,
    confidenceScore,
    matchedPreset,
  });

  actions.push({
    id: 'save_import_profile',
    title: 'Save the learned import profile once the review looks right',
    detail: 'Saving the profile lets ProofLink recognize this legacy export shape again so future imports need less manual checking.',
    priority: mappedFields.filter((item) => item.header).length >= 2 ? 'high' : 'medium',
    requires_operator_approval: true,
    suggested_ui_action: 'save_import_profile',
    evidence_ids: [headerCoverageEvidence],
    record_refs: [],
  });
  actions.push({
    id: 'review_import_rows',
    title: 'Review the rows that still need human cleanup before import',
    detail: reviewRowCount
      ? `${reviewRowCount} sample row(s) still need identity, amount, or schedule cleanup before the migration should be approved.`
      : 'The sample rows look clean enough to stay in the preview-and-import workflow.'
      ,
    priority: reviewRowCount ? 'high' : 'low',
    requires_operator_approval: true,
    suggested_ui_action: 'preview_import',
    evidence_ids: [headerCoverageEvidence],
    record_refs: [],
  });
  if (attachmentRowCount) {
    actions.push({
      id: 'review_import_cleanup_inbox',
      title: 'Keep attachment-heavy rows visible after import',
      detail: `${attachmentRowCount} sample row(s) include attachment references, including ${attachmentImageCount} image link(s) and ${attachmentDocumentCount} document link(s). The operator should plan a cleanup pass so that proof stays attached to the right customer, work, or payment records.`,
      priority: 'medium',
      requires_operator_approval: true,
      suggested_ui_action: 'review_cleanup_inbox',
      evidence_ids: [headerCoverageEvidence],
      record_refs: [],
    });
  }

  return {
    report: {
      agent_key: 'import_migration_assistant',
      agent_label: 'Import Migration Assistant',
      summary: `The file aligns most strongly with ${recommendedKind.replace(/_/g, ' ')}. ProofLink mapped ${mappedFields.filter((item) => item.header).length} of ${mappedFields.length} expected field(s), found ${reviewRowCount} sample row(s) that still need review${attachmentRowCount ? `, detected attachment references on ${attachmentRowCount} sample row(s)` : ''}, and can save a reusable import profile once the operator approves the mapping.`,
      summary_status: blockers.length ? 'blocked' : reviewRowCount || unknownHeaders.length ? 'review_needed' : 'ready',
      findings,
      blockers,
      evidence: evidence.list(),
      assumptions: [
        activeProfile?.key ? `The review applied the active import profile "${activeProfile.label || activeProfile.key}".` : '',
        activePreset?.key ? `The review applied the active source preset "${activePreset.label || activePreset.key}".` : '',
        learnedGuidance.notes.length ? `The active profile also carried ${learnedGuidance.notes.length} learned walkthrough note(s) from prior operator corrections.` : '',
      ].filter(Boolean),
      missing_data: missingData,
      confidence: {
        score: confidenceScore,
        rationale: 'Confidence depends on how many expected fields mapped cleanly from the headers and how many sample rows still need identity, amount, schedule, or attachment follow-up cleanup.',
      },
      recommended_actions: actions,
      data_used: [
        {
          label: 'CSV headers',
          count: normalizedHeaders.length,
          detail: normalizedHeaders.slice(0, 8).join(', '),
        },
        {
          label: 'Sample rows reviewed',
          count: sampleRows.length,
          detail: `${readyRowCount} sample row(s) look ready and ${reviewRowCount} still need review.`,
        },
        ...(attachmentRowCount ? [{
          label: 'Attachment references detected',
          count: attachmentRowCount,
          detail: `${attachmentImageCount} image link(s) and ${attachmentDocumentCount} document link(s) appeared in the reviewed sample.`,
        }] : []),
        ...(matchedPreset?.system_label ? [{
          label: 'Matched source preset',
          count: 1,
          detail: `${matchedPreset.system_label} (${matchedPreset.label || matchedPreset.key})`,
        }] : []),
        ...(learnedGuidance.notes.length || learnedGuidance.walkthrough_summary ? [{
          label: 'Learned walkthrough guidance',
          count: learnedGuidance.notes.length || 1,
          detail: learnedGuidance.walkthrough_summary || learnedGuidance.notes.join(' | '),
        }] : []),
      ],
      scope: { tenant_id: tenantId },
      generated_at: new Date().toISOString(),
    },
    tools_used: ['analyze_import_migration_context'],
    context_summary: {
      recommended_kind: recommendedKind,
      requested_kind: requestedKind,
      mapped_field_count: mappedFields.filter((item) => item.header).length,
      expected_field_count: mappedFields.length,
      unknown_headers_count: unknownHeaders.length,
      ready_row_count: readyRowCount,
      review_row_count: reviewRowCount,
      attachment_row_count: attachmentRowCount,
      attachment_image_count: attachmentImageCount,
      attachment_document_count: attachmentDocumentCount,
      route_counts: routeCounts,
      active_profile_key: activeProfile?.key || '',
      active_preset_key: activePreset?.key || '',
      learned_guidance: learnedGuidance.notes.length || learnedGuidance.walkthrough_summary
        ? learnedGuidance
        : null,
      source_preset: matchedPreset ? {
        key: matchedPreset.key,
        label: matchedPreset.label || matchedPreset.key,
        system_label: matchedPreset.system_label || '',
        source_system: matchedPreset.source_system || '',
        description: matchedPreset.description || matchedPreset.source_hint || '',
      } : null,
      profile_suggestion: profileSuggestion,
    },
  };
}

module.exports = { runImportMigrationAssistant };
