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
const OUTLINE_MAX = 12_000;
const MANUSCRIPT_MAX = 16_000;
const CONTEXT_PER_BOOK_MAX = 6_000;
const CONTEXT_TOTAL_MAX = 16_000;
const STYLE_TOTAL_MAX = 8_000;
const ULTRA_CONTEXT_MAX = 8_000;

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

function mapModelForProvider(model: string, provider: Provider): string {
  if (provider === "lovable") {
    if (/^google\/gemini-/.test(model) || /^openai\/gpt-5/.test(model)) return model;
    return DEFAULT_MODEL;
  }
  if (provider === "mistral") {
    if (/^mistral|^ministral|^magistral|^codestral|^pixtral/i.test(model)) return model;
    return "mistral-large-latest";
  }
  return model;
}

function getApiConfig(provider: Provider): { apiUrl: string; apiKey: string; extra: Record<string, string> } | null {
  const extra: Record<string, string> = {};
  if (provider === "groq") {
    const k = Deno.env.get("GROQ_API_KEY");
    if (!k) return null;
    return { apiUrl: GROQ_API_URL, apiKey: k, extra };
  }
  if (provider === "openrouter") {
    const k = Deno.env.get("OPENROUTER_API_KEY");
    if (!k) return null;
    extra["HTTP-Referer"] = "https://book-writer.lovable.app";
    extra["X-Title"] = "Loom & Ink";
    return { apiUrl: OPENROUTER_API_URL, apiKey: k, extra };
  }
  if (provider === "mistral") {
    const k = Deno.env.get("MISTRAL_API_KEY");
    if (!k) return null;
    return { apiUrl: MISTRAL_API_URL, apiKey: k, extra };
  }
  if (provider === "meganova") {
    const k = Deno.env.get("MEGANOVA_API_KEY");
    if (!k) return null;
    return { apiUrl: MEGANOVA_API_URL, apiKey: k, extra };
  }
  const k = Deno.env.get("LOVABLE_API_KEY");
  if (!k) return null;
  return { apiUrl: LOVABLE_API_URL, apiKey: k, extra };
}

function clip(text: unknown, max: number): string {
  const s = typeof text === "string" ? text.replace(/\r\n/g, "\n").trim() : "";
  if (!s) return "";
  if (s.length <= max) return s;
  const head = s.slice(0, Math.floor(max * 0.6));
  const tail = s.slice(-Math.floor(max * 0.35));
  return `${head}\n\n[... condensed ...]\n\n${tail}`;
}

