CREATE TABLE public.user_ai_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  model TEXT NOT NULL DEFAULT 'mistral-large-latest',
  temperature NUMERIC(3,2) NOT NULL DEFAULT 0.70,
  top_p NUMERIC(3,2) NOT NULL DEFAULT 0.90,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own settings"
ON public.user_ai_settings FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own settings"
ON public.user_ai_settings FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
ON public.user_ai_settings FOR UPDATE
USING (auth.uid() = user_id);

CREATE TRIGGER update_user_ai_settings_updated_at
BEFORE UPDATE ON public.user_ai_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();