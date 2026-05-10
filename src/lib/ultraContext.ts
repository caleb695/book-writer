import type { MemoryTriple } from "@/hooks/useMemori";
import type { StyleMemory, GoldenExample } from "@/hooks/useStyleMemory";

/**
 * UltraContext: Live context assembly layer.
 * Sits on top of Memori. Decides which triples actually enter the context window.
 * Strips reconstructable data, compacts redundancy, enforces token budgets.
 * Auto-versions every context state.
 */

// Approximate token count (rough: 1 token ≈ 4 chars)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Token budget ceilings per model family
const MODEL_TOKEN_BUDGETS: Record<string, number> = {
  "mistral-large": 6000,
  "mistral-medium": 4000,
  "mistral-small": 3000,
  "ministral": 2000,
  "magistral": 5000,
  "llama-3.3-70b": 5000,
  "llama-3.1-8b": 2500,
  "llama-4-scout": 4000,
  "kimi-k2": 5000,
  "gpt-oss-120b": 6000,
  "gpt-oss-20b": 3000,
  "gemma-4": 4000,
  "gemma-3": 3500,
  "nemotron-3-super": 5000,
  "nemotron-nano": 2500,
  "qwen3": 4000,
  default: 4000,
};

function getTokenBudget(model: string): number {
  for (const [key, budget] of Object.entries(MODEL_TOKEN_BUDGETS)) {
    if (key !== "default" && model.toLowerCase().includes(key)) return budget;
  }
  return MODEL_TOKEN_BUDGETS.default;
}

export interface UltraContextPayload {
  /** The assembled prompt injection text */
  injection: string;
  /** Token count of the injection */
  tokenCount: number;
  /** Number of triples included */
  triplesIncluded: number;
  /** Number of triples filtered out */
  triplesFiltered: number;
  /** Snapshot for versioning */
  snapshot: {
    triples: string[];
    layers: string[];
    model: string;
    budget: number;
    timestamp: string;
  };
}

export interface UltraContextOptions {
  model: string;
  /** Requested word count — scales injection size */
  requestedWordCount?: number;
  /** Whether this is a short or long generation */
  isShortGeneration?: boolean;
  /** Voice profile from StyleMemory */
  voiceProfile?: Record<string, any>;
  /** Genre conventions */
  genreConventions?: Array<{ convention: string; checklist_question: string }>;
  /** Detected genre */
  detectedGenre?: string;
  /** Style cache summary */
  styleCache?: string;
  /** Failure log entries */
  failureLog?: Array<{ violation_text: string; occurrence_count: number }>;
  /** Last 2 session summaries */
  sessionSummaries?: string[];
  /** Top 5 golden examples */
  goldenExamples?: Array<{ content: string; fidelity_score: number }>;
}

/**
 * Assemble the final context payload from Memori triples.
 * Fixed layer order:
 * 1. Voice profile + locked patterns
 * 2. Hard rules (≥0.75)
 * 3. Soft suggestions (0.40-0.75)
 * 4. Thematic fingerprint
 * 5. Failure log
 * 6. Last 2 session summaries
 * 7. Character voices & world memory (only when prompt mentions entities)
 * 8. Top 5 golden examples
 */
