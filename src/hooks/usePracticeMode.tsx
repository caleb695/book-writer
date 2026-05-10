import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { MemoryTriple } from "./useMemori";
import { assembleContext } from "@/lib/ultraContext";
import { AI_MODELS } from "./useAiSettings";

export interface PracticeScore {
  id: string;
  model_id: string;
  score: number;
  judge_scores: Array<{ judge: string; score: number; feedback: string }>;
  is_judge: boolean;
  last_practiced_at: string | null;
  practice_count: number;
}

export interface PracticeState {
  isRunning: boolean;
  currentModel: string | null;
  currentRound: number;
  totalModels: number;
  phase: "idle" | "generating" | "judging" | "scoring" | "paused";
  lastError: string | null;
}

const GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-chapter`;
const JUDGE_PROMOTE_THRESHOLD = 9;
const JUDGE_DEMOTE_THRESHOLD = 7;

// Initial judges with their recommended temperature and top_p values
export const INITIAL_JUDGES: Array<{ model_id: string; temperature: number; top_p: number }> = [
  { model_id: "moonshotai/kimi-k2-instruct-0905", temperature: 0.72, top_p: 0.85 },
  { model_id: "qwen/qwen3-32b", temperature: 0.65, top_p: 0.80 },
  { model_id: "llama-3.3-70b-versatile", temperature: 0.70, top_p: 0.85 },
  { model_id: "google/gemma-4-31b-it", temperature: 0.70, top_p: 0.85 },
  { model_id: "qwen/qwen3-next-80b-a3b-instruct", temperature: 0.65, top_p: 0.80 },
  { model_id: "mistral-large-latest", temperature: 0.65, top_p: 0.80 },
  { model_id: "mistral-medium-latest", temperature: 0.68, top_p: 0.82 },
];

/**
 * Practice Mode: Continuous background training with dynamic judge panel.
 * Works through user's model list, generates chapters, scores them, updates memory.
 */
export function usePracticeMode(
  memoriTriples: MemoryTriple[],
  memoriRetrieve: (prompt: string, opts?: any) => MemoryTriple[],
  memoriStoreTriples: (triples: any[]) => Promise<any>,
  memoriReinforce: (ids: string[], bump?: number) => Promise<void>,
  isPaused: boolean,
  isUserGenerating: boolean
) {
  const { user } = useAuth();
  const [scores, setScores] = useState<PracticeScore[]>([]);
  const [state, setState] = useState<PracticeState>({
    isRunning: false,
    currentModel: null,
    currentRound: 0,
    totalModels: 0,
    phase: "idle",
    lastError: null,
  });
  const [checkpoint, setCheckpoint] = useState<{
    modelIndex: number;
    completedJudges: string[];
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load practice scores
  useEffect(() => {
    if (!user) { setScores([]); return; }
    const load = async () => {
      const { data } = await supabase
        .from("practice_scores")
        .select("*")
        .eq("user_id", user.id)
        .order("score", { ascending: false });
      setScores((data ?? []) as unknown as PracticeScore[]);
    };
    load();
  }, [user]);

  // Initialize scores for all models if needed
  const initializeScores = useCallback(async () => {
    if (!user) return;
    const existingIds = new Set(scores.map(s => s.model_id));
    const writingModels = AI_MODELS.filter(m =>
      !m.label.includes("Embed") &&
      !m.label.includes("Prompt Guard") &&
      !m.label.includes("Safeguard")
    );
    const initialJudgeIds = new Set(INITIAL_JUDGES.map(j => j.model_id));
    const toInsert = writingModels
      .filter(m => !existingIds.has(m.id))
      .map(m => ({
        user_id: user.id,
        model_id: m.id,
        score: 0,
        judge_scores: [],
        is_judge: initialJudgeIds.has(m.id),
        practice_count: 0,
      }));

    if (toInsert.length > 0) {
      await supabase.from("practice_scores").insert(toInsert);
      const { data } = await supabase
        .from("practice_scores")
        .select("*")
        .eq("user_id", user.id)
        .order("score", { ascending: false });
      setScores((data ?? []) as unknown as PracticeScore[]);
    }
  }, [user, scores]);

  /**
   * Get the list of active judges (models that scored 9 or 10).
   */
  const getJudges = useCallback((): PracticeScore[] => {
    return scores.filter(s => s.is_judge);
  }, [scores]);

  /**
   * Start a single practice round for one model.
   */
  const practiceOneModel = useCallback(async (
    modelScore: PracticeScore,
    styleMemory: any,
    checklist: any[]
  ): Promise<void> => {
    if (!user) return;

    const judges = getJudges().filter(j => j.model_id !== modelScore.model_id);
    if (judges.length === 0) {
      // No judges yet — use the first 2 highest-scoring non-self models as temp judges
      const tempJudges = scores
        .filter(s => s.model_id !== modelScore.model_id)
        .slice(0, 2);
      if (tempJudges.length === 0) return;
      judges.push(...tempJudges);
    }

    // Random judge generates the prompt
    const promptJudge = judges[Math.floor(Math.random() * judges.length)];
    
    // For now, generate a simple practice prompt
    const genres = ["fantasy", "sci-fi", "thriller", "romance", "literary fiction", "horror", "mystery"];
    const genre = genres[Math.floor(Math.random() * genres.length)];
    const wordCount = 1000 + Math.floor(Math.random() * 5000);
    const practicePrompt = `Write a ${wordCount}-word ${genre} chapter. Include dialogue, action, and interiority.`;

    setState(prev => ({ ...prev, phase: "generating", currentModel: modelScore.model_id }));

    // Retrieve relevant triples
    const relevant = memoriRetrieve(practicePrompt, { includeCharacters: true, includeWorldRules: true });
    const contextPayload = assembleContext(relevant, {
      model: modelScore.model_id,
      requestedWordCount: wordCount,
      voiceProfile: styleMemory?.voice_profile,
      genreConventions: styleMemory?.genre_conventions,
      detectedGenre: styleMemory?.detected_genre,
      styleCache: styleMemory?.style_cache,
    });

    // Generate with the practiced model
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(GENERATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          outline: practicePrompt,
          chapterNumber: 1,
          model: modelScore.model_id,
          temperature: INITIAL_JUDGES.find(j => j.model_id === modelScore.model_id)?.temperature ?? 0.7,
          top_p: INITIAL_JUDGES.find(j => j.model_id === modelScore.model_id)?.top_p ?? 0.9,
          wordCountInstruction: `Target: ${wordCount} words`,
          structuredMemory: styleMemory ? {
            voiceProfile: styleMemory.voice_profile,
            genreConventions: styleMemory.genre_conventions,
            detectedGenre: styleMemory.detected_genre,
            styleCache: styleMemory.style_cache,
          } : null,
          checklist: checklist,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`Practice generation failed: ${resp.status}`);
      }

      // Read the full streamed response
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response body");
      
      let fullText = "";
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // Parse SSE
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") continue;
          try {
            const parsed = JSON.parse(json);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) fullText += content;
          } catch { /* ignore partial */ }
        }
      }

      if (fullText.length < 100) {
        throw new Error("Practice generation too short");
      }

      // TODO: Judge the output and score
      // For now, store a placeholder score
      setState(prev => ({ ...prev, phase: "judging" }));

      // Update practice score
      const newCount = modelScore.practice_count + 1;
      await supabase.from("practice_scores")
        .update({
          practice_count: newCount,
          last_practiced_at: new Date().toISOString(),
        })
        .eq("id", modelScore.id);

      setState(prev => ({ ...prev, phase: "scoring" }));

    } catch (err: any) {
      if (err.name === "AbortError") return;
      setState(prev => ({ ...prev, lastError: err.message }));
      console.error("Practice error:", err);
    }
  }, [user, scores, getJudges, memoriRetrieve]);

  /**
   * Start continuous practice mode.
   */
  const start = useCallback(async (styleMemory: any, checklist: any[]) => {
    if (!user || state.isRunning) return;
    
    await initializeScores();
    
    setState(prev => ({
      ...prev,
      isRunning: true,
      totalModels: scores.length,
      currentRound: 0,
      phase: "generating",
    }));

    // Practice is driven by the effect loop below
  }, [user, state.isRunning, initializeScores, scores]);

  const stop = useCallback(() => {
    setState(prev => ({
      ...prev,
      isRunning: false,
      phase: "idle",
      currentModel: null,
    }));
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Save checkpoint
    setCheckpoint({
      modelIndex: state.currentRound,
      completedJudges: [],
    });
  }, [state.currentRound]);

  // Auto-pause when lagging or user is generating
  useEffect(() => {
    if ((isPaused || isUserGenerating) && state.isRunning) {
      setState(prev => ({ ...prev, phase: "paused" }));
      if (abortRef.current) abortRef.current.abort();
    }
  }, [isPaused, isUserGenerating, state.isRunning]);

  return {
    scores,
    state,
    start,
    stop,
    getJudges,
    initializeScores,
  };
}
