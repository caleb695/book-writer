CREATE TABLE public.generation_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL,
  message_id UUID,
  chapter_number INTEGER NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  phase TEXT NOT NULL DEFAULT 'starting',
  round INTEGER NOT NULL DEFAULT 0,
  kernel_slug TEXT,
  kernel_user TEXT,
  draft_text TEXT NOT NULL DEFAULT '',
  working_text TEXT NOT NULL DEFAULT '',
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own jobs" ON public.generation_jobs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own jobs" ON public.generation_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own jobs" ON public.generation_jobs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own jobs" ON public.generation_jobs
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_generation_jobs_user_status
  ON public.generation_jobs (user_id, status, updated_at DESC);
CREATE INDEX idx_generation_jobs_project
  ON public.generation_jobs (project_id, status);

CREATE TRIGGER update_generation_jobs_updated_at
  BEFORE UPDATE ON public.generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();