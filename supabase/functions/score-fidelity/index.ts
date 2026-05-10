import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const API_URL = "https://api.mistral.ai/v1/chat/completions";

const SCORING_TOOL = {
  type: "function" as const,
  function: {
    name: "store_fidelity_results",
    description: "Store the fidelity scoring results for a generated chapter",
    parameters: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "The checklist question" },
              passed: { type: "boolean", description: "Whether the chapter passes this check" },
              evidence: { type: "string", description: "Brief quote or explanation supporting the judgment" },
            },
            required: ["question", "passed", "evidence"],
          },
        },
        new_patterns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: ["voice", "recurring", "thematic", "character_voice", "world_rule"] },
              pattern_text: { type: "string" },
              checklist_question: { type: "string", description: "Binary yes/no question for this new pattern" },
              confidence: { type: "number", description: "Initial confidence 0.3-0.6 for newly discovered patterns" },
            },
            required: ["category", "pattern_text", "checklist_question", "confidence"],
          },
          description: "New stylistic patterns observed in the output that weren't in the checklist",
        },
        overall_notes: { type: "string", description: "Brief summary of the output's stylistic strengths and weaknesses" },
      },
      required: ["results", "new_patterns", "overall_notes"],
    },
  },
};

const SYSTEM_PROMPT = `You are a precise writing style auditor. You will be given a chapter of fiction and a checklist of binary yes/no questions about writing style patterns.

For EACH question in the checklist, you must determine:
1. Does the chapter PASS or FAIL this check?
2. Provide brief evidence (a short quote or concrete observation).

Be STRICT and MECHANICAL. Do not give benefit of the doubt. If a pattern should appear throughout (e.g., "Does every dialogue exchange use action beats?"), check multiple instances — if even 20% violate the rule, it FAILS.

Also scan for NEW stylistic patterns not covered by the existing checklist. If you notice consistent patterns (good or bad) that have no checklist question, flag them as new patterns with initial confidence between 0.3-0.6.

For each new pattern, create a concrete binary yes/no checklist question — not subjective ("is the writing good?") but mechanically verifiable ("Does every scene transition include a sensory detail?").

You MUST call the store_fidelity_results function. Do NOT return plain text.`;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { chapter, checklist, model } = await req.json();
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");
    if (!MISTRAL_API_KEY) throw new Error("MISTRAL_API_KEY is not configured");

    if (!chapter || chapter.trim().length < 100) {
      return jsonResponse({ error: "Chapter text too short to score" }, 400);
    }

    if (!Array.isArray(checklist) || checklist.length === 0) {
      return jsonResponse({ error: "No checklist provided" }, 400);
    }

    const checklistText = checklist
      .map((c: any, i: number) => `${i + 1}. [${c.confidence >= 0.75 ? "HARD" : "SOFT"}] ${c.q}`)
      .join("\n");

    // Truncate chapter to avoid token limits — take first 8000 words
    const words = chapter.split(/\s+/);
    const truncatedChapter = words.length > 8000
      ? words.slice(0, 4000).join(" ") + "\n\n[...middle section omitted for length...]\n\n" + words.slice(-4000).join(" ")
      : chapter;

    const useModel = model || "mistral-large-latest";

    console.log(`score-fidelity: ${checklist.length} checks, ${words.length} words, model=${useModel}`);

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: useModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `CHECKLIST TO EVALUATE:\n${checklistText}\n\nCHAPTER TO SCORE:\n\n${truncatedChapter}`,
          },
        ],
        tools: [SCORING_TOOL],
        tool_choice: { type: "function", function: { name: "store_fidelity_results" } },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("Fidelity scoring API error:", response.status, t);
      if (response.status === 429) return jsonResponse({ error: "Rate limited. Please try again." }, 429);
      return jsonResponse({ error: "Fidelity scoring failed" }, 500);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return jsonResponse({ error: "AI did not return structured scoring data" }, 500);
    }

    let scoring: any;
    try {
      scoring = JSON.parse(toolCall.function.arguments);
    } catch {
      return jsonResponse({ error: "Failed to parse scoring response" }, 500);
    }

    const results = scoring.results || [];
    const passed = results.filter((r: any) => r.passed).length;
    const total = results.length;
    const fidelityScore = total > 0 ? passed / total : 0;

    // Separate failures by severity based on checklist confidence
    const failures = results
      .filter((r: any) => !r.passed)
      .map((r: any) => {
        const match = checklist.find((c: any) => c.q === r.question);
        return {
          question: r.question,
          evidence: r.evidence,
          severity: match?.confidence >= 0.75 ? "high" : match?.confidence >= 0.40 ? "medium" : "low",
          pattern_id: match?.id || null,
        };
      });

    return jsonResponse({
      fidelityScore,
      passed,
      total,
      failures,
      newPatterns: scoring.new_patterns || [],
      notes: scoring.overall_notes || "",
    }, 200);
  } catch (e) {
    console.error("score-fidelity error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
