ALTER TABLE public.user_ai_settings 
ADD COLUMN fiction_type text NOT NULL DEFAULT '',
ADD COLUMN fiction_type_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN perspective text NOT NULL DEFAULT '';