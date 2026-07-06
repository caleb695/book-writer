import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

Look BROADLY and DEEPLY. Do not stop at surface features like "varies sentence length". Explicitly look for and extract patterns in EVERY category below whenever the text shows them repeatedly:

VOICE & PROSE
- Sentence rhythm and length distribution (fragments, punchy, long sinuous, etc.)
- Paragraph length habits and where breaks fall (mid-thought, after dialogue, etc.)
- Word choice: register (plain / literary / archaic), reliance on strong verbs vs. adverbs, favorite adjective families, avoided vocabulary
- Diction quirks: contractions, profanity level, coined words, repeated flagship words the author leans on

FIGURATIVE LANGUAGE
- Frequency of metaphor / simile (approximate: "roughly one per page", "sparingly", "dense")
- Type of imagery preferred (bodily, mechanical, elemental, natural, mythic, mundane)
- Whether metaphors are extended or single-shot
- Symbol/motif recurrence

DIALOGUE & CHARACTER VOICE
- How each recurring character speaks (vocabulary, rhythm, tics, formality, interruptions)
- Balance of dialogue vs. narration
- Use of action beats vs. speaker tags; unusual tag habits
- Subtext handling — is meaning stated or implied?

EMOTION EXPRESSION
- How the author renders feeling (physiological tells vs. labels vs. metaphor vs. dialogue subtext)
- Whether interiority is close/distant, streaming or measured
- Recurring emotional tones (dread, wistfulness, dry humor, tenderness)

STRUCTURE & PACING
- Scene opening and closing habits (hook, in medias res, quiet observation, cliffhanger)
- Chapter length habits
- POV handling and any drift patterns
- Time skips and how transitions are marked

WORLD/CONTINUITY RULES (if fiction shows worldbuilding)
- Consistent rules of magic/technology/politics
- Naming conventions
- Recurring settings and how they're described

For EVERY pattern you identify, you MUST also create a binary yes/no checklist question. These questions must be:
- Mechanically verifiable (not subjective)
- Concrete and specific
- Directly tied to the pattern observed

Examples of GOOD checklist questions:
- "Does every dialogue exchange use action beats instead of speaker tags (said/asked/replied)?"
- "Does the scene open with a character in motion rather than static description?"
- "Are sentences in tense moments kept under 15 words on average?"
- "Does at least one metaphor appear per page?"
- "Is Elena's dialogue always terse (under 8 words per line)?"

Examples of BAD checklist questions:
- "Is the writing style consistent?" (too vague)
- "Is the prose quality high?" (subjective)

Assign confidence scores honestly:
- 0.9-1.0: Pattern appears consistently with multiple clear examples
- 0.7-0.89: Pattern appears frequently but with some exceptions
- 0.5-0.69: Pattern appears sometimes, may be situational
- 0.3-0.49: Pattern appears rarely, might be coincidental
- Below 0.3: Very uncertain, limited evidence

Aim for AT LEAST 8-15 patterns per chunk when the text supports it. Do not skip a category just because it feels obvious — if the pattern is present, capture it.

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

