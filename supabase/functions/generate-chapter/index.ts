import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const LOVABLE_API_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MEGANOVA_API_URL = "https://api.meganova.ai/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-pro";

const OUTLINE_MAX_CHARS = 30_000;
const CONTEXT_TOTAL_MAX_CHARS = 20_000;
const CONTEXT_ITEM_MAX_CHARS = 10_000;
const PREVIOUS_CHAPTERS_MAX_CHARS = 16_000;
const STYLE_GUIDES_TOTAL_MAX_CHARS = 30_000;
const STYLE_GUIDE_ITEM_MAX_CHARS = 15_000;
const PARTIAL_CONTENT_MAX_CHARS = 8_000;
const FULL_MANUSCRIPT_MAX_CHARS = 40_000;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function sampleLongText(text: string, maxChars: number): string {
  const cleaned = normalizeText(text);
  if (!cleaned || cleaned.length <= maxChars) return cleaned;
  const divider = "\n\n[... condensed ...]\n\n";
  const seg = Math.max(120, Math.floor((maxChars - divider.length * 2) / 3));
  const mid = Math.max(seg, Math.floor(cleaned.length / 2) - Math.floor(seg / 2));
  const excerpt = [cleaned.slice(0, seg), cleaned.slice(mid, mid + seg), cleaned.slice(-seg)].join(divider);
  return excerpt.length > maxChars ? excerpt.slice(0, maxChars) : excerpt;
}

function takeTail(text: string, maxChars: number): string {
  const cleaned = normalizeText(text);
  if (!cleaned || cleaned.length <= maxChars) return cleaned;
  const prefix = "[Earlier content omitted]\n\n";
  return `${prefix}${cleaned.slice(-(maxChars - prefix.length))}`;
}

function compressCollection(values: unknown, totalMax: number, perItem: number, mode: "sample" | "tail" = "sample"): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  let used = 0;
  for (const v of values) {
    const c = normalizeText(v);
    if (!c) continue;
    const rem = totalMax - used;
    if (rem < 500) break;
    const budget = Math.min(perItem, rem);
    const excerpt = mode === "tail" ? takeTail(c, budget) : sampleLongText(c, budget);
    if (!excerpt) continue;
    result.push(excerpt);
    used += excerpt.length;
  }
  return result;
}

