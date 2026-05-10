
-- Unified memory object per user
CREATE TABLE public.style_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  voice_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  thematic_fingerprint jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_genre text,
  genre_conventions jsonb NOT NULL DEFAULT '[]'::jsonb,
  style_cache text NOT NULL DEFAULT '',
  last_recached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.style_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own memory" ON public.style_memory FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own memory" ON public.style_memory FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own memory" ON public.style_memory FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own memory" ON public.style_memory FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_style_memory_updated_at BEFORE UPDATE ON public.style_memory
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Individual patterns with confidence scores and checklist questions
CREATE TABLE public.style_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('voice', 'recurring', 'thematic', 'character_voice', 'world_rule')),
  pattern_text text NOT NULL,
  checklist_question text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  locked boolean NOT NULL DEFAULT false,
  source_file_id uuid,
  sessions_below_threshold integer NOT NULL DEFAULT 0,
  last_reinforced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.style_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own patterns" ON public.style_patterns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own patterns" ON public.style_patterns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own patterns" ON public.style_patterns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own patterns" ON public.style_patterns FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_style_patterns_updated_at BEFORE UPDATE ON public.style_patterns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Golden examples archive (max 20 per user, enforced in app logic)
CREATE TABLE public.golden_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content text NOT NULL,
  fidelity_score numeric NOT NULL CHECK (fidelity_score >= 0 AND fidelity_score <= 1),
  source text NOT NULL DEFAULT 'generation' CHECK (source IN ('generation', 'practice', 'claude')),
  prompt_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.golden_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own examples" ON public.golden_examples FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own examples" ON public.golden_examples FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own examples" ON public.golden_examples FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own examples" ON public.golden_examples FOR DELETE USING (auth.uid() = user_id);

-- Failure log for checklist violations
CREATE TABLE public.failure_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pattern_id uuid REFERENCES public.style_patterns(id) ON DELETE CASCADE,
  violation_text text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('high', 'medium', 'low')),
  occurrence_count integer NOT NULL DEFAULT 1,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.failure_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own failures" ON public.failure_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own failures" ON public.failure_log FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own failures" ON public.failure_log FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own failures" ON public.failure_log FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_failure_log_updated_at BEFORE UPDATE ON public.failure_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Session history (max 10 per user, enforced in app logic)
CREATE TABLE public.session_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  summary text NOT NULL,
  session_type text NOT NULL DEFAULT 'generation' CHECK (session_type IN ('generation', 'practice', 'critique')),
  patterns_updated integer NOT NULL DEFAULT 0,
  fidelity_score numeric CHECK (fidelity_score >= 0 AND fidelity_score <= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.session_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own history" ON public.session_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own history" ON public.session_history FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own history" ON public.session_history FOR DELETE USING (auth.uid() = user_id);

-- Track which files have already been analyzed (for diff-based upload detection)
ALTER TABLE public.uploaded_files ADD COLUMN content_hash text;
ALTER TABLE public.uploaded_files ADD COLUMN analyzed boolean NOT NULL DEFAULT false;
