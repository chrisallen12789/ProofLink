-- Prevent duplicate recurring order creation for the same schedule date.
create unique index if not exists idx_orders_recurring_scheduled_date_unique
  on public.orders (recurring_id, scheduled_date)
  where recurring_id is not null and scheduled_date is not null;
