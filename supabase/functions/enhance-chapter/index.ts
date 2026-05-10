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

type Provider = "mistral" | "groq" | "openrouter" | "lovable" | "meganova" | "kaggle";

interface KaggleEndpoint { url?: string; apiKey?: string; hfRepo?: string; contextWindow?: number }

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
  // lovable
  const k = Deno.env.get("LOVABLE_API_KEY");
  if (!k) return null;
  return { apiUrl: LOVABLE_API_URL, apiKey: k, extraHeaders };
}

// Map any model to a model the provider can actually serve
function mapModelForProvider(model: string, provider: Provider): string {
  if (provider === "lovable") {
    // If it's already a lovable-supported model, keep it
    if (/^google\/gemini-/.test(model) || /^openai\/gpt-5/.test(model)) return model;
    // Otherwise default to a strong, fast Lovable model
    return "google/gemini-2.5-pro";
  }
  if (provider === "mistral") {
    if (/^mistral|^ministral|^magistral|^codestral|^pixtral/i.test(model)) return model;
    return "mistral-large-latest";
  }
  return model;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// Verified live from https://api.meganova.ai/v1/models
const MEGANOVA_CONTEXT_WINDOWS: Record<string, number> = {
  "BruhzWater/Sapphira-L3.3-70b-0.1": 65_536,
  "FallenMerick/MN-Violet-Lotus-12B": 65_536,
  "Steelskull/L3.3-MS-Nevoria-70b": 65_536,
  "mistralai/Mistral-Small-3.2-24B-Instruct-2506": 32_768,
  "Sao10K/L3-70B-Euryale-v2.1": 8_192,
};

function fitToBudget(text: string, maxTokens: number): string {
  if (!text) return text;
  const maxChars = Math.max(0, Math.floor(maxTokens * 3.6));
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.55));
  const tail = text.slice(-Math.floor(maxChars * 0.4));
  return `${head}\n\n[... condensed to fit model context window ...]\n\n${tail}`;
}

