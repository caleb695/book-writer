// Server-side chapter polish orchestrator.
//
// Runs ONE polish phase per invocation, persists `working_text` + `phase`
// to public.generation_jobs, then re-invokes itself in the background via
// EdgeRuntime.waitUntil so the pipeline keeps progressing even if the user
// closes the tab. A pg_cron watchdog re-kicks this function for any job
// whose updated_at falls behind, so a crashed edge invocation can't strand
// a job forever.
//
// Phases handled here (post-draft): enhancing -> fact-checking -> correcting
// -> checking -> (loop up to 3 rounds) -> finalizing -> done.
//
// All required context (outline, style checklist, models, etc) lives in
// generation_jobs.params, populated by the client when the draft completes.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const FN_BASE = `${SUPABASE_URL}/functions/v1`;
const PATCH_URL = `${FN_BASE}/patch-chapter`;
const FACT_CHECK_URL = `${FN_BASE}/fact-check-chapter`;
const SCORE_URL = `${FN_BASE}/score-fidelity`;
const SELF_URL = `${FN_BASE}/chapter-orchestrator`;

const MAX_POLISH_ROUNDS = 3;
const CLAIM_TTL_MS = 90_000; // a claim older than this is considered abandoned

type Phase =
  | "starting"
  | "kaggle-submitting"
  | "kaggle-polling"
  | "drafting"
  | "enhancing"
  | "fact-checking"
  | "correcting"
  | "checking"
  | "polishing"
  | "finalizing";

interface Job {
  id: string;
  user_id: string;
  project_id: string;
  message_id: string | null;
  chapter_number: number;
  model: string;
  status: string;
  phase: Phase;
  round: number;
  draft_text: string;
  working_text: string;
  params: Record<string, any>;
  error: string | null;
  claimed_at: string | null;
  updated_at: string;
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResp(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function callOther(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Internal calls use the service-role key — Lovable functions deploy
      // with verify_jwt=false so this is for symmetry, not auth.
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify(body),
  });
}

function fireAndForgetSelf(job_id: string): void {
  // Re-invoke this same function so the next phase runs without the caller
  // having to wait. waitUntil keeps the runtime alive long enough to flush.
  const p = fetch(SELF_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ job_id }),
  }).catch((e) => console.warn("self-invoke failed", e));
  // @ts-ignore — provided by Supabase Edge Functions runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(p);
  }
}

async function claimJob(job_id: string): Promise<Job | null> {
  const now = new Date();
  const claimCutoff = new Date(now.getTime() - CLAIM_TTL_MS).toISOString();

  // Atomic claim: only succeed if no recent claim exists.
  const { data, error } = await admin
    .from("generation_jobs")
    .update({ claimed_at: now.toISOString() })
    .eq("id", job_id)
    .eq("status", "running")
    .or(`claimed_at.is.null,claimed_at.lt.${claimCutoff}`)
    .select()
    .maybeSingle();

  if (error) {
    console.warn("claimJob error", error);
    return null;
  }
  return (data as Job | null) ?? null;
}

async function releaseClaim(job_id: string): Promise<void> {
  await admin
    .from("generation_jobs")
    .update({ claimed_at: null })
    .eq("id", job_id);
}

async function patchJob(job_id: string, patch: Partial<Job>): Promise<void> {
  const { error } = await admin.from("generation_jobs").update(patch).eq("id", job_id);
  if (error) console.warn("patchJob failed", error);
}

async function failJob(job_id: string, msg: string): Promise<void> {
  console.error(`[orchestrator] job ${job_id} failed:`, msg);
  await patchJob(job_id, { status: "failed", error: msg.slice(0, 1000), claimed_at: null } as any);
}

// Apply find/replace edits returned by patch-chapter to the text.
function applyEdits(base: string, edits: Array<{ find: string; replace: string }>): string {
  let working = base;
  for (const e of edits) {
    if (!e?.find || typeof e.replace !== "string") continue;
    const idx = working.indexOf(e.find);
    if (idx === -1) continue;
    working = working.slice(0, idx) + e.replace + working.slice(idx + e.find.length);
  }
  return working;
}

