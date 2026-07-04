create table if not exists public.style_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  status text not null default 'running' check (status in ('running','done','failed')),
  chunks_total int not null default 0,
  chunks_completed int not null default 0,
  synthesis jsonb,
  contradictions jsonb,
  content_hash text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists style_analysis_jobs_user_updated_idx on public.style_analysis_jobs(user_id, updated_at desc);
grant select, insert, update, delete on public.style_analysis_jobs to authenticated;
grant all on public.style_analysis_jobs to service_role;
alter table public.style_analysis_jobs enable row level security;
create policy "own jobs read" on public.style_analysis_jobs for select to authenticated using (auth.uid() = user_id);
create policy "own jobs insert" on public.style_analysis_jobs for insert to authenticated with check (auth.uid() = user_id);
create policy "own jobs update" on public.style_analysis_jobs for update to authenticated using (auth.uid() = user_id);
create policy "own jobs delete" on public.style_analysis_jobs for delete to authenticated using (auth.uid() = user_id);
create trigger set_style_analysis_jobs_updated_at before update on public.style_analysis_jobs for each row execute function public.update_updated_at_column();