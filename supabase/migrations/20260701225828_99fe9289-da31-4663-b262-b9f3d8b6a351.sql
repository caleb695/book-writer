ALTER TABLE public.user_ai_settings
  ADD COLUMN IF NOT EXISTS word_count_min integer,
  ADD COLUMN IF NOT EXISTS word_count_max integer,
  ADD COLUMN IF NOT EXISTS brainstorm_model text;