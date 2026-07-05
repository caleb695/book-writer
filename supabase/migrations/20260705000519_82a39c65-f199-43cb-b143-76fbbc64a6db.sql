ALTER TABLE public.style_memory ADD COLUMN IF NOT EXISTS custom_prompt text;
ALTER TABLE public.user_ai_settings ADD COLUMN IF NOT EXISTS thinking_enabled boolean NOT NULL DEFAULT true;