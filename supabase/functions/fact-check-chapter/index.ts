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
  if (provider === "lovable") {
    const k = Deno.env.get("LOVABLE_API_KEY");
    if (!k) return null;
    return { apiUrl: LOVABLE_API_URL, apiKey: k, extraHeaders };
  }
  if (provider === "meganova") {
    const k = Deno.env.get("MEGANOVA_API_KEY");
    if (!k) return null;
    return { apiUrl: MEGANOVA_API_URL, apiKey: k, extraHeaders };
  }
  const k = Deno.env.get("MISTRAL_API_KEY");
  if (!k) return null;
  return { apiUrl: MISTRAL_API_URL, apiKey: k, extraHeaders };
}

function mapModelForProvider(model: string, provider: Provider): string {
  if (provider === "lovable" && !/^(google\/|openai\/)/.test(model)) {
    return "google/gemini-2.5-pro";
  }
  return model;
}

const FACT_CHECK_TOOL = {
  type: "function",
  function: {
    name: "report_fact_check",
    description: "Report any factual inconsistencies between the chapter and the established context.",
    parameters: {
      type: "object",
      properties: {
        issues: {
          type: "array",
          description: "List of every factual error, contradiction, or detail mistake found in the chapter.",
          items: {
            type: "object",
            properties: {
              category: {
                type: "string",
                enum: ["name", "relationship", "ability", "timeline", "location", "physical_detail", "plot_fact", "world_rule", "other"],
                description: "Type of detail that is wrong"
              },
              quote: {
                type: "string",
                description: "Exact quote from the chapter showing the error (verbatim, ≤200 chars)"
              },
              problem: {
                type: "string",
                description: "What's wrong (e.g. 'Last name should be Marchetti, not Marchesi')"
              },
              correct_fact: {
                type: "string",
                description: "What the established context says is correct"
              },
              severity: {
                type: "string",
                enum: ["critical", "high", "medium", "low"],
                description: "critical = breaks canon (wrong name, impossible event); high = clear contradiction; medium = inconsistent detail; low = minor"
              }
            },
            required: ["category", "quote", "problem", "correct_fact", "severity"]
          }
        },
        verdict: {
          type: "string",
          enum: ["clean", "needs_correction"],
          description: "'clean' = no real errors; 'needs_correction' = one or more issues need fixing"
        },
        notes: {
          type: "string",
          description: "Brief overall assessment of detail accuracy."
        }
      },
      required: ["issues", "verdict", "notes"]
    }
  }
};

