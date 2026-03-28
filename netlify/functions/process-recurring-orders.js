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

function startOfUtcDay(dateStr) {
  return `${dateStr}T00:00:00.000Z`;
}

function endOfUtcDay(dateStr) {
  return `${dateStr}T23:59:59.999Z`;
}

exports.handler = async (event) => {
  // Allow scheduled invocation or manual admin trigger
  if (event.httpMethod === 'OPTIONS') return respond(200, {});

  const supabase = getAdminClient();
  const today    = new Date().toISOString().slice(0, 10);
  const todayStart = startOfUtcDay(today);
  const todayEnd = endOfUtcDay(today);

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

  let processed = 0;
  let created   = 0;
  let failed    = 0;
  let skipped   = 0;

  for (const schedule of schedules || []) {
    processed++;
    try {
      const source = schedule.orders;
      if (!source) {
        skipped++;
        continue;
      }

      const { data: existingOrder, error: existingErr } = await supabase
        .from('orders')
        .select('id')
        .eq('tenant_id', schedule.tenant_id)
        .eq('recurring_id', schedule.id)
        .eq('source_type', 'recurring')
        .gte('created_at', todayStart)
        .lte('created_at', todayEnd)
        .maybeSingle();

      if (existingErr) {
        console.error('[process-recurring-orders] existing-order check failed schedule_id:', schedule.id, existingErr.message);
        failed++;
        continue;
      }

      if (existingOrder) {
        await supabase
          .from('recurring_orders')
          .update({ next_date: nextDate(schedule.next_date, schedule.frequency), updated_at: new Date().toISOString() })
          .eq('id', schedule.id);
        skipped++;
        continue;
      }

      const record = {
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
      };

      const { error: insertErr } = await supabase
        .from('orders')
        .insert(record);

      if (insertErr) {
        console.error('[process-recurring-orders] failed order schedule_id:', schedule.id, insertErr.message);
        failed++;
        continue;
      }

      // Advance next_date for successfully inserted schedule
      await supabase
        .from('recurring_orders')
        .update({ next_date: nextDate(schedule.next_date, schedule.frequency), updated_at: new Date().toISOString() })
        .eq('id', schedule.id);

      created++;
    } catch (err) {
      console.error('[process-recurring-orders] failed order schedule_id:', schedule.id, err.message);
      failed++;
    }
  }

  console.log('[process-recurring-orders] completed:', { processed, created, failed, skipped });
  return respond(200, { ok: true, created, failed, skipped, processed });
};
