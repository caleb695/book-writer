import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_INPUT = 24_000;

type Triple = {
  subject: string;
  predicate: string;
  object_value: string;
  category: string;
  confidence: number;
};

const SYSTEM_PROMPT = `You are a knowledge-extraction engine for a long-form fiction writing app.

Your job: given a chapter (or other text), output a list of compact, durable semantic triples that capture facts the AI must remember when writing future chapters of the SAME book.

Categories you may use (pick the best fit for each triple):
- "character"      → who a character is, what they look like, their role, traits, relationships
- "character_voice"→ how a specific character speaks, their vocabulary, verbal tics
- "world_rule"    → rules of the world, magic system, technology, geography, politics, factions
- "plot"           → plot facts, events that happened, secrets revealed, promises made, deaths
- "thematic"       → recurring themes, motifs, symbolism
- "voice"          → author voice / prose style observations
- "recurring"      → recurring patterns in the prose
- "session"        → high-level summary of what happened

For each triple, choose:
- subject: short noun phrase. For characters use "char:<lowercase_name>" (e.g. "char:maya"). For world facts use "world", for plot use "plot", for theme use "theme".
- predicate: short verb / relation (e.g. "is", "wears", "fears", "betrayed", "lives_in", "speaks_with").
- object_value: the concrete fact, kept SHORT (one sentence max, no fluff, no spoilers about future chapters).
- category: from the list above.
- confidence: 0.0–1.0. Use 0.95+ only for facts directly stated in the text. 0.7–0.9 for strongly implied. 0.4–0.7 for inferred.

Rules:
- Be concise. Each triple < 200 chars in object_value.
- Capture facts that will MATTER for continuity in future chapters: who is alive, who knows what, where people are, what they want, key world rules.
- Skip generic prose-craft observations unless they are clearly the author's signature voice.
- Do NOT include the chapter number in the object_value.
- Prefer specific over general. "char:maya is a cartographer who fled the city of Lir" beats "she has a job".
- Output 8–25 triples for a typical chapter.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const text = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n").trim() : "";
    const sourceLabel = typeof body.sourceLabel === "string" ? body.sourceLabel.slice(0, 200) : "";
    if (!text) {
      return new Response(JSON.stringify({ error: "text is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clipped = text.length > MAX_INPUT ? text.slice(0, MAX_INPUT) : text;

    const userPrompt = `${sourceLabel ? `Source: ${sourceLabel}\n\n` : ""}TEXT:\n\n${clipped}\n\nExtract semantic triples now using the extract_triples tool. Return only the tool call.`;

    const resp = await fetch(LOVABLE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        tools: [
          {
            type: "function",
            function: {
              name: "extract_triples",
              description: "Return durable semantic triples extracted from the text.",
              parameters: {
                type: "object",
                properties: {
                  triples: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        subject: { type: "string" },
                        predicate: { type: "string" },
                        object_value: { type: "string" },
                        category: {
                          type: "string",
                          enum: ["character", "character_voice", "world_rule", "plot", "thematic", "voice", "recurring", "session"],
                        },
                        confidence: { type: "number" },
                      },
                      required: ["subject", "predicate", "object_value", "category", "confidence"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["triples"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_triples" } },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      console.error("extract-triples upstream error:", resp.status, t.slice(0, 400));
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Extraction failed", upstream: t.slice(0, 200) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await resp.json();
    const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0];
    let triples: Triple[] = [];
    if (toolCall?.function?.arguments) {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        if (Array.isArray(args.triples)) triples = args.triples;
      } catch (err) {
        console.error("extract-triples parse error:", err);
      }
    }

    // Normalize / sanitize
    const cleaned: Triple[] = triples
      .filter(t => t && typeof t.subject === "string" && typeof t.predicate === "string" && typeof t.object_value === "string")
      .map(t => ({
        subject: t.subject.trim().slice(0, 120),
        predicate: t.predicate.trim().slice(0, 80),
        object_value: t.object_value.trim().slice(0, 400),
        category: ["character","character_voice","world_rule","plot","thematic","voice","recurring","session"].includes(t.category)
          ? t.category : "plot",
        confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0.6)),
      }))
      .filter(t => t.subject && t.predicate && t.object_value);

    return new Response(JSON.stringify({ triples: cleaned }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-triples error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
