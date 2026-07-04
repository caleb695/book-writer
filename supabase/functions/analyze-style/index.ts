import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_URL = "https://api.mistral.ai/v1/chat/completions";
// Always pin style analysis to Mistral Large (currently v3 = "mistral-large-latest").
// Do NOT parametrize — style extraction quality is critical and must use the
// strongest available model regardless of the user's chapter-generation model.
const DEFAULT_MODEL = "mistral-large-latest";
const CHUNK_CONCURRENCY = 4;

// --- Chunking ---
function chunkText(text: string, maxWordsPerChunk = 1500): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 5000) {
    // Small text: single chunk
    return [words.join(" ")];
  }
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWordsPerChunk) {
    chunks.push(words.slice(i, i + maxWordsPerChunk).join(" "));
  }
  return chunks;
}

// --- Tool schema for structured extraction ---
const PATTERN_EXTRACTION_TOOL = {
  type: "function" as const,
  function: {
    name: "store_patterns",
    description: "Store extracted writing patterns with confidence scores and binary checklist questions",
    parameters: {
      type: "object",
      properties: {
        voice_profile: {
          type: "object",
          properties: {
            narrative_distance: { type: "string", description: "Close, medium, or distant" },
            formality_level: { type: "string", description: "Casual, neutral, formal, literary" },
            emotional_register: { type: "string", description: "Primary emotional tone" },
            sentence_rhythm: { type: "string", description: "Staccato, flowing, varied, etc." },
            vocabulary_complexity: { type: "string", description: "Simple, moderate, complex, mixed" },
            dialogue_style: { type: "string", description: "How dialogue is typically handled" },
            description_density: { type: "string", description: "Sparse, moderate, dense, purple" },
            pov_handling: { type: "string", description: "How POV is managed" },
          },
          required: ["narrative_distance", "formality_level", "emotional_register", "sentence_rhythm", "vocabulary_complexity", "dialogue_style", "description_density", "pov_handling"],
        },
        patterns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["voice", "recurring", "thematic", "character_voice", "world_rule"] },
              pattern_text: { type: "string", description: "Clear description of the pattern observed" },
              checklist_question: { type: "string", description: "A concrete yes/no question to check if output follows this pattern. Must be binary and mechanically verifiable." },
              confidence: { type: "number", description: "How confident you are this is a real pattern (0.0 to 1.0). Use 0.9+ only for patterns with multiple clear examples." },
              examples: {
                type: "array",
                items: { type: "string" },
                description: "1-3 short verbatim excerpts demonstrating this pattern",
              },
            },
            required: ["category", "pattern_text", "checklist_question", "confidence"],
          },
        },
        thematic_fingerprint: {
          type: "object",
          properties: {
            core_themes: { type: "array", items: { type: "string" } },
            recurring_motifs: { type: "array", items: { type: "string" } },
            subtext_tendencies: { type: "string" },
          },
          required: ["core_themes", "recurring_motifs", "subtext_tendencies"],
        },
        detected_genre: { type: "string", description: "Primary genre detected (e.g., literary fiction, fantasy, thriller, romance, sci-fi, horror, etc.)" },
      },
      required: ["voice_profile", "patterns", "thematic_fingerprint", "detected_genre"],
    },
  },
};

// --- Synthesis tool schema ---
const SYNTHESIS_TOOL = {
  type: "function" as const,
  function: {
    name: "store_synthesis",
    description: "Store the synthesized unified style analysis merging all chunks",
    parameters: {
      type: "object",
      properties: {
        voice_profile: PATTERN_EXTRACTION_TOOL.function.parameters.properties.voice_profile,
        patterns: PATTERN_EXTRACTION_TOOL.function.parameters.properties.patterns,
        thematic_fingerprint: PATTERN_EXTRACTION_TOOL.function.parameters.properties.thematic_fingerprint,
        detected_genre: { type: "string" },
        genre_conventions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              convention: { type: "string" },
              checklist_question: { type: "string" },
            },
            required: ["convention", "checklist_question"],
          },
          description: "Genre-specific writing conventions that should be followed",
        },
        style_cache: { type: "string", description: "A plain-language summary of the full writing style (2-4 paragraphs) for fast injection into prompts" },
      },
      required: ["voice_profile", "patterns", "thematic_fingerprint", "detected_genre", "genre_conventions", "style_cache"],
    },
  },
};

