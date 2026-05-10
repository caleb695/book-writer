
-- Memori semantic triples table
CREATE TABLE public.memory_triples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subject text NOT NULL,
  predicate text NOT NULL,
  object_value text NOT NULL,
  category text NOT NULL DEFAULT 'recurring',
  confidence numeric NOT NULL DEFAULT 0.5,
  locked boolean NOT NULL DEFAULT false,
  sessions_below_threshold integer NOT NULL DEFAULT 0,
  source_pattern_id uuid REFERENCES public.style_patterns(id) ON DELETE SET NULL,
  last_reinforced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.memory_triples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own triples" ON public.memory_triples FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own triples" ON public.memory_triples FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own triples" ON public.memory_triples FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own triples" ON public.memory_triples FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_memory_triples_updated_at
  BEFORE UPDATE ON public.memory_triples
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- UltraContext snapshots
CREATE TABLE public.context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  snapshot_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text NOT NULL DEFAULT '',
  prompt_hash text,
  token_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.context_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snapshots" ON public.context_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own snapshots" ON public.context_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own snapshots" ON public.context_snapshots FOR DELETE USING (auth.uid() = user_id);

-- Practice mode model scores
CREATE TABLE public.practice_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  model_id text NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  judge_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_judge boolean NOT NULL DEFAULT false,
  last_practiced_at timestamptz,
  practice_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.practice_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scores" ON public.practice_scores FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own scores" ON public.practice_scores FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own scores" ON public.practice_scores FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own scores" ON public.practice_scores FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_practice_scores_updated_at
  BEFORE UPDATE ON public.practice_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Token usage tracking
CREATE TABLE public.token_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'generation',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.token_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage" ON public.token_usage FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own usage" ON public.token_usage FOR INSERT WITH CHECK (auth.uid() = user_id);