function compressList(values: unknown, totalMax: number, perItem: number): string {
  if (!Array.isArray(values)) return "";
  const parts: string[] = [];
  let used = 0;
  for (let i = 0; i < values.length; i++) {
    const remaining = totalMax - used;
    if (remaining < 400) break;
    const budget = Math.min(perItem, remaining);
    const piece = clip(values[i], budget);
    if (!piece) continue;
    parts.push(`--- ITEM ${i + 1} ---\n${piece}`);
    used += piece.length;
  }
  return parts.join("\n\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const messages: Array<{ role: string; content: string }> = Array.isArray(body.messages) ? body.messages : [];
    const outline = clip(body.outline, OUTLINE_MAX);
    const documentContent = clip(body.documentContent, MANUSCRIPT_MAX);
    const contextBooksText = compressList(body.contextBooks, CONTEXT_TOTAL_MAX, CONTEXT_PER_BOOK_MAX);
    const styleGuidesText = compressList(body.styleGuides, STYLE_TOTAL_MAX, 4_000);
    const ultraContextInjection = clip(body.ultraContextInjection, ULTRA_CONTEXT_MAX);
    const fictionType = clip(body.fictionType, 200);
    const perspective = clip(body.perspective, 200);
    const requestedModel = (typeof body.model === "string" && body.model) ? body.model : DEFAULT_MODEL;

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are a world-class creative writing partner — story architect, brainstorming collaborator, character developer, plot doctor, world-builder, and prose editor. You help the author at every stage.

You can:
- Brainstorm ideas (titles, scenes, twists, subplots, themes, characters, settings).
- Improve outlines, plot structure, pacing, tension, and stakes.
- Develop characters in depth (personality, voice, backstory, motivation, arc, flaws, relationships).
- Build worlds (rules, history, geography, politics, atmosphere, magic/technology).
- Sharpen themes and tone, and keep voice consistent.
- Review prose: be honest, specific, and constructive. When asked "is this good?" give a real answer with evidence.
- Solve writer's block, plot holes, and structural issues.

Always:
- Use markdown for clarity (headings, bullets, bold).
- Be specific and concrete — never generic. Reference the author's actual material.
- Stay perfectly consistent with everything in the outline, manuscript, reference books, style guides, and memory below.
- Never contradict an established fact; if something seems off, point it out and propose a fix.
${fictionType ? `- This project is ${fictionType}. Embody this genre's conventions and emotional register.\n` : ""}${perspective ? `- The book is written in ${perspective} perspective. Respect this when discussing scenes.\n` : ""}
${outline ? `═══════════════════════════════════════════════════\nCURRENT OUTLINE\n═══════════════════════════════════════════════════\n${outline}\n` : "The author has not uploaded an outline yet — help them build one if they ask.\n"}
${documentContent ? `═══════════════════════════════════════════════════\nCURRENT MANUSCRIPT (chapters written so far — read every detail)\n═══════════════════════════════════════════════════\n${documentContent}\n` : ""}
${contextBooksText ? `═══════════════════════════════════════════════════\nREFERENCE BOOKS / SERIES MATERIAL\n═══════════════════════════════════════════════════\n${contextBooksText}\n` : ""}
${styleGuidesText ? `═══════════════════════════════════════════════════\nSTYLE GUIDES\n═══════════════════════════════════════════════════\n${styleGuidesText}\n` : ""}
${ultraContextInjection ? `═══════════════════════════════════════════════════\nLEARNED MEMORY (semantic triples — facts, characters, world rules, style patterns the AI has learned about this project)\n═══════════════════════════════════════════════════\n${ultraContextInjection}\n` : ""}`;

    const apiMessages = [
      { role: "system", content: systemPrompt },
      ...messages.map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
      })),
    ];

    const primaryProvider = getProvider(requestedModel);
    const tryOrder: Provider[] = [primaryProvider];
    if (primaryProvider !== "lovable") tryOrder.push("lovable");

    console.log("dev-chat", JSON.stringify({
      model: requestedModel, primaryProvider,
      outlineLen: outline.length, manuscriptLen: documentContent.length,
      contextLen: contextBooksText.length, styleLen: styleGuidesText.length,
      ultraLen: ultraContextInjection.length, msgCount: messages.length,
    }));

    let lastError = "";
    for (const provider of tryOrder) {
      const cfg = getApiConfig(provider);
      if (!cfg) {
        lastError = `${provider}:no-api-key`;
        continue;
      }
      const finalModel = mapModelForProvider(requestedModel, provider);
      try {
        const requestBody: Record<string, unknown> = {
          model: finalModel,
          messages: apiMessages,
          temperature: 0.85,
          top_p: 0.9,
          stream: true,
        };

        if (provider === "meganova") {
          // Verified live from https://api.meganova.ai/v1/models
          const MEGANOVA_CTX: Record<string, number> = {
            "BruhzWater/Sapphira-L3.3-70b-0.1": 65_536,
            "FallenMerick/MN-Violet-Lotus-12B": 65_536,
            "Steelskull/L3.3-MS-Nevoria-70b": 65_536,
            "mistralai/Mistral-Small-3.2-24B-Instruct-2506": 32_768,
            "Sao10K/L3-70B-Euryale-v2.1": 8_192,
          };
          const ctx = MEGANOVA_CTX[finalModel] ?? 8_192;
          const outputBudget = Math.min(4_096, Math.floor(ctx * 0.4));
          const inputBudget = Math.max(1_024, ctx - outputBudget - 512);
          // Trim system message (first message) to fit budget. Keep recent user/assistant turns intact.
          const systemMsg = apiMessages[0];
          const sysChars = Math.floor(inputBudget * 0.7 * 3.6);
          const sysContent = typeof systemMsg.content === "string" ? systemMsg.content : "";
          const trimmedSys = sysContent.length > sysChars
            ? `${sysContent.slice(0, Math.floor(sysChars * 0.55))}\n\n[... condensed to fit model context window ...]\n\n${sysContent.slice(-Math.floor(sysChars * 0.4))}`
            : sysContent;
          requestBody.messages = [{ role: "system", content: trimmedSys }, ...apiMessages.slice(1)];
          requestBody.max_tokens = outputBudget;
          console.log("dev-chat meganova trim", JSON.stringify({ finalModel, ctx, outputBudget }));
        }

        const resp = await fetch(cfg.apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            "Content-Type": "application/json",
            ...cfg.extra,
          },
          body: JSON.stringify(requestBody),
        });

        if (resp.ok && resp.body) {
          return new Response(resp.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
        }

        const text = await resp.text().catch(() => "");
        lastError = `${provider}:${resp.status} ${text.slice(0, 200)}`;
        console.error("dev-chat provider failed:", lastError);

        if (resp.status === 429) {
          return new Response(JSON.stringify({ error: "Rate limited. Please wait a moment and try again." }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (resp.status === 402) {
          return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to your Lovable workspace." }), {
            status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (err) {
        lastError = `${provider}:${err instanceof Error ? err.message : String(err)}`;
        console.error("dev-chat exception:", lastError);
      }
    }

    return new Response(JSON.stringify({ error: `Chat failed across all providers. Last error: ${lastError}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("dev-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
