alter table public.calloff_events
  add column if not exists method text not null default 'dialer'
    check (method in ('dialer', 'automated')),
  add column if not exists provider_call_id text;
