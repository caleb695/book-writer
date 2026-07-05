import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface StylePattern {
  id: string;
  category: "voice" | "recurring" | "thematic" | "character_voice" | "world_rule";
  pattern_text: string;
  checklist_question: string;
  confidence: number;
  locked: boolean;
  source_file_id: string | null;
  sessions_below_threshold: number;
  last_reinforced_at: string | null;
  created_at: string;
}

export interface StyleMemory {
  id: string;
  voice_profile: Record<string, any>;
  thematic_fingerprint: Record<string, any>;
  detected_genre: string | null;
  genre_conventions: Array<{ convention: string; checklist_question: string }>;
  style_cache: string;
  last_recached_at: string | null;
  custom_prompt: string | null;
}


export interface GoldenExample {
  id: string;
  content: string;
  fidelity_score: number;
  source: "generation" | "practice" | "claude";
  prompt_summary: string | null;
  created_at: string;
}

export interface FidelityResult {
  fidelityScore: number;
  passed: number;
  total: number;
  failures: Array<{
    question: string;
    evidence: string;
    severity: "high" | "medium" | "low";
    pattern_id: string | null;
  }>;
  newPatterns: Array<{
    category: string;
    pattern_text: string;
    checklist_question: string;
    confidence: number;
  }>;
  notes: string;
}