// Given the user's currently active style prompt (custom or default) and the
// freshly extracted patterns/synthesis, ask Mistral Large to identify which
// patterns are NOT already covered in the prompt, then rewrite the prompt to
// include those missing patterns as IMPERATIVE instructions ("Use short
// sentences during combat.") — never descriptive commentary ("I noticed short
// sentences in combat."). Instructions already present are left untouched.
//
// Returns { updatedPrompt, additions } where `additions` is a count of newly
// added instructions. If the current prompt is empty or the AI fails, returns
// null and the caller keeps the existing prompt.
async function mergePatternsIntoPrompt(
  currentPrompt: string,
  synthesis: any,
  bookTitle: string,
  apiKey: string,
): Promise<{ updatedPrompt: string; additions: number } | null> {
  const trimmedPrompt = (currentPrompt || "").trim();
  if (!trimmedPrompt) return null;
  const patterns = Array.isArray(synthesis?.patterns) ? synthesis.patterns : [];
  const conventions = Array.isArray(synthesis?.genre_conventions) ? synthesis.genre_conventions : [];
  const voice = synthesis?.voice_profile || {};
  if (patterns.length === 0 && conventions.length === 0 && Object.keys(voice).length === 0) return null;

  const patternDump = [
    ...patterns.map((p: any) => `[${p.category || "pattern"} | conf ${(p.confidence ?? 0).toFixed(2)}] ${p.pattern_text} — check: ${p.checklist_question}`),
    ...conventions.map((g: any) => `[genre convention] ${g.convention} — check: ${g.checklist_question || ""}`),
  ].join("\n");

  const sys = `You are updating a novelist's style-prompt so it captures new patterns learned from an example text. Your job:

1. Read the CURRENT PROMPT the writer sends to the model on every chapter.
2. Read the NEWLY OBSERVED PATTERNS extracted from a new example.
3. For each observed pattern, decide if the CURRENT PROMPT already tells the model to do that thing (even in different words).
4. If it does NOT, add a single imperative instruction that would cause the model to produce that pattern.
5. Preserve the current prompt's structure, headings, and existing text EXACTLY. Only add new lines where appropriate. Do NOT rewrite or rephrase existing rules. Do NOT delete anything.
6. Add new instructions as bullet points under the MOST RELEVANT existing section (or create a "LEARNED FROM EXAMPLES" section at the end if no existing section fits).
7. Write instructions in IMPERATIVE form — "Use short punchy sentences during combat scenes." NEVER "I noticed short sentences during combat." Never "The author uses..."
8. Be specific and mechanical. Include named characters and their speech patterns when relevant. Include approximate frequencies ("include a metaphor roughly once per page") when the pattern is about density.
9. Do not add instructions for patterns with confidence below 0.5 unless they are unusually specific and useful.
10. Do not duplicate. If two observed patterns say the same thing, add only one instruction.

Return via the store_updated_prompt tool. Do NOT return plain text.`;

  const tool = {
    type: "function" as const,
    function: {
      name: "store_updated_prompt",
      description: "Store the updated style prompt with any newly added instructions",
      parameters: {
        type: "object",
        properties: {
          updated_prompt: { type: "string", description: "The full updated prompt with new instructions added. Existing text preserved verbatim." },
          additions_count: { type: "integer", description: "Number of NEW instructions you added (0 if the prompt already covered everything)." },
          added_instructions: { type: "array", items: { type: "string" }, description: "The exact text of each new instruction you added." },
        },
        required: ["updated_prompt", "additions_count"],
      },
    },
  };

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `CURRENT PROMPT:\n\n${trimmedPrompt}\n\n---\n\nNEWLY OBSERVED PATTERNS (from "${bookTitle}"):\n\n${patternDump}\n\nVOICE PROFILE: ${JSON.stringify(voice)}\n\nNow return the updated prompt with any missing instructions added.` },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "store_updated_prompt" } },
      temperature: 0.2,
    }),
  });

  if (!resp.ok) {
    console.error("mergePatternsIntoPrompt failed:", resp.status, await resp.text());
    return null;
  }
  const data = await resp.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) return null;
  try {
    const parsed = JSON.parse(call.function.arguments);
    const updatedPrompt = typeof parsed.updated_prompt === "string" ? parsed.updated_prompt : "";
    const additions = Number(parsed.additions_count ?? 0);
    if (!updatedPrompt.trim()) return null;
    return { updatedPrompt, additions };
  } catch (e) {
    console.error("mergePatternsIntoPrompt parse failed:", e);
    return null;
  }
}

