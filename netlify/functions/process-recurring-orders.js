// netlify/functions/process-recurring-orders.js
// Scheduled function. Runs daily to create new orders from active recurring schedules.
// Trigger via Netlify scheduled functions (cron: "0 8 * * *") or call manually.

'use strict';

const { getAdminClient, respond } = require('./utils/auth');

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextDate(current, frequency) {
  switch (frequency) {
    case 'weekly'  : return addDays(current, 7);
    case 'biweekly': return addDays(current, 14);
    case 'monthly' : {
      const d = new Date(current);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d.toISOString().slice(0, 10);
    }
    default: return addDays(current, 7);
  }
}

exports.handler = async (event) => {
  // Allow scheduled invocation or manual admin trigger
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const supabase = getAdminClient();
  const today    = new Date().toISOString().slice(0, 10);

  // Fetch all active recurring schedules due today or earlier
  const { data: schedules, error: schedErr } = await supabase
    .from('recurring_orders')
    .select('*, orders!source_order_id(id, title, customer_name, customer_email, total_amount, operator_id, tenant_id, description, line_items)')
    .eq('active', true)
    .lte('next_date', today);

  if (schedErr) {
    console.error('[process-recurring-orders] fetch error:', schedErr);
    return respond(500, { error: 'Failed to fetch schedules' });
  }

  let created = 0;
  let failed  = 0;

  const allRecords   = [];
  const validSchedules = [];

  for (const schedule of schedules || []) {
    const source = schedule.orders;
    if (!source) { failed++; continue; }

    allRecords.push({
      tenant_id      : schedule.tenant_id,
      operator_id    : schedule.operator_id,
      title          : source.title,
      description    : source.description || null,
      customer_name  : source.customer_name || null,
      customer_email : source.customer_email || null,
      total_amount   : source.total_amount || 0,
      line_items     : source.line_items || null,
      status         : 'new',
      source_type    : 'recurring',
      recurring_id   : schedule.id,
      created_at     : new Date().toISOString(),
      updated_at     : new Date().toISOString(),
    });
    validSchedules.push(schedule);
  }

  if (allRecords.length > 0) {
    const { error: insertErr } = await supabase
      .from('orders')
      .insert(allRecords);

    if (insertErr) {
      console.error('[process-recurring-orders] insert error:', insertErr);
      failed += allRecords.length;
    } else {
      // Advance next_date for each successfully inserted schedule
      for (const schedule of validSchedules) {
        await supabase
          .from('recurring_orders')
          .update({ next_date: nextDate(schedule.next_date, schedule.frequency), updated_at: new Date().toISOString() })
          .eq('id', schedule.id);
      }
      created = allRecords.length;
    }
  }

  console.log(`[process-recurring-orders] created=${created} failed=${failed}`);
  return respond(200, { ok: true, created, failed, processed: (schedules || []).length });
};