const CHUNK_SYSTEM_PROMPT = `You are an expert writing style analyzer. You analyze text excerpts and extract concrete, measurable writing patterns.

For EVERY pattern you identify, you MUST also create a binary yes/no checklist question. These questions must be:
- Mechanically verifiable (not subjective)
- Concrete and specific (not vague like "is the writing good?")  
- Directly tied to the pattern observed

Examples of GOOD checklist questions:
- "Does every dialogue exchange use action beats instead of speaker tags (said/asked/replied)?"
- "Does the scene open with a character in motion rather than static description?"
- "Are sentences in tense moments kept under 15 words on average?"
- "Does the POV stay strictly in one character's head per scene?"

Examples of BAD checklist questions:
- "Is the writing style consistent?" (too vague)
- "Is the prose quality high?" (subjective)

Assign confidence scores honestly:
- 0.9-1.0: Pattern appears consistently with multiple clear examples
- 0.7-0.89: Pattern appears frequently but with some exceptions
- 0.5-0.69: Pattern appears sometimes, may be situational
- 0.3-0.49: Pattern appears rarely, might be coincidental
- Below 0.3: Very uncertain, limited evidence

You MUST call the store_patterns function with your analysis. Do NOT return plain text.`;

const SYNTHESIS_SYSTEM_PROMPT = `You are merging multiple chunk-level writing style analyses into one unified style profile. You have analyses from different sections of the same text.

Your job:
1. MERGE patterns that describe the same thing — combine evidence, average confidence scores, keep the best checklist question.
2. RESOLVE contradictions — if chunks disagree, go with the pattern that has more evidence and note the lower confidence.
3. BOOST confidence for patterns that appear across multiple chunks (add 0.1 for each additional chunk, max 1.0).
4. REDUCE confidence for patterns only found in one chunk by 0.1.
5. DETECT the genre and add genre-specific conventions as additional checklist items.
6. Write a plain-language style_cache summary (2-4 paragraphs) capturing the author's voice for fast prompt injection.

For genre conventions, add rules like:
- Fantasy: "Does dialogue avoid modern slang unless the world explicitly uses it?"
- Thriller: "Does each chapter end on a hook or cliffhanger?"
- Romance: "Are both love interests given equal interiority and agency?"
- Literary fiction: "Does prose use metaphor/simile at least once per page?"

You MUST call the store_synthesis function. Do NOT return plain text.`;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function analyzeChunk(
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  bookTitle: string,
  apiKey: string,
  model: string
): Promise<any> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: CHUNK_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Analyze chunk ${chunkIndex + 1} of ${totalChunks} from "${bookTitle}":\n\n${chunk}`,
        },
      ],
      tools: [PATTERN_EXTRACTION_TOOL],
      tool_choice: { type: "function", function: { name: "store_patterns" } },
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const t = await response.text();
    console.error(`Chunk ${chunkIndex + 1} API error:`, response.status, t);
    if (response.status === 429) throw new Error("RATE_LIMITED");
    throw new Error(`Chunk analysis failed (${response.status})`);
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    console.error(`Chunk ${chunkIndex + 1}: No tool call in response`);
    throw new Error("AI did not return structured data");
  }

  try {
    return JSON.parse(toolCall.function.arguments);
  } catch (e) {
    console.error(`Chunk ${chunkIndex + 1}: Failed to parse tool args`, e);
    throw new Error("Failed to parse AI response");
  }
}

async function synthesizeChunks(
  chunkAnalyses: any[],
  bookTitle: string,
  apiKey: string,
  model: string
): Promise<any> {
  const chunksText = chunkAnalyses
    .map((a, i) => `=== CHUNK ${i + 1} ANALYSIS ===\n${JSON.stringify(a, null, 2)}`)
    .join("\n\n");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Merge these ${chunkAnalyses.length} chunk analyses from "${bookTitle}" into one unified style profile:\n\n${chunksText}`,
        },
      ],
      tools: [SYNTHESIS_TOOL],
      tool_choice: { type: "function", function: { name: "store_synthesis" } },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const t = await response.text();
    console.error("Synthesis API error:", response.status, t);
    if (response.status === 429) throw new Error("RATE_LIMITED");
    throw new Error(`Synthesis failed (${response.status})`);
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) {
    throw new Error("Synthesis did not return structured data");
  }

  return JSON.parse(toolCall.function.arguments);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { excerpts, bookTitle, mode } = await req.json();
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");
    if (!MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY is not configured");

    if (!excerpts || excerpts.trim().length < 50) {
      return jsonResponse({ error: "Not enough text to analyze" }, 400);
    }

    // Mode "legacy" returns plain text analysis for backward compat
    if (mode === "legacy") {
      const systemPrompt = `You are an expert literary analyst. Analyze the writing style and produce a comprehensive style guide covering sentence structure, vocabulary, narrative voice, tone, dialogue style, description style, pacing, POV handling, and distinctive quirks. Be detailed and objective.`;
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Analyze the writing style of "${bookTitle || "this book"}":\n\n${excerpts}` },
          ],
        }),
      });
      if (!response.ok) {
        if (response.status === 429) return jsonResponse({ error: "Rate limited. Please wait and try again." }, 429);
        return jsonResponse({ error: "Style analysis failed" }, 500);
      }
      const data = await response.json();
      return jsonResponse({ analysis: data.choices?.[0]?.message?.content || "" }, 200);
    }

    // --- Structured analysis mode ---
    const chunks = chunkText(excerpts);
    console.log(`analyze-style: ${chunks.length} chunks from "${bookTitle}"`);

    // Analyze chunks in parallel with a small concurrency window to cut
    // latency roughly Nx for large books without hammering the rate limit.
    const chunkAnalyses: any[] = [];
    let rateLimited = false;
    for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
      const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((c, j) =>
          analyzeChunk(c, i + j, chunks.length, bookTitle || "this book", MISTRAL_API_KEY, DEFAULT_MODEL),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled") chunkAnalyses.push(r.value);
        else if (r.reason?.message === "RATE_LIMITED") rateLimited = true;
        else console.error("chunk failed:", r.reason?.message);
      }
      if (rateLimited) break;
    }
    if (rateLimited && chunkAnalyses.length === 0) {
      return jsonResponse({ error: "Rate limited. Please wait and try again." }, 429);
    }

    if (chunkAnalyses.length === 0) {
      return jsonResponse({ error: "All chunk analyses failed" }, 500);
    }

    // Synthesize if multiple chunks, otherwise use the single result directly
    let synthesis: any;
    if (chunkAnalyses.length === 1) {
      // Single chunk — wrap it in synthesis format
      const single = chunkAnalyses[0];
      synthesis = {
        ...single,
        genre_conventions: [],
        style_cache: `Voice analysis for "${bookTitle}": ${single.detected_genre || "Unknown genre"}. ${single.patterns?.length || 0} patterns identified.`,
      };
      // Still do a quick synthesis to get genre conventions and style_cache
      try {
        synthesis = await synthesizeChunks(chunkAnalyses, bookTitle || "this book", MISTRAL_API_KEY, DEFAULT_MODEL);
      } catch (e: any) {
        console.error("Synthesis failed for single chunk, using raw:", e.message);
      }
    } else {
      try {
        synthesis = await synthesizeChunks(chunkAnalyses, bookTitle || "this book", MISTRAL_API_KEY, DEFAULT_MODEL);
      } catch (e: any) {
        if (e.message === "RATE_LIMITED") {
          return jsonResponse({ error: "Rate limited during synthesis. Please try again.", partialResults: chunkAnalyses }, 429);
        }
        // Fallback: merge manually
        console.error("Synthesis failed, merging manually:", e.message);
        const allPatterns = chunkAnalyses.flatMap(a => a.patterns || []);
        synthesis = {
          voice_profile: chunkAnalyses[0].voice_profile,
          patterns: allPatterns,
          thematic_fingerprint: chunkAnalyses[0].thematic_fingerprint,
          detected_genre: chunkAnalyses[0].detected_genre,
          genre_conventions: [],
          style_cache: `Manually merged from ${chunkAnalyses.length} chunks. ${allPatterns.length} total patterns.`,
        };
      }
    }

    // Check patterns for contradictions before returning
    const patterns = synthesis.patterns || [];
    const contradictions: string[] = [];
    for (let i = 0; i < patterns.length; i++) {
      for (let j = i + 1; j < patterns.length; j++) {
        // Simple heuristic: same category patterns with very different meanings
        if (patterns[i].category === patterns[j].category) {
          const textA = (patterns[i].pattern_text || "").toLowerCase();
          const textB = (patterns[j].pattern_text || "").toLowerCase();
          // Flag obvious contradictions (contains negation of the other)
          if (
            (textA.includes("never") && textB.includes("always") && patterns[i].category === patterns[j].category) ||
            (textA.includes("short") && textB.includes("long") && textA.includes("sentence") && textB.includes("sentence"))
          ) {
            contradictions.push(`Potential conflict: "${patterns[i].pattern_text}" vs "${patterns[j].pattern_text}"`);
            // Lower confidence on both
            patterns[i].confidence = Math.max(0.3, (patterns[i].confidence || 0.5) - 0.15);
            patterns[j].confidence = Math.max(0.3, (patterns[j].confidence || 0.5) - 0.15);
          }
        }
      }
    }

    // Lock patterns above 0.95
    for (const p of patterns) {
      if (p.confidence >= 0.95) p.locked = true;
    }

    return jsonResponse({
      synthesis,
      chunksAnalyzed: chunkAnalyses.length,
      totalChunks: chunks.length,
      contradictions,
      // Also return legacy-compatible analysis text
      analysis: synthesis.style_cache || "",
    }, 200);
  } catch (e) {
    console.error("analyze-style error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