const SCORE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/score-fidelity`;

export function useStyleMemory() {
  const { user } = useAuth();
  const [memory, setMemory] = useState<StyleMemory | null>(null);
  const [patterns, setPatterns] = useState<StylePattern[]>([]);
  const [goldenExamples, setGoldenExamples] = useState<GoldenExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [lastFidelity, setLastFidelity] = useState<FidelityResult | null>(null);

  useEffect(() => {
    if (!user) {
      setMemory(null);
      setPatterns([]);
      setGoldenExamples([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [memRes, patRes, exRes] = await Promise.all([
          supabase.from("style_memory").select("*").eq("user_id", user.id).maybeSingle(),
          supabase.from("style_patterns").select("*").eq("user_id", user.id).order("confidence", { ascending: false }),
          supabase.from("golden_examples").select("*").eq("user_id", user.id).order("fidelity_score", { ascending: false }).limit(20),
        ]);
        if (cancelled) return;
        if (memRes.data) setMemory(memRes.data as any);
        setPatterns((patRes.data ?? []) as any[]);
        setGoldenExamples((exRes.data ?? []) as any[]);
      } catch (err) {
        console.error("Style memory load error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  // Save synthesis result from analyze-style to DB
  const saveSynthesis = useCallback(async (synthesis: any, sourceFileId?: string) => {
    if (!user) return;

    // 1. Upsert style_memory
    const memoryData = {
      user_id: user.id,
      voice_profile: synthesis.voice_profile || {},
      thematic_fingerprint: synthesis.thematic_fingerprint || {},
      detected_genre: synthesis.detected_genre || null,
      genre_conventions: synthesis.genre_conventions || [],
      style_cache: synthesis.style_cache || "",
      last_recached_at: new Date().toISOString(),
    };

    const { data: existingMem } = await supabase
      .from("style_memory")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingMem) {
      const { error } = await supabase
        .from("style_memory")
        .update(memoryData)
        .eq("id", existingMem.id);
      if (error) console.error("Update memory error:", error);
      setMemory({ id: existingMem.id, ...memoryData } as any);
    } else {
      const { data, error } = await supabase
        .from("style_memory")
        .insert(memoryData)
        .select()
        .single();
      if (error) console.error("Insert memory error:", error);
      if (data) setMemory(data as any);
    }

    // 2. Insert new patterns (check for contradictions with existing)
    const newPatterns = synthesis.patterns || [];
    if (newPatterns.length === 0) return;

    await mergeNewPatterns(newPatterns, sourceFileId);
  }, [user]);

  // Merge new patterns into existing, handling duplicates and contradictions
  const mergeNewPatterns = useCallback(async (newPatterns: any[], sourceFileId?: string) => {
    if (!user) return;

    const { data: existing } = await supabase
      .from("style_patterns")
      .select("*")
      .eq("user_id", user.id);
    const existingPatterns = (existing ?? []) as StylePattern[];

    const toInsert: any[] = [];
    for (const p of newPatterns) {
      const duplicate = existingPatterns.find(
        ep => ep.category === p.category &&
          (ep.pattern_text.toLowerCase().includes(p.pattern_text.toLowerCase().slice(0, 30)) ||
           p.pattern_text.toLowerCase().includes(ep.pattern_text.toLowerCase().slice(0, 30)))
      );

      if (duplicate) {
        const newConf = Math.min(1, duplicate.confidence + 0.05);
        const shouldLock = newConf >= 0.95;
        await supabase
          .from("style_patterns")
          .update({
            confidence: newConf,
            locked: shouldLock || duplicate.locked,
            sessions_below_threshold: 0,
            last_reinforced_at: new Date().toISOString(),
          })
          .eq("id", duplicate.id);
      } else {
        toInsert.push({
          user_id: user.id,
          category: p.category,
          pattern_text: p.pattern_text,
          checklist_question: p.checklist_question,
          confidence: Math.max(0, Math.min(1, p.confidence ?? 0.5)),
          locked: (p.confidence ?? 0.5) >= 0.95,
          source_file_id: sourceFileId || null,
          last_reinforced_at: new Date().toISOString(),
        });
      }
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from("style_patterns").insert(toInsert);
      if (error) console.error("Insert patterns error:", error);
    }

    // Reload patterns
    const { data: refreshed } = await supabase
      .from("style_patterns")
      .select("*")
      .eq("user_id", user.id)
      .order("confidence", { ascending: false });
    setPatterns((refreshed ?? []) as any[]);
  }, [user]);

  // Score a generated chapter against the checklist
  const scoreFidelity = useCallback(async (chapterContent: string, model?: string): Promise<FidelityResult | null> => {
    if (!user || patterns.length === 0) return null;

    const activeChecklist = patterns
      .filter(p => p.confidence >= 0.40)
      .map(p => ({ id: p.id, q: p.checklist_question, confidence: p.confidence, locked: p.locked }));

    if (activeChecklist.length === 0) return null;

    setScoring(true);
    try {
      const resp = await fetch(SCORE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ chapter: chapterContent, checklist: activeChecklist, model }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Scoring failed" }));
        console.error("Fidelity scoring error:", err);
        return null;
      }

      const result: FidelityResult = await resp.json();
      setLastFidelity(result);

      // --- Post-scoring automatic updates ---

      // 1. Log failures to failure_log
      if (result.failures.length > 0) {
        for (const f of result.failures) {
          // Check if this violation already exists
          const { data: existingFailure } = await supabase
            .from("failure_log")
            .select("id, occurrence_count")
            .eq("user_id", user.id)
            .eq("violation_text", f.question)
            .eq("resolved", false)
            .maybeSingle();

          if (existingFailure) {
            const newCount = (existingFailure.occurrence_count || 1) + 1;
            await supabase
              .from("failure_log")
              .update({ occurrence_count: newCount, updated_at: new Date().toISOString() })
              .eq("id", existingFailure.id);

            // If pattern has failed 3+ times, bump its confidence by 0.1
            if (newCount >= 3 && f.pattern_id) {
              const pattern = patterns.find(p => p.id === f.pattern_id);
              if (pattern && !pattern.locked) {
                const newConf = Math.min(1, pattern.confidence + 0.1);
                await supabase
                  .from("style_patterns")
                  .update({
                    confidence: newConf,
                    locked: newConf >= 0.95 || pattern.locked,
                  })
                  .eq("id", f.pattern_id);
              }
            }
          } else {
            await supabase
              .from("failure_log")
              .insert({
                user_id: user.id,
                violation_text: f.question,
                severity: f.severity,
                pattern_id: f.pattern_id,
                occurrence_count: 1,
              });
          }
        }
      }

      // 2. Add new discovered patterns
      if (result.newPatterns.length > 0) {
        await mergeNewPatterns(result.newPatterns);
      }

      // 3. Check if output qualifies as golden example (top 10%)
      const { data: allExamples } = await supabase
        .from("golden_examples")
        .select("id, fidelity_score")
        .eq("user_id", user.id)
        .order("fidelity_score", { ascending: false });

      const examples = allExamples ?? [];
      const isTop10 = examples.length < 5 || result.fidelityScore > (examples[Math.floor(examples.length * 0.1)]?.fidelity_score ?? 0);

      if (isTop10 && result.fidelityScore >= 0.5) {
        // Archive as golden example
        if (examples.length >= 20) {
          // Remove lowest scoring example
          const lowest = examples[examples.length - 1];
          if (lowest && result.fidelityScore > lowest.fidelity_score) {
            await supabase.from("golden_examples").delete().eq("id", lowest.id);
          }
        }

        await supabase.from("golden_examples").insert({
          user_id: user.id,
          content: chapterContent.slice(0, 10000), // Cap storage
          fidelity_score: result.fidelityScore,
          source: "generation",
          prompt_summary: `Chapter scored ${(result.fidelityScore * 100).toFixed(0)}% — ${result.passed}/${result.total} checks passed`,
        });

        // Reload golden examples
        const { data: refreshedExamples } = await supabase
          .from("golden_examples")
          .select("*")
          .eq("user_id", user.id)
          .order("fidelity_score", { ascending: false })
          .limit(20);
        setGoldenExamples((refreshedExamples ?? []) as any[]);
      }

      // 4. Run confidence drift on patterns reinforced by passing
      const passedQuestions = new Set(result.failures.length > 0
        ? result.failures.map(f => f.question)
        : []);

      for (const checkItem of activeChecklist) {
        const wasPassed = !passedQuestions.has(checkItem.q);
        const pattern = patterns.find(p => p.id === checkItem.id);
        if (!pattern || pattern.locked) continue;

        if (wasPassed) {
          // Reinforced — bump confidence by 0.05
          const newConf = Math.min(1, pattern.confidence + 0.05);
          await supabase
            .from("style_patterns")
            .update({
              confidence: newConf,
              locked: newConf >= 0.95,
              sessions_below_threshold: 0,
              last_reinforced_at: new Date().toISOString(),
            })
            .eq("id", pattern.id);
        }
      }

      // 5. Log session
      await supabase.from("session_history").insert({
        user_id: user.id,
        session_type: "generation",
        summary: `Fidelity: ${(result.fidelityScore * 100).toFixed(0)}% (${result.passed}/${result.total}). ${result.failures.length} failures. ${result.newPatterns.length} new patterns.`,
        fidelity_score: result.fidelityScore,
        patterns_updated: result.failures.length + result.newPatterns.length,
      });

      // Trim session history to last 10
      const { data: sessions } = await supabase
        .from("session_history")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (sessions && sessions.length > 10) {
        const toDelete = sessions.slice(10).map(s => s.id);
        await supabase.from("session_history").delete().in("id", toDelete);
      }

      // Reload patterns after all drift updates
      const { data: finalPatterns } = await supabase
        .from("style_patterns")
        .select("*")
        .eq("user_id", user.id)
        .order("confidence", { ascending: false });
      setPatterns((finalPatterns ?? []) as any[]);

      return result;
    } catch (err) {
      console.error("Fidelity scoring error:", err);
      return null;
    } finally {
      setScoring(false);
    }
  }, [user, patterns, mergeNewPatterns]);

  // Decay unreinforced patterns (call periodically or after sessions)
  const decayPatterns = useCallback(async () => {
    if (!user) return;

    const { data: allPatterns } = await supabase
      .from("style_patterns")
      .select("*")
      .eq("user_id", user.id);

    if (!allPatterns) return;

    for (const p of allPatterns as StylePattern[]) {
      if (p.locked) continue;

      // Increment sessions_below_threshold if confidence < 0.40
      if (p.confidence < 0.40) {
        const newSessions = p.sessions_below_threshold + 1;
        if (newSessions >= 50) {
          // Auto-delete noise patterns
          await supabase.from("style_patterns").delete().eq("id", p.id);
        } else {
          await supabase
            .from("style_patterns")
            .update({ sessions_below_threshold: newSessions })
            .eq("id", p.id);
        }
      }
    }

    // Reload
    const { data: refreshed } = await supabase
      .from("style_patterns")
      .select("*")
      .eq("user_id", user.id)
      .order("confidence", { ascending: false });
    setPatterns((refreshed ?? []) as any[]);
  }, [user]);

  // Get patterns for prompt injection, gated by confidence
  const getInjectionPatterns = useCallback(() => {
    const hard = patterns.filter(p => p.confidence >= 0.75);
    const soft = patterns.filter(p => p.confidence >= 0.40 && p.confidence < 0.75);
    const locked = patterns.filter(p => p.locked);
    return { hard, soft, locked };
  }, [patterns]);

  // Build the checklist from all active patterns
  const getChecklist = useCallback(() => {
    return patterns
      .filter(p => p.confidence >= 0.40)
      .map(p => ({
        id: p.id,
        question: p.checklist_question,
        confidence: p.confidence,
        locked: p.locked,
        category: p.category,
      }));
  }, [patterns]);

  return {
    memory,
    patterns,
    goldenExamples,
    loading,
    scoring,
    lastFidelity,
    saveSynthesis,
    scoreFidelity,
    decayPatterns,
    getInjectionPatterns,
    getChecklist,
  };
}
