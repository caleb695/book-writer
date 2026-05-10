create table public.kaggle_endpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model_id text not null,
  tunnel_url text not null,
  api_key text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, model_id)
);

alter table public.kaggle_endpoints enable row level security;

create policy "Users view own kaggle endpoints" on public.kaggle_endpoints
  for select using (auth.uid() = user_id);
create policy "Users insert own kaggle endpoints" on public.kaggle_endpoints
  for insert with check (auth.uid() = user_id);
create policy "Users update own kaggle endpoints" on public.kaggle_endpoints
  for update using (auth.uid() = user_id);
create policy "Users delete own kaggle endpoints" on public.kaggle_endpoints
  for delete using (auth.uid() = user_id);

create trigger update_kaggle_endpoints_updated_at
  before update on public.kaggle_endpoints
  for each row execute function public.update_updated_at_column();