const FACT_CHECK_SYSTEM_PROMPT = `You are a meticulous continuity editor and fact-checker for a novel. Your ONLY job is to find factual errors, contradictions, and detail mistakes between the new chapter and the established story context.

You will receive:
1. ESTABLISHED CONTEXT — outline, prior committed chapters, character/world memory, style rules
2. NEW CHAPTER — the chapter just written

Your task: Read the established context carefully. Then read the new chapter line by line. Cross-reference EVERY proper noun, name, relationship, ability, location, timeline reference, physical detail, and plot fact against the context.

LOOK SPECIFICALLY FOR:
- Wrong character names or last names (even one letter off)
- Wrong relationships ("his sister" when she's actually his cousin)
- Powers/abilities a character doesn't have
- Characters who haven't met yet acting like they have
- Locations described differently than established
- Timeline contradictions (events out of order, wrong day/season)
- Physical descriptions that contradict (eye color, hair, age, height)
- World rules being broken (magic system, technology limits)
- Plot facts that contradict prior chapters

DO NOT flag:
- Stylistic choices
- New details that don't contradict anything (the AI is allowed to invent within established rules)
- Subjective quality issues (use the style checklist for that)

Be EXHAUSTIVE. Quote the exact problematic text. State the correct fact from the context. If you find nothing wrong, return verdict "clean" with an empty issues array. If you find issues, return verdict "needs_correction".

Be thorough — missing an error is worse than flagging a borderline case.`;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Verified live from https://api.meganova.ai/v1/models
const MEGANOVA_CTX: Record<string, number> = {
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
  kaggleEndpoint?: KaggleEndpoint | null,
): Promise<Response> {
  let apiUrl = "";
  let apiKey = "";
  let extraHeaders: Record<string, string> = {};
  let mappedModel = model;

  if (provider === "kaggle") {
    if (!kaggleEndpoint?.url) throw new Error("Kaggle tunnel URL not configured for this model");
    apiUrl = `${kaggleEndpoint.url.replace(/\/$/, "")}/v1/chat/completions`;
    apiKey = kaggleEndpoint.apiKey || "no-key-required";
    mappedModel = kaggleEndpoint.hfRepo || model.replace(/^kaggle\//, "");
  } else {
    const cfg = getApiConfig(provider);
    if (!cfg) throw new Error(`Missing API key for ${provider}`);
    apiUrl = cfg.apiUrl;
    apiKey = cfg.apiKey;
    extraHeaders = cfg.extraHeaders;
    mappedModel = mapModelForProvider(model, provider);
  }

  let sys = systemPrompt;
  let usr = userPrompt;
  const requestBody: Record<string, unknown> = {
    model: mappedModel,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr },
    ],
    tools: [FACT_CHECK_TOOL],
    tool_choice: { type: "function", function: { name: "report_fact_check" } },
    temperature: 0.1,
  };

  if (provider === "meganova" || provider === "kaggle") {
    const ctx = provider === "meganova"
      ? (MEGANOVA_CTX[mappedModel] ?? 8_192)
      : (kaggleEndpoint?.contextWindow ?? 8_192);
    const outputBudget = Math.min(2_048, Math.floor(ctx * 0.25));
    const inputBudget = Math.max(1_024, ctx - outputBudget - 512);
    const sysBudget = Math.floor(inputBudget * 0.15);
    const usrBudget = inputBudget - sysBudget;
    sys = fitToBudget(sys, sysBudget);
    usr = fitToBudget(usr, usrBudget);
    requestBody.messages = [
      { role: "system", content: sys },
      { role: "user", content: usr },
    ];
    requestBody.max_tokens = outputBudget;
    console.log("fact-check trim", JSON.stringify({ provider, mappedModel, ctx, outputBudget }));
  }

  return await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify(requestBody),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { chapter, context, model, kaggleEndpoint = null } = body;

    if (!chapter || typeof chapter !== "string") {
      return jsonResponse({ error: "Missing chapter text" }, 400);
    }
    if (!context || typeof context !== "string") {
      return jsonResponse({ error: "Missing context" }, 400);
    }

    const requestedModel = model || "google/gemini-2.5-pro";
    const primaryProvider = getProvider(requestedModel);

    // Cap chapter and context to keep token usage reasonable
    const truncatedChapter = chapter.split(/\s+/).slice(0, 12000).join(" ");
    const truncatedContext = context.slice(0, 60000);

    const userPrompt = `=== ESTABLISHED CONTEXT ===
${truncatedContext}

=== NEW CHAPTER TO FACT-CHECK ===
${truncatedChapter}

Cross-reference every detail in the chapter against the context. Report all factual errors, contradictions, and mistaken details using the report_fact_check tool. Be exhaustive.`;

    let resp: Response;
    try {
      resp = await callProvider(primaryProvider, requestedModel, FACT_CHECK_SYSTEM_PROMPT, userPrompt, kaggleEndpoint);
      if (!resp.ok && primaryProvider !== "lovable") {
        console.warn(`[fact-check] ${primaryProvider} returned ${resp.status}, falling back to Lovable AI`);
        resp = await callProvider("lovable", "google/gemini-2.5-pro", FACT_CHECK_SYSTEM_PROMPT, userPrompt);
      }
    } catch (err) {
      console.warn(`[fact-check] Primary failed, falling back:`, err);
      resp = await callProvider("lovable", "google/gemini-2.5-pro", FACT_CHECK_SYSTEM_PROMPT, userPrompt);
    }

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("[fact-check] All providers failed:", resp.status, txt);
      if (resp.status === 429) return jsonResponse({ error: "Rate limit. Please retry." }, 429);
      if (resp.status === 402) return jsonResponse({ error: "AI credits exhausted." }, 402);
      return jsonResponse({ error: "Fact-check service failed" }, 500);
    }

    const data = await resp.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.warn("[fact-check] No tool call returned, treating as clean");
      return jsonResponse({ verdict: "clean", issues: [], notes: "No structured response from model." }, 200);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (err) {
      console.error("[fact-check] Failed to parse tool args:", err);
      return jsonResponse({ verdict: "clean", issues: [], notes: "Could not parse fact-check output." }, 200);
    }

    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    const verdict = parsed.verdict === "needs_correction" && issues.length > 0 ? "needs_correction" : "clean";

    return jsonResponse({
      verdict,
      issues,
      notes: parsed.notes || "",
    }, 200);
  } catch (err) {
    console.error("[fact-check] Unexpected error:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
