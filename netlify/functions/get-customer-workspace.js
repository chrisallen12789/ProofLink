'use strict';

const { requireOperatorContext, respond } = require('./utils/auth');

function clean(value) {
  return String(value || '').trim();
}

function isMissingRelation(error) {
  return String(error?.code || '') === 'PGRST205';
}

function toIsoDate(value) {
  const v = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function deriveBuildingKey(job, asset) {
  const fromJob = clean(job?.service_address);
  if (fromJob) return fromJob;
  const fromAsset = clean(asset?.address);
  if (fromAsset) return fromAsset;
  return 'Unspecified building';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, {});
  if (event.httpMethod !== 'GET') return respond(405, { error: 'Method not allowed' });

  let ctx;
  try {
    ctx = await requireOperatorContext(event);
  } catch (error) {
    return respond(error.statusCode || 401, { error: error.message });
  }

  const { supabase, tenantId } = ctx;
  const params = event.queryStringParameters || {};
  const customerId = clean(params.customer_id || params.customerId);
  const dateFrom = toIsoDate(params.date_from || params.dateFrom);
  const dateTo = toIsoDate(params.date_to || params.dateTo);
  const jobType = clean(params.job_type || params.jobType);
  const building = clean(params.building || params.building_name || params.buildingName);
  const search = clean(params.search || params.q);
  const includeClosed = clean(params.include_closed || params.includeClosed || 'true').toLowerCase() !== 'false';

  if (!customerId) {
    return respond(400, { error: 'Missing required query param: customer_id' });
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, name, email, phone, notes, city, state, zip, updated_at')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle();

  if (customerError) {
    console.error('[get-customer-workspace] customer fetch error:', customerError);
    return respond(500, { error: 'Failed to load customer profile' });
  }

  if (!customer) {
    return respond(404, { error: 'Customer not found' });
  }

  let assets = [];
  let assetsWarning = null;
  try {
    let assetsQuery = supabase
      .from('infrastructure_assets')
      .select('id, customer_id, asset_type, asset_name, address, city, status, next_service_due_date, service_frequency_days, metadata')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId);

    if (building) assetsQuery = assetsQuery.ilike('address', `%${building}%`);
    if (search) assetsQuery = assetsQuery.ilike('asset_name', `%${search}%`);

    const { data, error } = await assetsQuery.order('next_service_due_date', { ascending: true, nullsFirst: false });
    if (error) {
      if (isMissingRelation(error)) {
        assetsWarning = 'infrastructure_assets table is not available yet';
      } else {
        console.error('[get-customer-workspace] assets fetch error:', error);
        return respond(500, { error: 'Failed to load customer assets' });
      }
    } else {
      assets = data || [];
    }
  } catch (error) {
    console.error('[get-customer-workspace] assets fetch crash:', error);
    return respond(500, { error: 'Failed to load customer assets' });
  }

  let jobsQuery = supabase
    .from('jobs')
    .select('id, customer_id, asset_id, title, status, job_type, scheduled_date, completed_at, service_address, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId);

  if (dateFrom) jobsQuery = jobsQuery.gte('scheduled_date', dateFrom);
  if (dateTo) jobsQuery = jobsQuery.lte('scheduled_date', dateTo);
  if (jobType) jobsQuery = jobsQuery.ilike('job_type', `%${jobType}%`);
  if (building) jobsQuery = jobsQuery.ilike('service_address', `%${building}%`);
  if (search) jobsQuery = jobsQuery.ilike('title', `%${search}%`);
  if (!includeClosed) jobsQuery = jobsQuery.neq('status', 'completed');

  const { data: jobsData, error: jobsError } = await jobsQuery.order('scheduled_date', { ascending: false });

  if (jobsError) {
    console.error('[get-customer-workspace] jobs fetch error:', jobsError);
    return respond(500, { error: 'Failed to load customer jobs' });
  }

  const jobs = jobsData || [];
  const jobIds = jobs.map((job) => job.id).filter(Boolean);

  let expenses = [];
  const expensesQueryBase = supabase
    .from('expenses')
    .select('id, job_id, customer_id, amount_cents, date, expense_type, description')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId);

  const expensesQuery = jobIds.length ? expensesQueryBase.in('job_id', jobIds) : expensesQueryBase;
  const { data: expensesData, error: expensesError } = await expensesQuery.order('date', { ascending: false });
  if (!expensesError) expenses = expensesData || [];

  let photos = [];
  if (jobIds.length) {
    const { data: photosData, error: photosError } = await supabase
      .from('job_photos')
      .select('id, job_id, url, caption, created_at')
      .in('job_id', jobIds)
      .order('created_at', { ascending: false });

    if (!photosError) photos = photosData || [];
  }

  const assetsById = new Map((assets || []).map((asset) => [asset.id, asset]));
  const expensesByJob = new Map();
  for (const expense of expenses) {
    if (!expense?.job_id) continue;
    if (!expensesByJob.has(expense.job_id)) expensesByJob.set(expense.job_id, []);
    expensesByJob.get(expense.job_id).push(expense);
  }

  const photosByJob = new Map();
  for (const photo of photos) {
    if (!photo?.job_id) continue;
    if (!photosByJob.has(photo.job_id)) photosByJob.set(photo.job_id, []);
    photosByJob.get(photo.job_id).push(photo);
  }

  const jobsDetailed = jobs.map((job) => {
    const jobExpenses = expensesByJob.get(job.id) || [];
    return {
      ...job,
      expense_total_cents: jobExpenses.reduce((sum, row) => sum + toNumber(row.amount_cents), 0),
      expenses: jobExpenses,
      photos: photosByJob.get(job.id) || [],
      asset: job.asset_id ? assetsById.get(job.asset_id) || null : null,
    };
  });

  const buildingsIndex = new Map();
  for (const job of jobsDetailed) {
    const key = deriveBuildingKey(job, job.asset);
    if (!buildingsIndex.has(key)) {
      buildingsIndex.set(key, {
        building_key: key,
        job_count: 0,
        expense_total_cents: 0,
        last_service_at: null,
      });
    }

    const summary = buildingsIndex.get(key);
    summary.job_count += 1;
    summary.expense_total_cents += toNumber(job.expense_total_cents);
    const serviceDate = clean(job.completed_at || job.scheduled_date || job.updated_at || job.created_at);
    if (serviceDate && (!summary.last_service_at || serviceDate > summary.last_service_at)) {
      summary.last_service_at = serviceDate;
    }
  }

  const buildings = [...buildingsIndex.values()].sort((a, b) =>
    String(a.building_key).localeCompare(String(b.building_key))
  );

  return respond(200, {
    customer,
    filters: {
      customer_id: customerId,
      date_from: dateFrom || null,
      date_to: dateTo || null,
      job_type: jobType || null,
      building: building || null,
      search: search || null,
      include_closed: includeClosed,
    },
    assets,
    buildings,
    jobs: jobsDetailed,
    summary: {
      total_jobs: jobsDetailed.length,
      total_assets: assets.length,
      total_buildings: buildings.length,
      total_expense_cents: jobsDetailed.reduce((sum, row) => sum + toNumber(row.expense_total_cents), 0),
      next_service_due_count: assets.filter((asset) => clean(asset.next_service_due_date)).length,
    },
    warnings: [assetsWarning].filter(Boolean),
  });
};