async function runPhase(job: Job): Promise<void> {
  const p = job.params || {};
  const wMin = Number(p.wordCountMin) || 3500;
  const wMax = Number(p.wordCountMax) || 4000;
  const checklist: any[] = Array.isArray(p.checklist) ? p.checklist : [];
  const styleRules: string = p.styleRules || "";
  const ultra: string = p.ultraContextInjection || "";
  const perspective: string = p.perspective || "";
  const fictionType: string = p.fictionType || "";
  const ctxBundle: string = p.contextBundle || "";
  const polishModel: string = p.polishModel || "google/gemini-2.5-pro";
  const scoringModel: string = p.scoringModel || "mistral-large-latest";

  let working = job.working_text || job.draft_text || "";
  if (!working.trim()) {
    return failJob(job.id, "empty working_text — cannot polish");
  }

  const round = Math.max(1, job.round || 1);

  switch (job.phase) {
    case "starting":
    case "drafting":
    case "enhancing": {
      console.log(`[orchestrator] job ${job.id} round ${round} ENHANCE`);
      const resp = await callOther(PATCH_URL, {
        draft: working,
        goal: "enhance",
        wordCountMin: wMin,
        wordCountMax: wMax,
        checklist,
        styleRules,
        ultraContextInjection: ultra,
        perspective,
        fictionType,
        contextBundle: ctxBundle,
        maxEdits: 25,
      });
      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        const edits = Array.isArray(data?.edits) ? data.edits : [];
        working = applyEdits(working, edits);
      } else {
        console.warn("patch enhance failed", resp.status);
      }
      await patchJob(job.id, { working_text: working, phase: "fact-checking", round, claimed_at: null } as any);
      fireAndForgetSelf(job.id);
      return;
    }

    case "fact-checking": {
      console.log(`[orchestrator] job ${job.id} round ${round} FACT-CHECK`);
      let issues: any[] = [];
      if (ctxBundle.trim()) {
        const resp = await callOther(FACT_CHECK_URL, {
          chapter: working,
          context: ctxBundle,
          model: polishModel,
        });
        if (resp.ok) {
          const data = await resp.json().catch(() => null);
          if (Array.isArray(data?.issues)) issues = data.issues;
        } else {
          console.warn("fact-check failed", resp.status);
        }
      }
      await patchJob(job.id, {
        params: { ...p, lastIssues: issues } as any,
        phase: issues.length > 0 ? "correcting" : "checking",
        claimed_at: null,
      } as any);
      fireAndForgetSelf(job.id);
      return;
    }

    case "correcting": {
      const issues: any[] = Array.isArray(p.lastIssues) ? p.lastIssues : [];
      console.log(`[orchestrator] job ${job.id} round ${round} CORRECT (${issues.length} issues)`);
      if (issues.length > 0) {
        const resp = await callOther(PATCH_URL, {
          draft: working,
          goal: "fix-issues",
          issues,
          wordCountMin: wMin,
          wordCountMax: wMax,
          checklist,
          styleRules,
          ultraContextInjection: ultra,
          perspective,
          fictionType,
          contextBundle: ctxBundle,
          maxEdits: 40,
        });
        if (resp.ok) {
          const data = await resp.json().catch(() => null);
          const edits = Array.isArray(data?.edits) ? data.edits : [];
          working = applyEdits(working, edits);
        } else {
          console.warn("patch fix-issues failed", resp.status);
        }
      }
      await patchJob(job.id, { working_text: working, phase: "checking", claimed_at: null } as any);
      fireAndForgetSelf(job.id);
      return;
    }

    case "checking": {
      console.log(`[orchestrator] job ${job.id} round ${round} CHECK`);
      let score = 1;
      let seriousFailures = 0;
      const issues: any[] = Array.isArray(p.lastIssues) ? p.lastIssues : [];

      if (checklist.length > 0) {
        const resp = await callOther(SCORE_URL, {
          chapter: working,
          checklist,
          model: scoringModel,
        });
        if (resp.ok) {
          const data = await resp.json().catch(() => null);
          score = typeof data?.fidelityScore === "number" ? data.fidelityScore : 1;
          if (Array.isArray(data?.failures)) {
            seriousFailures = data.failures.filter((f: any) => f.severity === "high" || f.severity === "medium").length;
          }
        } else {
          console.warn("score-fidelity failed", resp.status);
        }
      }

      const factsClean = issues.length === 0;
      const checklistClean = score >= 0.85 && seriousFailures === 0;
      const clean = factsClean && checklistClean;
      const lastRound = round >= MAX_POLISH_ROUNDS;

      if (clean || lastRound) {
        await patchJob(job.id, { phase: "finalizing", working_text: working, claimed_at: null } as any);
      } else {
        // Start another polish round.
        await patchJob(job.id, {
          phase: "enhancing",
          round: round + 1,
          working_text: working,
          claimed_at: null,
        } as any);
      }
      fireAndForgetSelf(job.id);
      return;
    }

    case "polishing": {
      // Legacy transitional phase; treat as "go to next round enhancing".
      await patchJob(job.id, { phase: "enhancing", round: Math.min(round + 1, MAX_POLISH_ROUNDS), claimed_at: null } as any);
      fireAndForgetSelf(job.id);
      return;
    }

    case "finalizing": {
      console.log(`[orchestrator] job ${job.id} FINALIZE`);
      if (job.message_id) {
        const { error } = await admin
          .from("ai_messages")
          .update({ content: working })
          .eq("id", job.message_id);
        if (error) console.warn("ai_message update failed", error);
      }
      await patchJob(job.id, { status: "done", working_text: working, claimed_at: null } as any);
      return;
    }

    default:
      // Phases we don't drive here (kaggle-*, drafting). Just release the claim.
      await releaseClaim(job.id);
      return;
  }
}

// Cron-callable: scan for any running, polish-phase job whose claim has expired
// and re-kick the orchestrator on it. Idempotent.
async function runWatchdog(): Promise<{ kicked: number }> {
  const cutoff = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
  const { data, error } = await admin
    .from("generation_jobs")
    .select("id, phase, claimed_at, updated_at")
    .eq("status", "running")
    .in("phase", ["enhancing", "fact-checking", "correcting", "checking", "polishing", "finalizing"])
    .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`)
    .lt("updated_at", cutoff)
    .limit(20);
  if (error) {
    console.warn("watchdog query failed", error);
    return { kicked: 0 };
  }
  for (const j of data || []) {
    fireAndForgetSelf((j as any).id);
  }
  return { kicked: (data || []).length };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try {
    body = await req.json();
  } catch { /* empty body ok for watchdog */ }

  // Watchdog mode.
  if (body?.watchdog === true) {
    const r = await runWatchdog();
    return jsonResp({ ok: true, ...r });
  }

  const job_id = body?.job_id;
  if (!job_id || typeof job_id !== "string") {
    return jsonResp({ error: "job_id required" }, 400);
  }

  const job = await claimJob(job_id);
  if (!job) {
    // Either not running, or another invocation has it. That's fine.
    return jsonResp({ ok: true, skipped: true });
  }

  try {
    await runPhase(job);
    return jsonResp({ ok: true, phase: job.phase });
  } catch (e: any) {
    console.error("runPhase threw", e);
    await failJob(job.id, e?.message || String(e));
    return jsonResp({ ok: false, error: String(e?.message || e) }, 500);
  }
});