function extractRelevantOutline(outline: string, ch: number): string {
  const cleaned = normalizeText(outline);
  if (!cleaned) return "";
  const next = ch + 1;
  for (const p of [
    new RegExp(`(^|\\n)(chapter\\s*${ch}\\b[\\s\\S]*?)(?=(\\nchapter\\s*${next}\\b)|$)`, "i"),
    new RegExp(`(^|\\n)(ch\\.?\\s*${ch}\\b[\\s\\S]*?)(?=(\\nch\\.?\\s*${next}\\b)|$)`, "i"),
  ]) {
    const m = cleaned.match(p);
    if (m?.[2]) return sampleLongText(m[2], OUTLINE_MAX_CHARS);
  }
  return sampleLongText(cleaned, OUTLINE_MAX_CHARS);
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Determine which provider to use based on model ID
type Provider = "mistral" | "groq" | "openrouter" | "lovable" | "meganova" | "kaggle";

const GROQ_MODELS = new Set([
  "qwen/qwen3-32b", "llama-3.1-8b-instant", "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "moonshotai/kimi-k2-instruct", "moonshotai/kimi-k2-instruct-0905",
  "openai/gpt-oss-120b", "openai/gpt-oss-20b",
]);
const OPENROUTER_MODELS = new Set([
  "google/gemma-4-26b-a4b-it", "google/gemma-4-31b-it",
  "nvidia/nemotron-3-super", "nvidia/nemotron-3-nano-30b-a3b",
  "nvidia/nemotron-nano-12b-2-vl", "qwen/qwen3-next-80b-a3b-instruct",
  "nvidia/nemotron-nano-9b-v2", "google/gemma-3-27b-it",
  "meta-llama/llama-3.3-70b-instruct", "meta-llama/llama-3.2-3b-instruct",
]);
const MEGANOVA_MODELS = new Set([
  "BruhzWater/Sapphira-L3.3-70b-0.1",
  "FallenMerick/MN-Violet-Lotus-12B",
  "Steelskull/L3.3-MS-Nevoria-70b",
  "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
  "Sao10K/L3-70B-Euryale-v2.1",
]);

// Context windows verified live from https://api.meganova.ai/v1/models.
// We MUST budget input + output to fit, otherwise the request is silently truncated
// or the model returns garbage / empty completions.
const MEGANOVA_CONTEXT_WINDOWS: Record<string, number> = {
  "BruhzWater/Sapphira-L3.3-70b-0.1": 65_536,
  "FallenMerick/MN-Violet-Lotus-12B": 65_536,
  "Steelskull/L3.3-MS-Nevoria-70b": 65_536,
  "mistralai/Mistral-Small-3.2-24B-Instruct-2506": 32_768,
  "Sao10K/L3-70B-Euryale-v2.1": 8_192,
};

// Rough estimator: 1 token ≈ 3.6 chars of English prose. Be conservative.
function approxTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

/**
 * For MegaNova models, hard-trim a candidate string so total input tokens
 * (system + user) stay safely under the context window minus the desired
 * completion budget. Returns the (possibly shortened) string.
 */
function fitToBudget(text: string, maxTokens: number): string {
  if (!text) return text;
  const maxChars = Math.max(0, Math.floor(maxTokens * 3.6));
  if (text.length <= maxChars) return text;
  // Keep the start (instructions / outline) and the tail (most recent context).
  const head = text.slice(0, Math.floor(maxChars * 0.55));
  const tail = text.slice(-Math.floor(maxChars * 0.4));
  return `${head}\n\n[... condensed to fit model context window ...]\n\n${tail}`;
}

function getProvider(model: string): Provider {
  if (model.startsWith("kaggle/")) return "kaggle";
  if (MEGANOVA_MODELS.has(model)) return "meganova";
  if (GROQ_MODELS.has(model)) return "groq";
  if (OPENROUTER_MODELS.has(model)) return "openrouter";
  if (/^google\/gemini-/.test(model)) return "lovable";
  if (/^openai\/gpt-5/.test(model)) return "lovable";
  if (/^mistral|^ministral|^magistral|^codestral|^pixtral/i.test(model)) return "mistral";
  return "lovable";
}

function mapModelForProvider(model: string, provider: Provider): string {
  if (provider === "lovable") {
    if (/^google\/gemini-/.test(model) || /^openai\/gpt-5/.test(model)) return model;
    return "google/gemini-2.5-pro";
  }
  if (provider === "mistral") {
    if (/^mistral|^ministral|^magistral|^codestral|^pixtral/i.test(model)) return model;
    return "mistral-large-latest";
  }
  return model;
}

function getApiConfig(provider: Provider): { apiUrl: string; apiKey: string; extraHeaders: Record<string, string> } | null {
  const extraHeaders: Record<string, string> = {};
  if (provider === "groq") {
    const k = Deno.env.get("GROQ_API_KEY");
    if (!k) return null;
    return { apiUrl: GROQ_API_URL, apiKey: k, extraHeaders };
  }
  if (provider === "openrouter") {
    const k = Deno.env.get("OPENROUTER_API_KEY");
    if (!k) return null;
    extraHeaders["HTTP-Referer"] = "https://book-writer.lovable.app";
    extraHeaders["X-Title"] = "Loom & Ink";
    return { apiUrl: OPENROUTER_API_URL, apiKey: k, extraHeaders };
  }
  if (provider === "mistral") {
    const k = Deno.env.get("MISTRAL_API_KEY");
    if (!k) return null;
    return { apiUrl: MISTRAL_API_URL, apiKey: k, extraHeaders };
  }
  if (provider === "meganova") {
    const k = Deno.env.get("MEGANOVA_API_KEY");
    if (!k) return null;
    return { apiUrl: MEGANOVA_API_URL, apiKey: k, extraHeaders };
  }
  const k = Deno.env.get("LOVABLE_API_KEY");
  if (!k) return null;
  return { apiUrl: LOVABLE_API_URL, apiKey: k, extraHeaders };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const chapterNumber = Number.isFinite(Number(body.chapterNumber)) ? Number(body.chapterNumber) : 1;
    const outline = extractRelevantOutline(body.outline, chapterNumber);
    const contextBooks = compressCollection(body.contextBooks, CONTEXT_TOTAL_MAX_CHARS, CONTEXT_ITEM_MAX_CHARS, "sample");
    const rewriteNotes = normalizeText(body.rewriteNotes);
    const previousChapters = takeTail(body.previousChapters ?? "", PREVIOUS_CHAPTERS_MAX_CHARS);
    const fullManuscript = sampleLongText(body.fullManuscript ?? "", FULL_MANUSCRIPT_MAX_CHARS);
    const wordCountInstruction = normalizeText(body.wordCountInstruction);
    const perspective = normalizeText(body.perspective);
    const fictionType = normalizeText(body.fictionType);
    const styleGuides = compressCollection(body.styleGuides, STYLE_GUIDES_TOTAL_MAX_CHARS, STYLE_GUIDE_ITEM_MAX_CHARS, "sample");
    const partialContent = takeTail(body.partialContent ?? "", PARTIAL_CONTENT_MAX_CHARS);

    const structuredMemory = body.structuredMemory || null;
    const checklist = Array.isArray(body.checklist) ? body.checklist : [];
    const ultraContextInjection = normalizeText(body.ultraContextInjection);

    const model = normalizeText(body.model) || DEFAULT_MODEL;
    const temperature = typeof body.temperature === "number" ? Math.max(0, Math.min(1, body.temperature)) : 0.7;
    const top_p = typeof body.top_p === "number" ? Math.max(0, Math.min(1, body.top_p)) : 0.9;
    const kaggleEndpoint = body.kaggleEndpoint && typeof body.kaggleEndpoint === "object" ? body.kaggleEndpoint as { url?: string; apiKey?: string; hfRepo?: string; contextWindow?: number } : null;

    if (!outline) return jsonResponse({ error: "Outline is required" }, 400);

    const primaryProvider = getProvider(model);
    console.log("generate-chapter routing", JSON.stringify({ model, primaryProvider }));

    const styleGuideText = sampleLongText(styleGuides.join("\n\n---\n\n"), 12_000);
    const contextBooksText = contextBooks.map((b, i) => `--- BOOK ${i + 1} ---\n${b}`).join("\n\n");
    const hasStructuredMemory = structuredMemory && checklist.length > 0;

    console.log("generate-chapter", JSON.stringify({ chapterNumber, model, primaryProvider, temperature, top_p, outlineLen: outline.length, contextLen: contextBooksText.length, prevLen: previousChapters.length, manuscriptLen: fullManuscript.length, partialLen: partialContent.length, checklistLen: checklist.length, hasMemory: !!hasStructuredMemory, fictionType }));

    // Build system prompt
    let systemPrompt = `You are a professional novelist writing a full chapter of a real commercial-fiction book. You write with the depth, richness, and emotional resonance of a bestselling author.

OUTPUT FORMAT:
- Your VERY FIRST line of output must be the chapter heading in this exact format:
  ## Chapter ${chapterNumber}: [Chapter Title from the outline]
- After the heading, leave one blank line, then begin the chapter prose.
- Output ONLY the chapter heading and the chapter prose. No greetings, no commentary, no sign-offs, no "Here is your chapter", no notes to the user. Just the heading and the story.

ABSOLUTE RULES — VIOLATION OF ANY OF THESE IS UNACCEPTABLE:

1. ONLY write Chapter ${chapterNumber}. Do NOT include ANY events, reveals, plot points, dialogue, or details from ANY other chapter's outline — not even as foreshadowing, flashforward, or teaser. If the outline for chapter ${chapterNumber} does not mention it, it does NOT belong in this chapter.

2. Include EVERY idea, beat, and detail listed in the Chapter ${chapterNumber} outline. Nothing may be dropped, glossed over, or summarized. Each outline point must receive substantial prose treatment — multiple paragraphs per bullet point.

3. NEVER summarize. NEVER "tell" when you can "show." NEVER write lines like "they argued for hours" or "she explained everything" or "the battle raged on" or "she felt sad" or "he was angry." Every argument, explanation, emotion, and event must be SHOWN through dramatized real-time prose — actual dialogue, physical reactions, body language, sensory detail, and internal experience. The reader should EXPERIENCE the emotion, not be told about it.

4. SHOW, DON'T TELL — This is your most critical writing principle:
   - Instead of "She was nervous," write her fidgeting, her dry mouth, her racing thoughts, her halting speech.
   - Instead of "He was angry," write his clenched jaw, his sharp words, the vein pulsing in his temple, the way his voice dropped dangerously low.
   - Instead of "The room was beautiful," describe the gilt molding catching afternoon light, the scent of fresh flowers on the mahogany table, the whisper of silk curtains in the breeze.
   - Instead of "They had a long conversation," write EVERY line of dialogue with beats, gestures, pauses, and emotional subtext.
   - Emotion must be felt through physiological reactions, behavior, dialogue tone, and internal monologue — NEVER through labels like "sad," "happy," "scared" unless in dialogue.

5. Write dramatized, real-time prose at all times with HEAVY emphasis on dialogue and emotion:
   - All conversations must be written as EXTENDED, FULL dialogue exchanges — not summaries. Characters argue, persuade, deflect, joke, interrupt, trail off, change tone mid-sentence. Include subtext, pauses, gestures, blocking, and emotional undercurrents in every exchange. Dialogue should feel alive and real.
   - All action/fight scenes must be written blow-by-blow with visceral physical detail, movement, pain, adrenaline, and spatial awareness.
   - All emotional moments must include deep internal monologue, sensory reactions, body language, memories triggered by the moment, and layered psychological depth. Let the reader FEEL what the character feels.

6. EXPAND MASSIVELY on every outline point. This is NON-NEGOTIABLE. Each bullet point or sentence in the outline should become MANY paragraphs of rich prose. You MUST use ALL of these techniques extensively to reach the word count:
   - Extended dialogue exchanges: Characters don't just state things — they argue back and forth across MANY lines, persuade, deflect, joke, reveal character through speech. A single conversation point in the outline should become 15-30+ lines of actual dialogue with beats and blocking.
   - Rich environmental/setting descriptions with ALL five senses — what the character sees, hears, smells, feels on their skin, even tastes in the air. Paint the scene so vividly the reader feels teleported there.
   - Deep character interiority: thoughts, doubts, fears, memories, interpretations of others' words, emotional shifts, internal conflicts, hopes, regrets. Let the reader live inside the character's mind.
   - Physical blocking and movement: characters walk, fidget, lean, look away, clench fists, run hands through hair, pace, sit down heavily, touch objects in the room.
   - Tension building through pacing: slow down critical moments, let scenes breathe, build anticipation before reveals.
   - Transitional passages between scenes with atmospheric detail, emotional processing, and sensory grounding.
   - Meaningful imagery and symbolism that reinforces themes and emotional undercurrents.
   - Emotional resonance: every scene should make the reader FEEL something — tension, warmth, dread, hope, heartbreak, wonder.

7. Ground every scene in vivid sensory detail from the viewpoint character — sight, sound, smell, touch, taste. The reader should feel physically present in every location. Describe the quality of light, the texture of surfaces, the temperature of the air, ambient sounds, distant smells.

8. Build tension, pacing, and emotional arcs within the chapter. Include rising action, complications, and turning points. Layer in emotional subtext beneath surface-level events.

9. Preserve PERFECT continuity with previous chapters and reference books. Do not repeat prior text. Every name, detail, relationship, object, injury, emotion, and plot thread must be consistent with everything that came before.

10. Characters must have distinct voices in dialogue — different speech patterns, vocabulary, rhythms, sentence lengths, verbal tics, and ways of expressing emotion. A scholar speaks differently from a soldier. A teenager speaks differently from an elder.

═══════════════════════════════════════════════════
DETAIL ACCURACY PROTOCOL — ZERO TOLERANCE FOR ERRORS
═══════════════════════════════════════════════════

You have ONE job above all others: NEVER get a single canonical detail wrong. Not a name. Not a relationship. Not an eye color. Not a location. Not a possession. Not a title. Not a date. Not a backstory fact. NOTHING.

BEFORE writing ANY sentence that mentions a character, place, object, or established fact, you MUST mentally verify against the manuscript, reference books, and memory context provided in this prompt:
  • Is the FULL name correct? (first AND last name AND titles/epithets exactly as established — letter by letter)
  • Is this character's relationship to others correct? (sibling, parent, rival, lover, mentor)
  • Is this character's physical description correct? (eye/hair color, height, scars)
  • Is this character's current state correct? (alive/dead, injured/healed, present/absent, what they know)
  • Is this location's description correct? (geography, contents, who is there)
  • Are objects in their correct state and location? (lost, broken, hidden, carried by whom)

CHARACTER NAMES ARE SACRED. Use the EXACT spelling and full form established in canon. If a character is "Elena Marchetti" in the manuscript, she is NEVER "Elena Marche", "Elena Marquetti", "Elena Martinez", or "Elena Smith". Match canon EXACTLY, letter by letter.

IF YOU ARE NOT 100% SURE about ANY detail, you MUST do ONE of the following:
  (a) Re-scan the manuscript, reference books, and memory context provided in this prompt to find the canonical answer, OR
  (b) Write the scene without committing to the uncertain detail — use pronouns, generic terms, or omit mentioning it entirely.

NEVER guess. NEVER invent. NEVER paraphrase a name or detail. NEVER assume. If it's not in the materials, you don't write it as fact.

11. INTERNAL VERIFICATION PASS: As you write, treat every proper noun, every relationship statement, and every reference to past events as a fact-check checkpoint. Pause mentally and confirm against the source materials before committing the line. This is more important than prose quality. A beautiful chapter with one wrong character name is a FAILED chapter.`;

    // Fiction type injection
    if (fictionType) {
      systemPrompt += `\n\nFICTION TYPE / GENRE TONE: You are writing ${fictionType}. This genre identity must permeate EVERY aspect of your writing:
- Prose style: Match the rhythm, vocabulary, and sentence structures that ${fictionType} readers expect. If it's romance, linger on emotional and physical chemistry. If it's thriller, keep tension coiled in every paragraph. If it's fantasy, make the world feel ancient and lived-in. If it's horror, let dread seep into the mundane.
- Pacing: Follow ${fictionType} pacing conventions. Romance builds slowly through emotional beats. Thrillers use short, punchy scenes with cliffhangers. Epic fantasy takes time to world-build. Horror oscillates between calm and terror.
- Dialogue: Characters should speak in ways appropriate to the genre. Dark fantasy characters don't speak like rom-com leads. Military sci-fi characters don't speak like cozy mystery protagonists.
- Emotional register: Match the emotional depth and type the genre demands. Romance needs aching vulnerability. Horror needs creeping unease. Literary fiction needs quiet devastation.
- Tropes and conventions: Lean into beloved genre tropes naturally — do not subvert them unless the outline specifically calls for it. Readers of ${fictionType} want to feel the genre's DNA in every page.
Do NOT announce the genre — simply embody it in every sentence.`;
    }

    // STRICT CONTINUITY: Full manuscript awareness
    if (fullManuscript) {
      systemPrompt += `

CRITICAL — FULL MANUSCRIPT AWARENESS:
You have been given the COMPLETE current manuscript (all chapters written so far for THIS book). You MUST:
- Read and internalize EVERY detail in the manuscript: character names, locations, physical descriptions, relationships, plot threads, emotional states, timeline, objects, injuries, promises, secrets, alliances, betrayals — EVERYTHING.
- NEVER contradict ANY detail from the existing manuscript. If a character was described with brown eyes in Chapter 2, they still have brown eyes. If a weapon was lost in Chapter 5, it is still lost. If a character died, they stay dead.
- Maintain PERFECT continuity of: character locations, time of day, weather, injuries/health, emotional states, knowledge (what each character knows/doesn't know), possessions, relationships.
- Pick up EXACTLY where the last chapter left off in terms of scene, mood, and momentum — unless the outline explicitly calls for a time skip.
- Reference earlier events naturally through character thoughts, dialogue callbacks, and emotional echoes — characters remember what happened to them.
- If ANY detail in your outline conflicts with established manuscript facts, the MANUSCRIPT takes priority. Adapt the outline detail to fit established continuity.`;
    }

    // STRICT REFERENCE BOOKS
    if (contextBooksText) {
      systemPrompt += `

CRITICAL — REFERENCE BOOK ANALYSIS:
You have been given reference books/materials from the same series or universe. You MUST:
- Study these reference materials with EXTREME attention to detail. Every character name, place name, magic system rule, political structure, cultural detail, speech pattern, and world-building element matters.
- Maintain ABSOLUTE consistency with all established facts from the reference books: character backstories, world rules, power systems, geography, history, terminology, faction names, cultural practices.
- Characters who appeared in reference books MUST behave consistently with their established personalities, speech patterns, motivations, and knowledge. A sarcastic character stays sarcastic. A formal character stays formal.
- Use the EXACT terminology, naming conventions, and world-specific vocabulary from the reference books. Do not invent new terms for things that already have names.
- If the reference books establish rules (e.g., magic costs something, certain technologies exist/don't exist, social hierarchies), NEVER violate those rules.
- Weave in callbacks and references to events/characters from the reference books where it feels natural — characters in a series remember what happened in previous books.
- Match the tone, pacing style, and prose voice of the reference books as closely as possible, unless the style guide explicitly overrides this.`;
    }

    if (perspective) systemPrompt += `\n\n11. PERSPECTIVE: Write EVERY sentence in ${perspective} perspective. Never slip out of this perspective for even a single sentence.`;
    
    if (wordCountInstruction) systemPrompt += `\n\nWORD COUNT REQUIREMENT: ${wordCountInstruction}. This is ABSOLUTELY CRITICAL and NON-NEGOTIABLE. You MUST reach the HIGHER end of the word count range. Aim for the MAXIMUM word count, not the minimum. If you find yourself running short, you are NOT expanding enough. Use ALL of these techniques:
- Write EXTENDED dialogue exchanges — 15-30+ lines per conversation, with beats, gestures, pauses, subtext, and interruptions
- Add DEEP internal monologue — characters process emotions, recall memories, weigh decisions, doubt themselves, hope, fear
- Write RICH sensory immersion — describe the environment through all five senses in every scene transition
- Expand action sequences with blow-by-blow visceral detail — each punch, each step, each heartbeat
- Add environmental descriptions and atmospheric passages that set mood and tone
- Let characters react emotionally AND physically to every significant event — don't skip the aftermath
- Include transitional moments between scenes with atmospheric detail and emotional processing
- Add meaningful character interactions that reveal personality even in small moments
- Layer in imagery, metaphor, and sensory details that reinforce the emotional core of each scene
Do NOT pad with repetition or filler. Every word must serve the story. But you MUST reach the higher end of the word count by writing DEEPLY, RICHLY, and EXPANSIVELY — not by adding unnecessary scenes. EXPAND what's in the outline, don't add what isn't.`;
    
    if (styleGuideText) systemPrompt += `\n\nSTYLE GUIDE (follow closely):\n\n${styleGuideText}`;

    // === STRUCTURED MEMORY INJECTION ===
    if (hasStructuredMemory) {
      const vp = structuredMemory.voiceProfile;
      if (vp && Object.keys(vp).length > 0) {
        systemPrompt += `\n\nAUTHOR VOICE PROFILE (match precisely):`;
        for (const [key, val] of Object.entries(vp)) {
          systemPrompt += `\n- ${key.replace(/_/g, " ")}: ${val}`;
        }
      }

      const locked = checklist.filter((c: any) => c.locked);
      if (locked.length > 0) {
        systemPrompt += `\n\nPERMANENTLY LOCKED RULES (confidence ≥95% — NEVER violate):`;
        for (const c of locked) {
          systemPrompt += `\n- ${c.q}`;
        }
      }

      const hard = checklist.filter((c: any) => !c.locked && c.confidence >= 0.75);
      if (hard.length > 0) {
        systemPrompt += `\n\nHARD RULES (always follow — ${hard.length} rules):`;
        for (const c of hard) {
          systemPrompt += `\n- ${c.q}`;
        }
      }

      const soft = checklist.filter((c: any) => c.confidence >= 0.40 && c.confidence < 0.75);
      if (soft.length > 0) {
        systemPrompt += `\n\nSOFT SUGGESTIONS (follow when natural, don't force):`;
        for (const c of soft) {
          systemPrompt += `\n- ${c.q}`;
        }
      }

      if (structuredMemory.genreConventions?.length > 0) {
        systemPrompt += `\n\nGENRE CONVENTIONS (${structuredMemory.detectedGenre || "detected genre"}):`;
        for (const gc of structuredMemory.genreConventions) {
          systemPrompt += `\n- ${gc.convention}: ${gc.checklist_question}`;
        }
      }

      if (structuredMemory.styleCache) {
        systemPrompt += `\n\nSTYLE SUMMARY:\n${structuredMemory.styleCache}`;
      }
    }

    // === ULTRACONTEXT INJECTION (pre-assembled by client, always inject if present) ===
    if (ultraContextInjection) {
      systemPrompt += `\n\nMEMORY CONTEXT (compressed semantic triples — follow precisely):\n${ultraContextInjection}`;
    }

    let userContent = "";

    if (contextBooksText) {
      userContent += `REFERENCE BOOKS FROM THE SERIES (STUDY CAREFULLY — every name, detail, rule, and character trait matters for continuity):\n\n${contextBooksText}\n\n`;
    }

    if (fullManuscript) {
      userContent += `COMPLETE CURRENT MANUSCRIPT (all chapters written so far — read EVERY detail for perfect continuity):\n\n${fullManuscript}\n\n`;
    }

    if (previousChapters && !fullManuscript) {
      userContent += `PREVIOUSLY WRITTEN CHAPTERS (maintain continuity, do not repeat any of this text):\n\n${previousChapters}\n\n`;
    }

    if (partialContent) {
      userContent += `Continue chapter ${chapterNumber} from where it was interrupted. Here is the existing text — continue seamlessly after it without repeating any of it:\n\nEXISTING TEXT:\n\n${partialContent}\n\nCHAPTER ${chapterNumber} OUTLINE (ONLY use details from THIS outline):\n\n${outline}${rewriteNotes ? `\n\nRewrite instructions: ${rewriteNotes}` : ""}\n\nContinue writing from where the existing text ends. Write full dramatized prose. Remember: ONLY details from Chapter ${chapterNumber}'s outline. Hit the word count target. Maintain PERFECT continuity with the manuscript and reference books.`;
    } else {
      userContent += `Write chapter ${chapterNumber} as complete novel prose.\n\nCHAPTER ${chapterNumber} OUTLINE (ONLY use details from THIS outline — nothing from other chapters):\n\n${outline}${rewriteNotes ? `\n\nRewrite instructions: ${rewriteNotes}` : ""}\n\nNow write the COMPLETE chapter starting with the heading "## Chapter ${chapterNumber}: [Title]". Dramatize every single idea from the outline with full scenes, extended dialogue, deep interiority, and rich sensory detail. Expand heavily on each point. Do not skip anything. Do not summarize anything. Do not include details from other chapters. Hit the word count target. Maintain PERFECT continuity with the manuscript and reference books — every name, detail, and established fact must be consistent.`;
    }

    const tryOrder: Provider[] = [primaryProvider];
    if (primaryProvider !== "lovable") tryOrder.push("lovable");

    let lastError = "";
    for (const provider of tryOrder) {
      // Resolve API config (kaggle uses request-time URL)
      let apiUrl = "";
      let apiKey = "";
      let extraHeaders: Record<string, string> = {};

      if (provider === "kaggle") {
        if (!kaggleEndpoint?.url) {
          lastError = "kaggle:no-tunnel-url";
          console.warn("generate-chapter kaggle: no tunnel URL configured");
          continue;
        }
        apiUrl = `${kaggleEndpoint.url.replace(/\/$/, "")}/v1/chat/completions`;
        apiKey = kaggleEndpoint.apiKey || "no-key-required";
      } else {
        const cfg = getApiConfig(provider);
        if (!cfg) {
          lastError = `${provider}:no-api-key`;
          console.warn("generate-chapter skipping provider (no key):", provider);
          continue;
        }
        apiUrl = cfg.apiUrl;
        apiKey = cfg.apiKey;
        extraHeaders = cfg.extraHeaders;
      }

      const finalModel = provider === "kaggle"
        ? (kaggleEndpoint?.hfRepo || model.replace(/^kaggle\//, ""))
        : mapModelForProvider(model, provider);

      try {
        let sysContent = systemPrompt;
        let usrContent = userContent;
        const requestBody: Record<string, unknown> = {
          model: finalModel,
          messages: [
            { role: "system", content: sysContent },
            { role: "user", content: usrContent },
          ],
          temperature,
          top_p,
          stream: true,
        };

        if (provider === "meganova") {
          const ctx = MEGANOVA_CONTEXT_WINDOWS[finalModel] ?? 8_192;
          const outputBudget = Math.min(8_192, Math.floor(ctx * 0.6));
          const inputBudget = Math.max(1_024, ctx - outputBudget - 512);
          const sysBudget = Math.floor(inputBudget * 0.3);
          const usrBudget = inputBudget - sysBudget;
          sysContent = fitToBudget(sysContent, sysBudget);
          usrContent = fitToBudget(usrContent, usrBudget);
          requestBody.messages = [
            { role: "system", content: sysContent },
            { role: "user", content: usrContent },
          ];
          requestBody.max_tokens = outputBudget;
        }

        if (provider === "kaggle") {
          const ctx = kaggleEndpoint?.contextWindow ?? 8_192;
          const outputBudget = Math.min(8_192, Math.floor(ctx * 0.5));
          const inputBudget = Math.max(1_024, ctx - outputBudget - 512);
          const sysBudget = Math.floor(inputBudget * 0.3);
          const usrBudget = inputBudget - sysBudget;
          sysContent = fitToBudget(sysContent, sysBudget);
          usrContent = fitToBudget(usrContent, usrBudget);
          requestBody.messages = [
            { role: "system", content: sysContent },
            { role: "user", content: usrContent },
          ];
          requestBody.max_tokens = outputBudget;
          console.log("generate-chapter kaggle", JSON.stringify({ apiUrl, finalModel, ctx, outputBudget }));
        }

        const resp = await fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...extraHeaders,
          },
          body: JSON.stringify(requestBody),
        });

        if (resp.ok && resp.body) {
          return new Response(resp.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
        }

        const text = await resp.text().catch(() => "");
        lastError = `${provider}:${resp.status} ${text.slice(0, 200)}`;
        console.error("generate-chapter provider failed:", lastError);

        if (resp.status === 429) return jsonResponse({ error: "Rate limited. Please wait a moment and try again." }, 429);
        if (resp.status === 402) return jsonResponse({ error: "AI credits exhausted. Please add credits to your Lovable workspace." }, 402);
      } catch (err) {
        lastError = `${provider}:${err instanceof Error ? err.message : String(err)}`;
        console.error("generate-chapter exception:", lastError);
      }
    }

    return jsonResponse({ error: `Generation failed across all providers. Last error: ${lastError}` }, 500);
  } catch (error) {
    console.error("generate-chapter error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