// --- Background runner: does the chunk analysis + synthesis and writes
// progress/result to the style_analysis_jobs row. Runs inside
// EdgeRuntime.waitUntil so it survives after the HTTP response is sent.
async function runStructured(
  jobId: string,
  excerpts: string,
  bookTitle: string,
  contentHash: string | null,
  apiKey: string,
  admin: ReturnType<typeof createClient>,
  currentCustomPrompt: string,
) {

  const update = (patch: Record<string, unknown>) =>
    admin.from("style_analysis_jobs").update(patch).eq("id", jobId);

  try {
    const chunks = chunkText(excerpts);
    console.log(`analyze-style[${jobId}]: ${chunks.length} chunks from "${bookTitle}"`);
    await update({ chunks_total: chunks.length, chunks_completed: 0 });

    const chunkAnalyses: any[] = [];
    let rateLimited = false;
    for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
      const batch = chunks.slice(i, i + CHUNK_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((c, j) =>
          analyzeChunk(c, i + j, chunks.length, bookTitle, apiKey, DEFAULT_MODEL),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled") chunkAnalyses.push(r.value);
        else if ((r.reason as any)?.message === "RATE_LIMITED") rateLimited = true;
        else console.error(`chunk failed:`, (r.reason as any)?.message);
      }
      await update({ chunks_completed: chunkAnalyses.length });
      if (rateLimited) break;
    }

    if (chunkAnalyses.length === 0) {
      await update({ status: "failed", error: rateLimited ? "Rate limited — please try again later" : "All chunk analyses failed" });
      return;
    }

    let synthesis: any;
    if (chunkAnalyses.length === 1) {
      const single = chunkAnalyses[0];
      synthesis = {
        ...single,
        genre_conventions: [],
        style_cache: `Voice analysis for "${bookTitle}": ${single.detected_genre || "Unknown genre"}. ${single.patterns?.length || 0} patterns identified.`,
      };
      try {
        synthesis = await synthesizeChunks(chunkAnalyses, bookTitle, apiKey, DEFAULT_MODEL);
      } catch (e: any) {
        console.error("Synthesis failed for single chunk, using raw:", e.message);
      }
    } else {
      try {
        synthesis = await synthesizeChunks(chunkAnalyses, bookTitle, apiKey, DEFAULT_MODEL);
      } catch (e: any) {
        console.error("Synthesis failed, merging manually:", e.message);
        const allPatterns = chunkAnalyses.flatMap((a) => a.patterns || []);
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

    const patterns = synthesis.patterns || [];
    const contradictions: string[] = [];
    for (let i = 0; i < patterns.length; i++) {
      for (let j = i + 1; j < patterns.length; j++) {
        if (patterns[i].category === patterns[j].category) {
          const textA = (patterns[i].pattern_text || "").toLowerCase();
          const textB = (patterns[j].pattern_text || "").toLowerCase();
          if (
            (textA.includes("never") && textB.includes("always")) ||
            (textA.includes("short") && textB.includes("long") && textA.includes("sentence") && textB.includes("sentence"))
          ) {
            contradictions.push(`Potential conflict: "${patterns[i].pattern_text}" vs "${patterns[j].pattern_text}"`);
            patterns[i].confidence = Math.max(0.3, (patterns[i].confidence || 0.5) - 0.15);
            patterns[j].confidence = Math.max(0.3, (patterns[j].confidence || 0.5) - 0.15);
          }
        }
      }
    }
    for (const p of patterns) {
      if (p.confidence >= 0.95) p.locked = true;
    }

    // Merge into the user's active style prompt: add only patterns not already
    // covered, as imperative instructions.
    try {
      const merged = await mergePatternsIntoPrompt(currentCustomPrompt, synthesis, bookTitle, apiKey);
      if (merged) {
        synthesis.updated_custom_prompt = merged.updatedPrompt;
        synthesis.custom_prompt_additions = merged.additions;
        console.log(`analyze-style[${jobId}]: prompt merge added ${merged.additions} instruction(s)`);
      }
    } catch (e) {
      console.error(`analyze-style[${jobId}]: prompt merge failed:`, e);
    }

    await update({
      status: "done",
      synthesis,
      contradictions,
      content_hash: contentHash,
      chunks_completed: chunkAnalyses.length,
      chunks_total: chunks.length,
    });
    console.log(`analyze-style[${jobId}]: done (${chunkAnalyses.length}/${chunks.length} chunks)`);

  } catch (e) {
    console.error(`analyze-style[${jobId}] failed:`, e);
    await update({ status: "failed", error: e instanceof Error ? e.message : String(e) });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { excerpts, bookTitle, mode, contentHash, currentCustomPrompt } = await req.json();
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");
    if (!MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY is not configured");

    if (!excerpts || excerpts.trim().length < 50) {
      return jsonResponse({ error: "Not enough text to analyze" }, 400);
    }

    // Legacy synchronous plain-text mode (kept for backward compat).
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

    // --- Structured async mode: create a job row and kick off background work.
    // The HTTP response returns instantly with { jobId }; the client polls the
    // style_analysis_jobs table. This survives tab switches and app exits.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return jsonResponse({ error: "Missing Authorization" }, 401);

    // Resolve the caller so we can attribute the job to their user_id.
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return jsonResponse({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: job, error: jobErr } = await admin
      .from("style_analysis_jobs")
      .insert({
        user_id: userRes.user.id,
        file_name: String(bookTitle || "Untitled"),
        status: "running",
        content_hash: typeof contentHash === "string" ? contentHash : null,
      })
      .select("id")
      .single();
    if (jobErr || !job) {
      console.error("Failed to create style_analysis_jobs row:", jobErr);
      return jsonResponse({ error: "Failed to start analysis job" }, 500);
    }

    // @ts-ignore — EdgeRuntime is a Deno Deploy global.
    EdgeRuntime.waitUntil(
      runStructured(
        job.id,
        String(excerpts),
        String(bookTitle || "this book"),
        typeof contentHash === "string" ? contentHash : null,
        MISTRAL_API_KEY,
        admin,
      ),
    );

    return jsonResponse({ jobId: job.id, status: "running" }, 202);
  } catch (e) {
    console.error("analyze-style error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

