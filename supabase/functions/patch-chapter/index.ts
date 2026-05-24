// Surgical patch-edit pass. Reads the draft chapter and returns a list of
// {find, replace, reason} edits via tool calling. The client applies each
// patch one-by-one so the user literally sees specific spans being edited
// instead of the whole chapter being regenerated.
//
// Always uses Lovable AI Gateway because tool-calling reliability matters
// most for this step. The user's chosen model still writes the draft.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

function countWords(s: string): number {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      draft,
      goal = "enhance",         // "enhance" | "fix-issues"
      issues = [],              // for fix-issues
      wordCountMin = 3500,
      wordCountMax = 4000,
      checklist = [],
      styleRules = "",
      ultraContextInjection = "",
      perspective = "",
      fictionType = "",
      contextBundle = "",       // outline + memory for fact-grounded edits
      maxEdits = 30,
    } = body;

    if (!draft || typeof draft !== "string") return json({ error: "draft is required" }, 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

    const wc = countWords(draft);
    const wMin = Number(wordCountMin) || 3500;
    const wMax = Number(wordCountMax) || 4000;

    const checklistText = Array.isArray(checklist) && checklist.length > 0
      ? checklist.slice(0, 25).map((c: any) => `- ${c.q}`).join("\n")
      : "";

    let goalSection = "";
    if (goal === "fix-issues" && Array.isArray(issues) && issues.length > 0) {
      goalSection = `GOAL: Surgically fix the listed factual / continuity issues below.

ISSUES TO FIX (each requires at least one edit):
${issues.slice(0, 40).map((i: any, idx: number) => `${idx + 1}. [${i.severity || "med"}] ${i.category || "issue"}: ${i.problem || ""}${i.quote ? `\n   QUOTED FROM CHAPTER: "${i.quote}"` : ""}${i.correct_fact ? `\n   CORRECT FACT: ${i.correct_fact}` : ""}`).join("\n")}

For each issue, return an edit whose \`find\` is the exact problematic span from the chapter and whose \`replace\` is the corrected version. Propagate name corrections to every occurrence (one edit per occurrence).`;
    } else {
      goalSection = `GOAL: Make the chapter dramatically better through targeted surgical edits — NEVER rewrite whole paragraphs unless absolutely necessary. Each edit picks ONE specific weak span and replaces it with a stronger version.

EDIT PRIORITIES (in order):
1. Flat "telling" lines ("she felt sad", "he was angry") → replace with shown behavior / physiology / dialogue.
2. Generic verbs and adjectives → replace with specific, character-revealing language.
3. Thin dialogue exchanges → expand with beats, subtext, and interiority woven into the same span.
4. Big emotional / decision moments that pass too fast → expand the moment with sensory + interior detail.
5. Clichés → replace with fresh imagery rooted in this character's voice.
6. Word-count gap: current is ${wc}, target ${wMin}-${wMax}. ${wc < wMin ? `Add ~${wMin - wc} words by EXPANDING existing spans (replace short span with longer enriched version).` : wc > wMax ? `Trim ~${wc - wMax} words by replacing bloated spans with tighter prose.` : "Word count is in range — focus on quality, not length."}

RULES:
- NEVER change names, plot events, character actions, scene outcomes, or canonical facts.
- NEVER add new scenes or remove existing ones.
- The chapter heading (## Chapter X: ...) is sacred — never edit it.
- Each \`find\` MUST be a verbatim substring of the chapter (copy-paste exact).
- Make ${Math.min(maxEdits, 30)} or fewer high-impact edits. Quality over quantity.`;
    }

    const systemPrompt = `You are a world-class fiction editor making SURGICAL edits to a draft chapter. You do not rewrite — you pick specific weak spans and replace them with stronger versions, like a copy editor marking up a manuscript.

${goalSection}

${perspective ? `PERSPECTIVE: Maintain strict ${perspective}.` : ""}
${fictionType ? `GENRE: ${fictionType}.` : ""}
${styleRules ? `\nSTYLE RULES (non-negotiable):\n${styleRules}` : ""}
${checklistText ? `\nQUALITY CHECKLIST (every item must be satisfied after edits):\n${checklistText}` : ""}
${ultraContextInjection ? `\nMEMORY / CANONICAL FACTS:\n${ultraContextInjection}` : ""}
${contextBundle ? `\nFACT GROUNDING:\n${contextBundle.slice(0, 12_000)}` : ""}

Return your edits via the \`apply_edits\` tool. Each edit must be applyable as a literal string replacement.`;

    const userPrompt = `DRAFT CHAPTER (current word count: ${wc}):

${draft}

Now return the list of surgical edits via the apply_edits tool.`;

    const tools = [{
      type: "function",
      function: {
        name: "apply_edits",
        description: "Return a list of surgical find/replace edits to apply to the chapter.",
        parameters: {
          type: "object",
          properties: {
            edits: {
              type: "array",
              maxItems: maxEdits,
              items: {
                type: "object",
                properties: {
                  find: { type: "string", description: "Exact verbatim substring from the chapter to replace. Must match character-for-character." },
                  replace: { type: "string", description: "The improved text that replaces `find`." },
                  reason: { type: "string", description: "One short sentence describing the improvement." },
                },
                required: ["find", "replace", "reason"],
                additionalProperties: false,
              },
            },
          },
          required: ["edits"],
          additionalProperties: false,
        },
      },
    }];

    const resp = await fetch(LOVABLE_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "apply_edits" } },
        temperature: 0.4,
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("patch-chapter gateway error", resp.status, t.slice(0, 500));
      if (resp.status === 429) return json({ error: "Rate limited, please try again shortly." }, 429);
      if (resp.status === 402) return json({ error: "Add credits to continue." }, 402);
      return json({ error: "patch model failed" }, 502);
    }

    const data = await resp.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return json({ edits: [] });

    let edits: Array<{ find: string; replace: string; reason?: string }> = [];
    try {
      const parsed = JSON.parse(call.function?.arguments || "{}");
      if (Array.isArray(parsed.edits)) edits = parsed.edits;
    } catch (e) {
      console.error("patch-chapter parse error", e);
    }

    // Filter out edits whose `find` isn't present in the draft (model hallucinated)
    // and the no-op edits.
    edits = edits.filter(e =>
      e && typeof e.find === "string" && typeof e.replace === "string"
      && e.find.length > 0 && e.find !== e.replace
      && draft.includes(e.find)
    );

    return json({ edits, count: edits.length });
  } catch (e) {
    console.error("patch-chapter error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
