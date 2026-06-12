create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  contact_email text not null default '',
  mobile_phone text not null default '',
  schedule_aliases text[] not null default '{}',
  timezone text not null default 'America/New_York',
  calloff_phone text not null default '',
  reminder_offset_hours integer not null default 4 check (reminder_offset_hours between 1 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workplaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My workplace',
  calloff_phone text not null default '',
  created_at timestamptz not null default now()
);

create table public.shift_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workplace_id uuid references public.workplaces(id) on delete set null,
  original_file_path text not null,
  original_file_name text not null,
  mime_type text,
  status text not null default 'uploaded' check (status in ('uploaded', 'parsed', 'confirmed', 'blocked', 'expired')),
  parser_message text,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now()
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workplace_id uuid references public.workplaces(id) on delete set null,
  upload_id uuid references public.shift_uploads(id) on delete set null,
  title text not null default 'Work shift',
  unit text not null default '',
  role text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'America/New_York',
  status text not null default 'scheduled' check (status in ('scheduled', 'going', 'called_off', 'missed')),
  source text not null default 'manual' check (source in ('manual', 'upload', 'calendar')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  notes text,
  notification_id text,
  calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reminder_offset_minutes integer not null default 240 check (reminder_offset_minutes between 5 and 10080),
  enable_local_notifications boolean not null default true,
  enable_calendar_export boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.calloff_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  phone_number text not null,
  status text not null default 'started' check (status in ('started', 'completed', 'failed', 'cancelled')),
  call_started_at timestamptz not null default now(),
  call_completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.workplaces enable row level security;
alter table public.shift_uploads enable row level security;
alter table public.shifts enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.calloff_events enable row level security;

create policy "profiles own rows" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "workplaces own rows" on public.workplaces
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "shift uploads own rows" on public.shift_uploads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "shifts own rows" on public.shifts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notification preferences own rows" on public.notification_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "calloff events own rows" on public.calloff_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'schedule-uploads',
  'schedule-uploads',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']
)
on conflict (id) do nothing;

create policy "users can upload their schedules" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'schedule-uploads' and owner = auth.uid());

create policy "users can read their schedule uploads" on storage.objects
  for select to authenticated
  using (bucket_id = 'schedule-uploads' and owner = auth.uid());

create policy "users can delete their schedule uploads" on storage.objects
  for delete to authenticated
  using (bucket_id = 'schedule-uploads' and owner = auth.uid());

create index shifts_user_start_idx on public.shifts(user_id, start_at);
create index shift_uploads_expiry_idx on public.shift_uploads(status, expires_at);
