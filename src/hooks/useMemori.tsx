import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface MemoryTriple {
  id: string;
  subject: string;
  predicate: string;
  object_value: string;
  category: string;
  confidence: number;
  locked: boolean;
  sessions_below_threshold: number;
  source_pattern_id: string | null;
  last_reinforced_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Memori: Long-term persistent memory layer.
 * Stores everything as compact semantic triples (subject-predicate-object).
 * Handles compression, deduplication, confidence gating, decay, and contradiction detection.
 */
export function useMemori() {
  const { user } = useAuth();
  const [triples, setTriples] = useState<MemoryTriple[]>([]);
  const [loading, setLoading] = useState(true);

  // Load all triples for the user
  useEffect(() => {
    if (!user) {
      setTriples([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("memory_triples")
        .select("*")
        .eq("user_id", user.id)
        .order("confidence", { ascending: false });
      if (cancelled) return;
      if (error) console.error("Memori load error:", error);
      setTriples((data ?? []) as MemoryTriple[]);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  /**
   * Convert a pattern or rule into a semantic triple.
   * Compression: shortest possible sentence that conveys the full idea.
   */
  const patternToTriple = (p: {
    category: string;
    pattern_text: string;
    checklist_question: string;
    confidence: number;
  }): Omit<MemoryTriple, "id" | "created_at" | "updated_at" | "sessions_below_threshold" | "source_pattern_id" | "last_reinforced_at"> => {
    // Subject = the entity/concept the pattern is about
    // Predicate = the relationship/action
    // Object = the value/rule
    // We compress into the triple format: pattern_text → subject|predicate|object
    const parts = compressToTriple(p.pattern_text, p.category);
    return {
      subject: parts.subject,
      predicate: parts.predicate,
      object_value: parts.object_value,
      category: p.category,
      confidence: p.confidence,
      locked: p.confidence >= 0.95,
    };
  };

  /**
   * Compress a pattern text into a semantic triple.
   * Format: subject (what it's about) | predicate (what property) | object (the value/rule).
   */
  const compressToTriple = (text: string, category: string): { subject: string; predicate: string; object_value: string } => {
    // Smart compression based on category
    const cleaned = text.replace(/\s+/g, " ").trim();
    
    switch (category) {
      case "voice":
        return { subject: "author_voice", predicate: "exhibits", object_value: cleaned };
      case "recurring":
        return { subject: "prose_pattern", predicate: "recurs", object_value: cleaned };
      case "thematic":
        return { subject: "theme", predicate: "manifests_as", object_value: cleaned };
      case "character_voice":
        // Try to extract character name
        const charMatch = cleaned.match(/^(\w+(?:\s\w+)?)\s/);
        return {
          subject: charMatch ? `char:${charMatch[1].toLowerCase()}` : "character",
          predicate: "speaks_with",
          object_value: charMatch ? cleaned.slice(charMatch[0].length) : cleaned,
        };
      case "world_rule":
        return { subject: "world", predicate: "requires", object_value: cleaned };
      case "failure":
        return { subject: "generation", predicate: "must_avoid", object_value: cleaned };
      case "golden":
        return { subject: "output", predicate: "exemplifies", object_value: cleaned };
      case "session":
        return { subject: "session", predicate: "summary", object_value: cleaned };
      default:
        return { subject: category, predicate: "states", object_value: cleaned };
    }
  };

  /**
   * Check if a new triple semantically overlaps with an existing one.
   * Returns the existing triple if overlap is found.
   */
  const findOverlap = (newTriple: { subject: string; predicate: string; object_value: string; category: string }): MemoryTriple | null => {
    for (const existing of triples) {
      if (existing.category !== newTriple.category) continue;
      
      // Same subject and predicate — check object overlap
      if (existing.subject === newTriple.subject && existing.predicate === newTriple.predicate) {
        const existWords = new Set(existing.object_value.toLowerCase().split(/\s+/));
        const newWords = newTriple.object_value.toLowerCase().split(/\s+/);
        const overlap = newWords.filter(w => existWords.has(w) && w.length > 3).length;
        const overlapRatio = overlap / Math.max(newWords.length, 1);
        if (overlapRatio > 0.4) return existing;
      }
    }
    return null;
  };

  /**
   * Check if a new triple contradicts an existing one.
   */
  const findContradiction = (newTriple: { subject: string; predicate: string; object_value: string; category: string }): MemoryTriple | null => {
    const negationPairs = [
      ["never", "always"], ["short", "long"], ["sparse", "dense"],
      ["simple", "complex"], ["formal", "casual"], ["avoid", "use"],
    ];
    
    for (const existing of triples) {
      if (existing.category !== newTriple.category) continue;
      if (existing.subject !== newTriple.subject) continue;
      
      const existLower = existing.object_value.toLowerCase();
      const newLower = newTriple.object_value.toLowerCase();
      
      for (const [a, b] of negationPairs) {
        if ((existLower.includes(a) && newLower.includes(b)) ||
            (existLower.includes(b) && newLower.includes(a))) {
          return existing;
        }
      }
    }
    return null;
  };

  /**
   * Store new triples with deduplication and contradiction detection.
   * Returns arrays of contradictions found.
   */
  const storeTriples = useCallback(async (
    newTriples: Array<{
      subject: string;
      predicate: string;
      object_value: string;
      category: string;
      confidence: number;
      source_pattern_id?: string;
    }>
  ): Promise<{ stored: number; merged: number; contradictions: Array<{ new_triple: string; existing_triple: string; existing_id: string }> }> => {
    if (!user) return { stored: 0, merged: 0, contradictions: [] };

    const toInsert: any[] = [];
    let merged = 0;
    const contradictions: Array<{ new_triple: string; existing_triple: string; existing_id: string }> = [];

    for (const t of newTriples) {
      // Check contradiction first
      const contradiction = findContradiction(t);
      if (contradiction) {
        contradictions.push({
          new_triple: `${t.subject} ${t.predicate} ${t.object_value}`,
          existing_triple: `${contradiction.subject} ${contradiction.predicate} ${contradiction.object_value}`,
          existing_id: contradiction.id,
        });
        // Lower confidence on both — don't store yet, surface to user
        if (!contradiction.locked) {
          await supabase.from("memory_triples")
            .update({ confidence: Math.max(0.3, contradiction.confidence - 0.1) })
            .eq("id", contradiction.id);
        }
        continue;
      }

      // Check overlap — merge if found
      const overlap = findOverlap(t);
      if (overlap) {
        const newConf = Math.min(1, overlap.confidence + 0.05);
        await supabase.from("memory_triples")
          .update({
            confidence: newConf,
            locked: newConf >= 0.95 || overlap.locked,
            sessions_below_threshold: 0,
            last_reinforced_at: new Date().toISOString(),
          })
          .eq("id", overlap.id);
        merged++;
        continue;
      }

      // New unique triple
      toInsert.push({
        user_id: user.id,
        subject: t.subject,
        predicate: t.predicate,
        object_value: t.object_value,
        category: t.category,
        confidence: Math.max(0, Math.min(1, t.confidence)),
        locked: t.confidence >= 0.95,
        source_pattern_id: t.source_pattern_id || null,
        last_reinforced_at: new Date().toISOString(),
      });
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from("memory_triples").insert(toInsert);
      if (error) console.error("Memori insert error:", error);
    }

    // Reload
    const { data } = await supabase
      .from("memory_triples")
      .select("*")
      .eq("user_id", user.id)
      .order("confidence", { ascending: false });
    setTriples((data ?? []) as MemoryTriple[]);

    return { stored: toInsert.length, merged, contradictions };
  }, [user, triples]);

  /**
   * Convert existing style patterns into Memori triples.
   * Called during initial migration from the old system.
   */
  const importFromPatterns = useCallback(async (patterns: Array<{
    id: string;
    category: string;
    pattern_text: string;
    checklist_question: string;
    confidence: number;
  }>) => {
    const newTriples = patterns.map(p => {
      const triple = patternToTriple(p);
      return {
        ...triple,
        source_pattern_id: p.id,
      };
    });
    return storeTriples(newTriples);
  }, [storeTriples]);

  /**
   * Reinforce triples that were validated (passed fidelity check).
   */
  const reinforceTriples = useCallback(async (tripleIds: string[], bump: number = 0.05) => {
    if (!user) return;
    for (const id of tripleIds) {
      const triple = triples.find(t => t.id === id);
      if (!triple || triple.locked) continue;
      const newConf = Math.min(1, triple.confidence + bump);
      await supabase.from("memory_triples")
        .update({
          confidence: newConf,
          locked: newConf >= 0.95,
          sessions_below_threshold: 0,
          last_reinforced_at: new Date().toISOString(),
        })
        .eq("id", id);
    }
    // Reload
    const { data } = await supabase
      .from("memory_triples")
      .select("*")
      .eq("user_id", user.id)
      .order("confidence", { ascending: false });
    setTriples((data ?? []) as MemoryTriple[]);
  }, [user, triples]);

  /**
   * Decay unreinforced triples. Delete noise (below 0.4 for 50+ sessions).
   */
  const decayTriples = useCallback(async () => {
    if (!user) return;
    const { data: all } = await supabase
      .from("memory_triples")
      .select("*")
      .eq("user_id", user.id);
    if (!all) return;

    for (const t of all as MemoryTriple[]) {
      if (t.locked) continue;
      if (t.confidence < 0.40) {
        const newSessions = t.sessions_below_threshold + 1;
        if (newSessions >= 50) {
          await supabase.from("memory_triples").delete().eq("id", t.id);
        } else {
          await supabase.from("memory_triples")
            .update({ sessions_below_threshold: newSessions })
            .eq("id", t.id);
        }
      }
    }

    const { data } = await supabase
      .from("memory_triples")
      .select("*")
      .eq("user_id", user.id)
      .order("confidence", { ascending: false });
    setTriples((data ?? []) as MemoryTriple[]);
  }, [user]);

  /**
   * Consolidate: merge low-confidence triples that overlap semantically.
   */
  const consolidate = useCallback(async () => {
    if (!user) return;
    const lowConf = triples.filter(t => !t.locked && t.confidence < 0.75);
    const merged: Set<string> = new Set();

    for (let i = 0; i < lowConf.length; i++) {
      if (merged.has(lowConf[i].id)) continue;
      for (let j = i + 1; j < lowConf.length; j++) {
        if (merged.has(lowConf[j].id)) continue;
        if (lowConf[i].category !== lowConf[j].category) continue;
        if (lowConf[i].subject !== lowConf[j].subject) continue;

        const wordsA = new Set(lowConf[i].object_value.toLowerCase().split(/\s+/));
        const wordsB = lowConf[j].object_value.toLowerCase().split(/\s+/);
        const overlap = wordsB.filter(w => wordsA.has(w) && w.length > 3).length;
        if (overlap / Math.max(wordsB.length, 1) > 0.35) {
          // Merge j into i
          const combinedConf = Math.min(1, Math.max(lowConf[i].confidence, lowConf[j].confidence) + 0.05);
          // Keep the shorter object_value (more compressed)
          const keepObject = lowConf[i].object_value.length <= lowConf[j].object_value.length
            ? lowConf[i].object_value : lowConf[j].object_value;
          await supabase.from("memory_triples")
            .update({ confidence: combinedConf, object_value: keepObject })
            .eq("id", lowConf[i].id);
          await supabase.from("memory_triples").delete().eq("id", lowConf[j].id);
          merged.add(lowConf[j].id);
        }
      }
    }

    if (merged.size > 0) {
      const { data } = await supabase
        .from("memory_triples")
        .select("*")
        .eq("user_id", user.id)
        .order("confidence", { ascending: false });
      setTriples((data ?? []) as MemoryTriple[]);
    }
  }, [user, triples]);

  /**
   * Snapshot current memory state for rollback.
   */
  const snapshot = useCallback(async (): Promise<string | null> => {
    if (!user) return null;
    const { data, error } = await supabase.from("context_snapshots").insert({
      user_id: user.id,
      snapshot_data: JSON.stringify(triples),
      model: "memori-snapshot",
      token_count: triples.reduce((sum, t) => sum + t.subject.length + t.predicate.length + t.object_value.length, 0),
    }).select("id").single();
    if (error) { console.error("Snapshot error:", error); return null; }
    return data?.id ?? null;
  }, [user, triples]);

  /**
   * Retrieve triples relevant to a prompt (by category and confidence gating).
   */
  const retrieve = useCallback((prompt: string, options?: {
    includeCharacters?: boolean;
    includeWorldRules?: boolean;
    maxTriples?: number;
  }): MemoryTriple[] => {
    const {
      includeCharacters = false,
      includeWorldRules = false,
      maxTriples = 200,
    } = options || {};

    const promptLower = prompt.toLowerCase();
    
    // Always include locked and hard rules
    let result = triples.filter(t => t.locked || t.confidence >= 0.75);
    
    // Soft suggestions (0.40-0.75)
    const soft = triples.filter(t => !t.locked && t.confidence >= 0.40 && t.confidence < 0.75);
    result = [...result, ...soft];

    // Character voices — only when prompt mentions named entities
    if (includeCharacters || /[A-Z][a-z]+/.test(prompt)) {
      const charTriples = triples.filter(t => t.category === "character_voice" && t.confidence >= 0.40);
      // Filter to only characters mentioned in prompt
      const relevant = charTriples.filter(t => {
        const charName = t.subject.replace("char:", "");
        return promptLower.includes(charName.toLowerCase());
      });
      result = [...result, ...relevant];
    }

    // World rules — only when prompt mentions world elements
    if (includeWorldRules) {
      const worldTriples = triples.filter(t => t.category === "world_rule" && t.confidence >= 0.40);
      result = [...result, ...worldTriples];
    }

    // Deduplicate
    const seen = new Set<string>();
    result = result.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    // Sort by confidence desc, then recency
    result.sort((a, b) => {
      if (a.locked && !b.locked) return -1;
      if (!a.locked && b.locked) return 1;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return (b.last_reinforced_at ?? b.created_at) > (a.last_reinforced_at ?? a.created_at) ? 1 : -1;
    });

    return result.slice(0, maxTriples);
  }, [triples]);

  /**
   * Update a single triple's text fields and/or confidence/locked state.
   */
  const updateTriple = useCallback(async (id: string, patch: Partial<Pick<MemoryTriple, "subject" | "predicate" | "object_value" | "category" | "confidence" | "locked">>) => {
    if (!user) return;
    const { error } = await supabase.from("memory_triples").update(patch).eq("id", id).eq("user_id", user.id);
    if (error) { console.error("Memori update error:", error); return; }
    setTriples(prev => prev.map(t => t.id === id ? { ...t, ...patch } as MemoryTriple : t));
  }, [user]);

  /**
   * Toggle the locked state of a triple. Locked triples are immune to decay and never overwritten.
   */
  const toggleLock = useCallback(async (id: string) => {
    const t = triples.find(x => x.id === id);
    if (!t) return;
    await updateTriple(id, { locked: !t.locked, confidence: !t.locked ? Math.max(t.confidence, 0.95) : t.confidence });
  }, [triples, updateTriple]);

  /**
   * Permanently delete a triple from memory.
   */
  const deleteTriple = useCallback(async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from("memory_triples").delete().eq("id", id).eq("user_id", user.id);
    if (error) { console.error("Memori delete error:", error); return; }
    setTriples(prev => prev.filter(t => t.id !== id));
  }, [user]);

  return {
    triples,
    loading,
    storeTriples,
    importFromPatterns,
    reinforceTriples,
    decayTriples,
    consolidate,
    snapshot,
    retrieve,
    patternToTriple,
    compressToTriple,
    updateTriple,
    toggleLock,
    deleteTriple,
  };
}
