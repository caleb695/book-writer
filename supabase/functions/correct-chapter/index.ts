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
  temperature: number,
  top_p: number,
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
    temperature,
    top_p,
    stream: true,
  };

  if (provider === "meganova" || provider === "kaggle") {
    const ctx = provider === "meganova"
      ? (MEGANOVA_CTX[mappedModel] ?? 8_192)
      : (kaggleEndpoint?.contextWindow ?? 8_192);
    const outputBudget = Math.min(8_192, Math.floor(ctx * 0.6));
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
    console.log("correct-chapter trim", JSON.stringify({ provider, mappedModel, ctx, outputBudget }));
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

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { chapter, issues, context, model, temperature = 0.4, top_p = 0.9, kaggleEndpoint = null } = body;

    if (!chapter || typeof chapter !== "string") {
      return jsonResponse({ error: "Missing chapter" }, 400);
    }
    if (!Array.isArray(issues) || issues.length === 0) {
      return jsonResponse({ error: "No issues to correct" }, 400);
    }

    const requestedModel = model || "google/gemini-2.5-pro";
    const primaryProvider = getProvider(requestedModel);

    const issuesList = issues.map((i: any, idx: number) =>
      `${idx + 1}. [${(i.severity || "medium").toUpperCase()}] ${i.category}
   FOUND: "${i.quote}"
   PROBLEM: ${i.problem}
   CORRECT: ${i.correct_fact}`
    ).join("\n\n");

    const systemPrompt = `You are a precision continuity editor. A draft chapter has factual errors that must be fixed without rewriting the chapter.

ABSOLUTE RULES:
1. Fix ONLY the listed factual errors. Do not rewrite, restructure, expand, shorten, or "improve" the prose.
2. Match every correction LETTER-FOR-LETTER against the "CORRECT" value provided.
3. Preserve every other word, every paragraph, every line break, every dialogue tag, every scene, every emotion, every image, every piece of formatting (markdown headings like "## Chapter X: Title" stay).
4. If a fix changes a name, replace EVERY occurrence of the wrong name throughout the chapter — not just the quoted instance.
5. If a fix changes a relationship/ability/fact, propagate the correction so the chapter remains internally consistent (re-thread pronouns, references, follow-up sentences).
6. Do NOT add new content, new scenes, or new dialogue beyond what's required to make the corrections grammatical and consistent.
7. Do NOT remove content unless a sentence is factually impossible to keep with the correction (rare — try to repair instead).
8. Output ONLY the corrected chapter text. No commentary, no preface, no "Here is the corrected chapter:", no markdown code fences. Start with the chapter title or first line and end with the last line.

Think of yourself as using find-and-replace with surgical care: fix the wrong details, leave everything else identical.`;

    const userPrompt = `=== ESTABLISHED CONTEXT (canonical truth) ===
${(context || "").slice(0, 40000)}

=== FACTUAL ERRORS TO FIX ===
${issuesList}

=== CHAPTER TO CORRECT ===
${chapter}

Now output the chapter with ONLY these factual errors corrected. Keep everything else identical.`;

    let resp: Response;
    try {
      resp = await callProvider(primaryProvider, requestedModel, systemPrompt, userPrompt, temperature, top_p, kaggleEndpoint);
      if (!resp.ok && primaryProvider !== "lovable") {
        console.warn(`[correct-chapter] ${primaryProvider} returned ${resp.status}, falling back`);
        resp = await callProvider("lovable", "google/gemini-2.5-pro", systemPrompt, userPrompt, temperature, top_p);
      }
    } catch (err) {
      console.warn(`[correct-chapter] Primary failed, falling back:`, err);
      resp = await callProvider("lovable", "google/gemini-2.5-pro", systemPrompt, userPrompt, temperature, top_p);
    }

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("[correct-chapter] All providers failed:", resp.status, txt);
      if (resp.status === 429) return jsonResponse({ error: "Rate limit. Please retry." }, 429);
      if (resp.status === 402) return jsonResponse({ error: "AI credits exhausted." }, 402);
      return jsonResponse({ error: "Correction service failed" }, 500);
    }

    return new Response(resp.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[correct-chapter] Unexpected error:", err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
});
