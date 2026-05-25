// Helpers for the generation_jobs table. Persists chapter-generation
// progress to the database so the pipeline can be resumed after tab
// switches, phone sleep, or dropped connections.
import { supabase } from "@/integrations/supabase/client";

export type JobPhase =
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

export type JobStatus = "running" | "done" | "failed" | "aborted";

export interface GenerationJob {
  id: string;
  user_id: string;
  project_id: string;
  message_id: string | null;
  chapter_number: number;
  model: string;
  status: JobStatus;
  phase: JobPhase;
  round: number;
  kernel_slug: string | null;
  kernel_user: string | null;
  draft_text: string;
  working_text: string;
  params: Record<string, unknown>;
  error: string | null;
  updated_at: string;
  created_at: string;
}

export async function createJob(input: {
  user_id: string;
  project_id: string;
  message_id: string | null;
  chapter_number: number;
  model: string;
  params: Record<string, unknown>;
}): Promise<GenerationJob | null> {
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      user_id: input.user_id,
      project_id: input.project_id,
      message_id: input.message_id,
      chapter_number: input.chapter_number,
      model: input.model,
      status: "running",
      phase: "starting",
      params: input.params,
    })
    .select()
    .single();
  if (error) {
    console.warn("createJob failed", error);
    return null;
  }
  return data as GenerationJob;
}

export async function updateJob(
  id: string,
  patch: Partial<Pick<GenerationJob, "status" | "phase" | "round" | "kernel_slug" | "kernel_user" | "draft_text" | "working_text" | "error" | "message_id">>,
) {
  const { error } = await supabase
    .from("generation_jobs")
    .update(patch)
    .eq("id", id);
  if (error) console.warn("updateJob failed", error);
}

// Find the most recent resumable (running) job for a project. We only
// auto-resume jobs that are recent enough that the user clearly hasn't
// already discarded them (e.g. last touched within the past few hours).
export async function findResumableJob(
  project_id: string,
  maxAgeMinutes = 240,
): Promise<GenerationJob | null> {
  const since = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("generation_jobs")
    .select("*")
    .eq("project_id", project_id)
    .eq("status", "running")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("findResumableJob failed", error);
    return null;
  }
  return (data as GenerationJob | null) ?? null;
}

// Mark stale (>4h, never updated) running jobs as aborted so they don't
// keep prompting the user forever.
export async function reapStaleJobs(project_id: string, maxAgeMinutes = 240) {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  await supabase
    .from("generation_jobs")
    .update({ status: "aborted", error: "stale" })
    .eq("project_id", project_id)
    .eq("status", "running")
    .lt("updated_at", cutoff);
}
