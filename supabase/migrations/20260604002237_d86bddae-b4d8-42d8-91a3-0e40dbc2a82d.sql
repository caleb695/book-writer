create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.generation_jobs
  add column if not exists claimed_at timestamptz;

create index if not exists generation_jobs_running_idx
  on public.generation_jobs (status, updated_at)
  where status = 'running';