async function callProvider(
  provider: Provider,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  top_p: number,
  kaggleEndpoint?: KaggleEndpoint | null,
): Promise<Response> {
  let apiUrl = "";
  let apiKey = "";
  let extraHeaders: Record<string, string> = {};
  let finalModel = model;

  if (provider === "kaggle") {
    if (!kaggleEndpoint?.url) throw new Error("Kaggle tunnel URL not configured for this model");
    apiUrl = `${kaggleEndpoint.url.replace(/\/$/, "")}/v1/chat/completions`;
    apiKey = kaggleEndpoint.apiKey || "no-key-required";
    finalModel = kaggleEndpoint.hfRepo || model.replace(/^kaggle\//, "");
  } else {
    const cfg = getApiConfig(provider);
    if (!cfg) throw new Error(`${provider.toUpperCase()}_API_KEY is not configured`);
    apiUrl = cfg.apiUrl;
    apiKey = cfg.apiKey;
    extraHeaders = cfg.extraHeaders;
    finalModel = mapModelForProvider(model, provider);
  }

  let sys = systemPrompt;
  let usr = userPrompt;
  const requestBody: Record<string, unknown> = {
    model: finalModel,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr },
    ],
    temperature,
    top_p,
    stream: true,
  };

  if (provider === "meganova" || provider === "kaggle") {
    const ctx = provider === "meganova"
      ? (MEGANOVA_CONTEXT_WINDOWS[finalModel] ?? 8_192)
      : (kaggleEndpoint?.contextWindow ?? 8_192);
    const outputBudget = Math.min(8_192, Math.floor(ctx * 0.6));
    const inputBudget = Math.max(1_024, ctx - outputBudget - 512);
    const sysBudget = Math.floor(inputBudget * 0.25);
    const usrBudget = inputBudget - sysBudget;
    sys = fitToBudget(sys, sysBudget);
    usr = fitToBudget(usr, usrBudget);
    requestBody.messages = [
      { role: "system", content: sys },
      { role: "user", content: usr },
    ];
    requestBody.max_tokens = outputBudget;
    console.log("enhance-chapter trim", JSON.stringify({ provider, finalModel, ctx, outputBudget }));
  }

  return await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(requestBody),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { draft, model, temperature, top_p, wordCountMin, wordCountMax, checklist, userInstructions, perspective, fictionType, styleRules, ultraContextInjection, kaggleEndpoint = null } = body;

    if (!draft || typeof draft !== "string") {
      return new Response(JSON.stringify({ error: "Draft is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const requestedModel = model || "google/gemini-2.5-pro";
    const primaryProvider = getProvider(requestedModel);

    const currentWordCount = countWords(draft);
    const targetMin = parseInt(wordCountMin) || 3500;
    const targetMax = parseInt(wordCountMax) || 4000;
    const targetWords = Math.max(targetMin, Math.round((targetMin + targetMax) / 2 + (targetMax - targetMin) * 0.3));

    const checklistText = Array.isArray(checklist) && checklist.length > 0
      ? checklist.map((c: any) => `- ${c.q} [${c.locked ? "LOCKED" : `confidence: ${c.confidence}`}]`).join("\n")
      : "";

    const systemPrompt = `You are a world-class fiction editor working on an existing draft chapter. Your ONLY job is to take the draft you receive and make it DRAMATICALLY better — far richer, far deeper, far more emotionally devastating, far more immersive — while keeping every plot point, every character action, every story beat, every scene, and EVERY canonical detail (especially names) exactly as they are in the draft.

═══════════════════════════════════════════════════
ABSOLUTE RULES — VIOLATING ANY OF THESE FAILS THE TASK
═══════════════════════════════════════════════════

1. DO NOT REWRITE THE CHAPTER. You are EDITING, EXPANDING, and DEEPENING it. Same chapter, same scenes, same events, same outcomes — just dramatically more powerful.
2. KEEP every plot point, every event, every character action, every line of dialogue's intent, and every scene transition that exists in the draft.
3. KEEP the chapter heading exactly as written (## Chapter X: Title).
4. NEVER replace a scene with a different scene. NEVER invent new plot points. NEVER change what happens.
5. Output ONLY the edited chapter. No commentary. No "Here is the enhanced chapter." No notes.

═══════════════════════════════════════════════════
DETAIL ACCURACY PROTOCOL — ZERO TOLERANCE FOR ERRORS
═══════════════════════════════════════════════════

Names, relationships, physical descriptions, possessions, locations, and established facts in the draft are SACRED. Preserve them EXACTLY as written. If the draft says "Elena Marchetti", every mention in your enhanced version must also say "Elena Marchetti" — never "Elena", never "Marchetti", never a misspelling, never a substitute, unless the draft itself uses those forms.

Cross-check the memory context, manuscript context, and reference materials below against the draft. If you spot a name or detail that ALREADY appears correctly in the draft, preserve it letter-by-letter. If you ADD a new mention of a character/place/object during expansion, it MUST use the exact canonical form from the draft and the memory context.

If the draft has a detail you are uncertain about, KEEP IT AS WRITTEN — never "correct" it, never paraphrase it, never substitute a similar-sounding name. When in doubt, use pronouns or omit the reference entirely rather than guess.

NEVER invent backstory, relationships, possessions, or facts that aren't in the draft or the provided context. Your enhancements deepen what's THERE — they never add new canon.

═══════════════════════════════════════════════════
WORD COUNT TARGET (CRITICAL)
═══════════════════════════════════════════════════
- Current draft: EXACTLY ${currentWordCount} words.
- Required range: ${targetMin}–${targetMax} words. Aim for ${targetWords}.
${currentWordCount < targetMin ? `- The draft is ${targetMin - currentWordCount} words SHORT. You MUST expand existing scenes substantially using the techniques below.` : ""}
${currentWordCount > targetMax ? `- The draft is ${currentWordCount - targetMax} words OVER. Trim selectively while preserving all events.` : ""}

═══════════════════════════════════════════════════
HOW TO MAKE THE CHAPTER WAY BETTER (apply ALL of these aggressively)
═══════════════════════════════════════════════════

A. EXPLODE EXISTING DIALOGUE — DO NOT REPLACE IT
   - Take every conversation in the draft and stretch it 3–5x.
   - Add interruptions, hesitations, half-finished sentences, subtext, and silence.
   - Insert beats between EVERY line: a glance away, a swallowed breath, fingers tightening on a glass, a chair scraping, a held look that lasts a heartbeat too long.
   - Add what characters DON'T say — the thought they bite back, the lie they tell themselves, the truth they almost speak.
   - A 4-line exchange in the draft should become a 20–35 line exchange with the SAME outcome.
   - Vary cadence: short snaps of dialogue, long unbroken speeches, broken rhythms, overlapping voices.

B. DEEPEN INTERIORITY MASSIVELY (the single most important upgrade)
   - For every emotional beat already present, add the character's full internal experience: physical sensation (tight chest, cold hands, heat behind the eyes, the metallic taste of fear), intrusive memory (a moment from years ago surfacing uninvited), private fear, secret hope, the small lie they tell themselves to keep moving.
   - Slow down EVERY decision. Show the character weighing, hesitating, almost choosing the other thing, then finally choosing.
   - Let the reader live INSIDE the character's head during EVERY important moment — every doubt, every flicker of feeling, every memory.
   - Layer past and present: a smell triggers a memory, a phrase echoes something said years ago, a face reminds them of someone lost.

C. ENRICH SENSORY DETAIL — ground every scene in the body
   - Sight: quality of light, color, texture, shadow, the way dust hangs in a beam.
   - Sound: ambient noise, distant voices, footfalls, breathing, the silence between words.
   - Smell & taste: the air, the room, what lingers — the metallic tang of blood, woodsmoke, rain on stone.
   - Touch: temperature, fabric, skin, the weight of an object, the give of floorboards.
   - These details go INSIDE existing scenes — they do not replace anything, they SATURATE it.

D. UPGRADE EVERY FLAT SENTENCE
   - Replace generic verbs and adjectives with specific, vivid, character-revealing ones.
   - Replace "she walked across the room" with prose that reveals her state of mind through HOW she walks.
   - Hunt down every "was sad / was angry / was nervous / was scared" line and convert it into shown behavior, dialogue, and physiology.
   - Replace clichés with fresh, character-specific imagery rooted in the character's history and worldview.
   - Vary sentence length aggressively. Mix one-word punches with long lyrical sentences that breathe.

E. SLOW THE BIG MOMENTS TO A CRAWL
   - Find the chapter's biggest beats (decisions, confrontations, revelations, emotional turns, kisses, deaths, betrayals).
   - Stretch them. Add anticipation before, reaction during, processing after.
   - The reader should FEEL the weight of these moments — gut-punched, breath-held, tear-prickled — not skim past them.
   - Add the silence after a devastating line. The held breath before the answer. The way time seems to stop.

F. SHOW DON'T TELL — convert ALL telling into dramatized experience
   - Anywhere the draft says "she felt X" → show the body, behavior, dialogue, and thought that proves she felt X.
   - Anywhere the draft summarizes ("they argued for an hour") → write the actual exchange.
   - Anywhere the draft narrates feelings → dramatize them through the body and voice.

G. EMOTIONAL EMPHASIS & IMAGERY
   - Every important emotion deserves a fresh image — a metaphor that belongs to THIS character in THIS moment.
   - Use weather, light, objects, and setting to mirror and amplify emotion.
   - Let symbolic details accumulate quietly across the chapter.
   - Make the reader feel each emotional beat in their chest.

H. PRESERVE & SHARPEN VOICE
   - Each character keeps their existing speech patterns, vocabulary, and rhythm — but sharpened and more distinctive.
   - Do NOT add motivations or characterization that aren't supported by the draft and context.

I. SMOOTH TRANSITIONS
   - Add connective tissue between scenes: emotional carryover, atmospheric bridges, internal processing, sensory echoes.
   - Never lose momentum — but never rush past meaningful moments either.

${perspective ? `J. PERSPECTIVE: Maintain strict ${perspective} perspective in every sentence.` : ""}
${fictionType ? `K. GENRE TONE: This is ${fictionType}. Embody this genre's emotional register, pacing, and prose conventions while preserving the draft's actual content and events.` : ""}

${styleRules ? `═══════════════════════════════════════════════════\nSTYLE RULES TO FOLLOW (from style training — these are non-negotiable)\n═══════════════════════════════════════════════════\n${styleRules}\n` : ""}
${checklistText ? `═══════════════════════════════════════════════════\nQUALITY CHECKLIST — every item must be satisfied\n═══════════════════════════════════════════════════\n${checklistText}\n` : ""}
${ultraContextInjection ? `═══════════════════════════════════════════════════\nMEMORY CONTEXT (semantic memory — canonical names, facts, rules, voice — follow PRECISELY)\n═══════════════════════════════════════════════════\n${ultraContextInjection}\n` : ""}
${userInstructions ? `═══════════════════════════════════════════════════\nUSER'S SPECIFIC INSTRUCTIONS\n═══════════════════════════════════════════════════\n${userInstructions}\n` : ""}

═══════════════════════════════════════════════════
INTERNAL VERIFICATION PASS (do this as you edit)
═══════════════════════════════════════════════════
For every name, every relationship, every physical detail, every reference to a past event in your enhanced version, ask:
  • Does this MATCH the draft exactly?
  • Does this MATCH the memory context exactly?
  • If I'm unsure, did I use a pronoun or omit it instead of guessing?
A single wrong name fails the entire enhancement. Accuracy beats prose quality every time.

═══════════════════════════════════════════════════
FINAL OUTPUT RULES
═══════════════════════════════════════════════════
- Output ONLY the enhanced chapter prose.
- Start with the same "## Chapter X: Title" heading.
- Hit ${targetMin}–${targetMax} words (aim for ${targetWords}).
- Same story, same scenes, same events, same names, same details — just dramatically deeper, richer, more emotional, and more alive.`;

    const userPrompt = `Here is the draft chapter to enhance. Edit, expand, and deepen it according to all the rules above. Same chapter — just much better.\n\n${draft}`;

    const tryOrder: Provider[] = [];
    tryOrder.push(primaryProvider);
    if (primaryProvider !== "lovable") tryOrder.push("lovable"); // always fall back to Lovable AI

    const tempVal = temperature ?? 0.7;
    const topPVal = top_p ?? 0.9;

    let lastError = "";
    for (const provider of tryOrder) {
      try {
        console.log("enhance-chapter try", JSON.stringify({
          provider, model: requestedModel, currentWordCount, targetMin, targetMax,
          checklistLen: checklist?.length || 0,
        }));
        const resp = await callProvider(provider, requestedModel, systemPrompt, userPrompt, tempVal, topPVal, kaggleEndpoint);

        if (resp.ok && resp.body) {
          return new Response(resp.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
        }

        const text = await resp.text().catch(() => "");
        lastError = `${provider}:${resp.status} ${text.slice(0, 200)}`;
        console.error("enhance-chapter provider failed:", lastError);

        // Don't retry on rate limit — surface it
        if (resp.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited. Please wait a moment and try again." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        if (resp.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to your Lovable workspace." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        // otherwise fall through to next provider
      } catch (err) {
        lastError = `${provider}:${err instanceof Error ? err.message : String(err)}`;
        console.error("enhance-chapter exception:", lastError);
      }
    }

    return new Response(JSON.stringify({ error: `Enhancement failed across all providers. Last error: ${lastError}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("enhance-chapter error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