export function assembleContext(
  triples: MemoryTriple[],
  options: UltraContextOptions
): UltraContextPayload {
  const budget = getTokenBudget(options.model);
  const scaleFactor = options.isShortGeneration ? 0.3 : 1.0;
  const effectiveBudget = Math.floor(budget * scaleFactor);
  
  const layers: string[] = [];
  let usedTokens = 0;
  let triplesIncluded = 0;
  let triplesFiltered = 0;
  const includedTripleIds: string[] = [];

  const addLayer = (label: string, content: string): boolean => {
    const tokens = estimateTokens(content);
    if (usedTokens + tokens > effectiveBudget) {
      // Truncate to fit
      const remaining = effectiveBudget - usedTokens;
      if (remaining > 50) {
        const truncated = content.slice(0, remaining * 4);
        layers.push(`[${label}]\n${truncated}`);
        usedTokens += remaining;
        return true;
      }
      return false;
    }
    layers.push(`[${label}]\n${content}`);
    usedTokens += tokens;
    return true;
  };

  // Layer 1: Voice profile + locked patterns
  if (options.voiceProfile && Object.keys(options.voiceProfile).length > 0) {
    const vpLines = Object.entries(options.voiceProfile)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join("; ");
    addLayer("VOICE", vpLines);
  }

  const locked = triples.filter(t => t.locked);
  if (locked.length > 0) {
    const lockedText = locked.map(t => `• ${t.object_value}`).join("\n");
    if (addLayer("LOCKED", lockedText)) {
      triplesIncluded += locked.length;
      locked.forEach(t => includedTripleIds.push(t.id));
    }
  }

  // For short generations, stop here — only locked + failure log
  if (options.isShortGeneration) {
    // Add failure log only
    if (options.failureLog && options.failureLog.length > 0) {
      const failText = options.failureLog
        .sort((a, b) => b.occurrence_count - a.occurrence_count)
        .slice(0, 5)
        .map(f => `• AVOID: ${f.violation_text} (×${f.occurrence_count})`)
        .join("\n");
      addLayer("FAILURES", failText);
    }

    triplesFiltered = triples.length - triplesIncluded;
    return buildPayload(layers, usedTokens, triplesIncluded, triplesFiltered, includedTripleIds, options);
  }

  // Layer 2: Hard rules
  const hard = triples.filter(t => !t.locked && t.confidence >= 0.75);
  if (hard.length > 0) {
    const hardText = hard.map(t => `• ${t.object_value}`).join("\n");
    if (addLayer("RULES", hardText)) {
      triplesIncluded += hard.length;
      hard.forEach(t => includedTripleIds.push(t.id));
    }
  }

  // Layer 3: Soft suggestions
  const soft = triples.filter(t => !t.locked && t.confidence >= 0.40 && t.confidence < 0.75);
  if (soft.length > 0) {
    const softText = soft.map(t => `• ${t.object_value}`).join("\n");
    if (addLayer("SUGGESTIONS", softText)) {
      triplesIncluded += soft.length;
      soft.forEach(t => includedTripleIds.push(t.id));
    }
  }

  // Layer 4: Thematic fingerprint
  const thematic = triples.filter(t => t.category === "thematic" && !includedTripleIds.includes(t.id));
  if (thematic.length > 0) {
    const thematicText = thematic.map(t => `• ${t.object_value}`).join("\n");
    if (addLayer("THEMES", thematicText)) {
      triplesIncluded += thematic.length;
    }
  }

  // Layer 5: Failure log
  if (options.failureLog && options.failureLog.length > 0) {
    const failText = options.failureLog
      .sort((a, b) => b.occurrence_count - a.occurrence_count)
      .slice(0, 10)
      .map(f => `• AVOID: ${f.violation_text} (×${f.occurrence_count})`)
      .join("\n");
    addLayer("FAILURES", failText);
  }

  // Layer 6: Last 2 session summaries
  if (options.sessionSummaries && options.sessionSummaries.length > 0) {
    const sessText = options.sessionSummaries.slice(0, 2).join("\n");
    addLayer("RECENT", sessText);
  }

  // Layer 7: Character voices & world rules (already filtered by retrieve())
  const charWorld = triples.filter(t =>
    (t.category === "character_voice" || t.category === "world_rule") &&
    !includedTripleIds.includes(t.id)
  );
  if (charWorld.length > 0) {
    const cwText = charWorld.map(t => `• [${t.category}] ${t.subject}: ${t.object_value}`).join("\n");
    if (addLayer("WORLD", cwText)) {
      triplesIncluded += charWorld.length;
    }
  }

  // Layer 8: Genre conventions
  if (options.genreConventions && options.genreConventions.length > 0) {
    const gcText = options.genreConventions.map(g => `• ${g.convention}`).join("\n");
    addLayer("GENRE", gcText);
  }

  // Layer 9: Top 5 golden examples (last, heaviest)
  if (options.goldenExamples && options.goldenExamples.length > 0) {
    const examples = options.goldenExamples
      .sort((a, b) => b.fidelity_score - a.fidelity_score)
      .slice(0, 5);
    for (const ex of examples) {
      // Only include a brief excerpt (first 200 chars)
      const excerpt = ex.content.slice(0, 200).trim();
      if (!addLayer(`GOLDEN(${(ex.fidelity_score * 100).toFixed(0)}%)`, excerpt)) break;
    }
  }

  // Style cache summary
  if (options.styleCache) {
    addLayer("STYLE", options.styleCache);
  }

  triplesFiltered = triples.length - triplesIncluded;
  return buildPayload(layers, usedTokens, triplesIncluded, triplesFiltered, includedTripleIds, options);
}

function buildPayload(
  layers: string[],
  usedTokens: number,
  triplesIncluded: number,
  triplesFiltered: number,
  includedTripleIds: string[],
  options: UltraContextOptions
): UltraContextPayload {
  return {
    injection: layers.join("\n\n"),
    tokenCount: usedTokens,
    triplesIncluded,
    triplesFiltered,
    snapshot: {
      triples: includedTripleIds,
      layers: layers.map(l => l.split("\n")[0]),
      model: options.model,
      budget: getTokenBudget(options.model),
      timestamp: new Date().toISOString(),
    },
  };
}
