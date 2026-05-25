import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { RotateCcw, Check, Loader2, StopCircle, Info, Copy, Trash2, PlayCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import type { UploadedFile, AiMessage } from "@/hooks/useProject";
import type { AiSettings } from "@/hooks/useAiSettings";
import type { StylePattern, StyleMemory, FidelityResult } from "@/hooks/useStyleMemory";
import { AI_MODELS, FICTION_TYPES, formatContextWindow } from "@/hooks/useAiSettings";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import MemoryBadge from "@/components/MemoryBadge";
import {
  createJob,
  updateJob,
  findResumableJob,
  reapStaleJobs,
  type GenerationJob,
  type JobPhase,
} from "@/lib/generationJob";

interface AiTabProps {
  projectId: string | null;
  userId: string;
  files: UploadedFile[];
  messages: AiMessage[];
  documentContent: string;
  onAddMessage: (role: "user" | "assistant", content: string, chapter?: number) => Promise<AiMessage | null>;
  onUpdateMessage: (id: string, content: string) => Promise<void>;
  onCommitMessage: (id: string) => Promise<void>;
  onDeleteMessage: (id: string) => Promise<void>;
  onSaveDocument: (content: string) => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<AiMessage[]>>;
  styleGuides: string[];
  aiSettings: AiSettings;
  onUpdateAiSettings: (patch: Partial<AiSettings>) => Promise<void>;
  styleMemory: StyleMemory | null;
  stylePatterns: StylePattern[];
  onScoreFidelity: (chapter: string, model?: string) => Promise<FidelityResult | null>;
  scoring: boolean;
  lastFidelity: FidelityResult | null;
  ultraContextInjection?: string;
  memoryTotalCount?: number;
  memoryCategoryCounts?: Record<string, number>;
}

const PERSPECTIVES = [
  { value: "", label: "Default (from outline)" },
  { value: "first person", label: "First Person" },
  { value: "second person", label: "Second Person" },
  { value: "third person limited", label: "Third Person Limited" },
  { value: "third person omniscient", label: "Third Person Omniscient" },
];

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-chapter`;
const PATCH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/patch-chapter`;
const FACT_CHECK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fact-check-chapter`;
const KAGGLE_SUBMIT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kaggle-submit`;
const KAGGLE_RESULT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kaggle-result`;

const AiTab = ({
  projectId, userId,
  files, messages, documentContent,
  onAddMessage, onUpdateMessage, onCommitMessage,
  onDeleteMessage, onSaveDocument, setMessages, styleGuides,
  aiSettings, onUpdateAiSettings, styleMemory, stylePatterns,
  onScoreFidelity, scoring, lastFidelity, ultraContextInjection,
  memoryTotalCount = 0, memoryCategoryCounts,
}: AiTabProps) => {
  const [chapterInput, setChapterInput] = useState(String(aiSettings.chapter_number || 1));
  const [wordCountMin, setWordCountMin] = useState("3500");
  const [wordCountMax, setWordCountMax] = useState("4000");
  const [isGenerating, setIsGenerating] = useState(false);
  const [enhancePhase, setEnhancePhase] = useState<"idle" | "drafting" | "enhancing" | "fact-checking" | "correcting" | "checking" | "polishing" | "finalizing">("idle");
  const [phaseIteration, setPhaseIteration] = useState<number>(0);
  const [rewriteId, setRewriteId] = useState<string | null>(null);
  const [rewriteNotes, setRewriteNotes] = useState("");
  const [perspective, setPerspective] = useState(aiSettings.perspective || "");
  const [modelSearch, setModelSearch] = useState("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [fictionSearch, setFictionSearch] = useState("");
  const [fictionDropdownOpen, setFictionDropdownOpen] = useState(false);
  const contentRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const generatingMsgIdRef = useRef<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const [resumableJob, setResumableJob] = useState<GenerationJob | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fictionDropdownRef = useRef<HTMLDivElement>(null);

  const chapterNum = parseInt(chapterInput, 10);
  const validChapter = !isNaN(chapterNum) && chapterNum >= 1;

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Sync chapter input from saved settings
  useEffect(() => {
    if (aiSettings.chapter_number) {
      setChapterInput(String(aiSettings.chapter_number));
    }
  }, [aiSettings.chapter_number]);

  // Sync perspective from saved settings
  useEffect(() => {
    if (aiSettings.perspective !== undefined) {
      setPerspective(aiSettings.perspective);
    }
  }, [aiSettings.perspective]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
      if (fictionDropdownRef.current && !fictionDropdownRef.current.contains(e.target as Node)) {
        setFictionDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const incompleteMsg = messages.find(m => m.role === "assistant" && !m.committed && !m.content.trim());

  const outline = files.find(f => f.file_type === "outline")?.content || "";
  const contextBooks = files.filter(f => f.file_type === "context").map(f => f.content);

  const committedChapters = messages
    .filter(m => m.role === "assistant" && m.committed)
    .map(m => m.content)
    .join("\n\n");

  const buildWordCountInstruction = () => {
    const min = wordCountMin.trim();
    const max = wordCountMax.trim();
    if (min && max) return `Write between ${min} and ${max} words. Aim for closer to ${max} words, but NEVER exceed ${max} words and NEVER go below ${min} words. Count your words carefully.`;
    if (min && !max) return `Write at least ${min} words. Aim for well above ${min} words. Count your words carefully.`;
    if (!min && max) return `Write no more than ${max} words. Aim for close to ${max} words but do not exceed it. Count your words carefully.`;
    return "";
  };

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
  }, []);

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      toast.success("Chapter copied to clipboard");
    }).catch(() => {
      toast.error("Failed to copy");
    });
  }, []);

  // Count words accurately
  const countWords = useCallback((text: string) => {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }, []);

  // Read a streamed response into a string (hidden from UI)
  const readStreamToString = useCallback(async (resp: Response, signal?: AbortSignal): Promise<string> => {
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      if (signal?.aborted) { reader.cancel(); throw new DOMException("Aborted", "AbortError"); }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx: number;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (json === "[DONE]") break;
        if (json.includes('"conversation.response.started"') || json.includes('"conversation.response.completed"')) continue;
        try {
          const parsed = JSON.parse(json);
          const delta = parsed.content ?? parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) fullText += delta;
        } catch { /* skip malformed */ }
      }
    }
    return fullText;
  }, []);

  // Wait helper that respects the abort signal
  const wait = useCallback((ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => { window.clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }), []);

  // Request structured surgical edits from patch-chapter and apply them
  // one-by-one with a short delay so the user literally SEES each span
  // being edited. Returns the final text after all patches are applied.
  const applyPatchEdits = useCallback(async (params: {
    msgId: string;
    baseText: string;
    goal: "enhance" | "fix-issues";
    issues?: any[];
    wordCountMin: string;
    wordCountMax: string;
    checklist: any[];
    styleRules?: string;
    ultraContextInjection?: string;
    perspective?: string;
    fictionType?: string;
    contextBundle?: string;
    signal?: AbortSignal;
  }): Promise<{ text: string; appliedCount: number }> => {
    const { msgId, baseText, goal, issues, wordCountMin, wordCountMax, checklist, styleRules, ultraContextInjection, perspective, fictionType, contextBundle, signal } = params;

    const resp = await fetch(PATCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        draft: baseText,
        goal,
        issues: issues || [],
        wordCountMin: parseInt(wordCountMin) || 3500,
        wordCountMax: parseInt(wordCountMax) || 4000,
        checklist,
        styleRules,
        ultraContextInjection,
        perspective,
        fictionType,
        contextBundle,
        maxEdits: goal === "fix-issues" ? 40 : 25,
      }),
      signal,
    });

    if (!resp.ok) {
      console.warn("patch-chapter failed", resp.status);
      return { text: baseText, appliedCount: 0 };
    }

    const data = await resp.json().catch(() => null);
    const edits: Array<{ find: string; replace: string; reason?: string }> = Array.isArray(data?.edits) ? data.edits : [];
    if (edits.length === 0) return { text: baseText, appliedCount: 0 };

    // Apply all edits silently in a tight loop — nothing is shown to the user
    // until the entire generate+polish pipeline finishes. This is dramatically
    // faster than the previous visible per-edit animation.
    let working = baseText;
    let applied = 0;
    for (const edit of edits) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (!edit?.find || typeof edit.replace !== "string") continue;
      const idx = working.indexOf(edit.find);
      if (idx === -1) continue;
      working = working.slice(0, idx) + edit.replace + working.slice(idx + edit.find.length);
      applied++;
    }
    contentRef.current = working;
    return { text: working, appliedCount: applied };
  }, []);

  const processStream = useCallback(async (resp: Response, msgId: string) => {
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx: number;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (json === "[DONE]") break;
        if (json.includes('"conversation.response.started"') || json.includes('"conversation.response.completed"')) continue;
        try {
          const parsed = JSON.parse(json);
          const delta = parsed.content ?? parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            contentRef.current += delta;
            setMessages(prev =>
              prev.map(m => m.id === msgId ? { ...m, content: contentRef.current } : m)
            );
          }
        } catch { /* skip malformed */ }
      }
    }
  }, [setMessages]);

  // Poll a Kaggle kernel until it produces a chapter. Accepts either a
  // freshly-submitted response or a previously-saved {kernelSlug, userName}
  // so a resumed job can reconnect to a kernel that is still running on
  // Kaggle's servers without re-submitting it.
  const pollKaggleKernel = useCallback(async (kernelSlug: string, userName: string) => {
    const pollDelay = (ms: number) => new Promise((resolve, reject) => {
      const timer = window.setTimeout(resolve, ms);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      abortRef.current?.signal.addEventListener("abort", onAbort, { once: true });
    });

    let announcedQueue = false;
    let lastStatus = "";

    while (true) {
      if (abortRef.current?.signal.aborted) throw new DOMException("Aborted", "AbortError");

      const pollUrl = new URL(KAGGLE_RESULT_URL);
      pollUrl.searchParams.set("kernelSlug", kernelSlug);
      pollUrl.searchParams.set("userName", userName);

      const pollResp = await fetch(pollUrl.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        signal: abortRef.current?.signal,
      });

      const pollData = await pollResp.json().catch(() => null);
      if (!pollResp.ok) {
        throw new Error(pollData?.error || `Kaggle job failed (${pollResp.status})`);
      }

      if (!pollData?.done) {
        const nextStatus = String(pollData?.status || "queued");
        if (nextStatus !== lastStatus) {
          lastStatus = nextStatus;
          if (!announcedQueue) {
            toast("Kaggle model running…", { duration: 2500 });
            announcedQueue = true;
          }
        }
        await pollDelay(nextStatus === "running" ? 3500 : 2500);
        continue;
      }

      const result = pollData?.result;
      if (!result?.ok) {
        throw new Error(result?.error || pollData?.error || "Kaggle model did not return a chapter");
      }

      const finalContent = String(result.content || "").trim();
      if (!finalContent) {
        throw new Error("Kaggle model returned an empty chapter");
      }

      contentRef.current = finalContent;
      return finalContent;
    }
  }, []);

  const streamKaggleNotebookResult = useCallback(async (resp: Response, _msgId: string) => {
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(data?.error || `Generation failed (${resp.status})`);
    }
    const kernelSlug = data?.kernelSlug;
    const userName = data?.userName;
    if (!kernelSlug || !userName) {
      throw new Error("Kaggle job did not start correctly");
    }
    // Persist the kernel handle immediately so a refresh/sleep can resume.
    if (jobIdRef.current) {
      await updateJob(jobIdRef.current, {
        phase: "kaggle-polling",
        kernel_slug: kernelSlug,
        kernel_user: userName,
      });
    }
    return pollKaggleKernel(kernelSlug, userName);
  }, [pollKaggleKernel]);

  const streamGenerate = useCallback(async (
    rewrite?: boolean,
    notes?: string,
    continueMsg?: AiMessage,
    resumeJob?: GenerationJob,
  ) => {
    if (!outline && !resumeJob) { toast.error("Upload an outline first"); return; }
    if (!validChapter && !continueMsg && !resumeJob) { toast.error("Enter a valid chapter number"); return; }
    if (isGenerating) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setEnhancePhase("drafting");
    setPhaseIteration(0);
    let assistantMsg: AiMessage | null;
    const targetChapter = resumeJob?.chapter_number || continueMsg?.chapter_number || chapterNum;

    if (resumeJob) {
      // Re-attach to the assistant message that this job was generating.
      let existing = messages.find(m => m.id === resumeJob.message_id);
      if (!existing && resumeJob.message_id) {
        // Message was lost from local state but should still exist in DB —
        // create a placeholder so the UI has something to attach to.
        existing = await onAddMessage("assistant", "", resumeJob.chapter_number);
      }
      if (!existing) {
        existing = await onAddMessage("assistant", "", resumeJob.chapter_number);
      }
      if (!existing) { setIsGenerating(false); setEnhancePhase("idle"); return; }
      assistantMsg = existing;
      contentRef.current = resumeJob.working_text || resumeJob.draft_text || "";
    } else if (continueMsg) {
      assistantMsg = continueMsg;
      contentRef.current = continueMsg.content || "";
    } else {
      contentRef.current = "";
      const userText = rewrite
        ? `Rewrite Chapter ${targetChapter}${notes ? ` — ${notes}` : ""}`
        : `Write Chapter ${targetChapter}`;
      await onAddMessage("user", userText, targetChapter);
      assistantMsg = await onAddMessage("assistant", "", targetChapter);
      if (!assistantMsg) { setIsGenerating(false); setEnhancePhase("idle"); return; }
    }

    generatingMsgIdRef.current = assistantMsg.id;
    const wordCountInstruction = buildWordCountInstruction();
    const partialContent = continueMsg?.content?.trim() || undefined;
    const activeModel = resumeJob?.model || aiSettings.model;
    const hiddenPolishModel = activeModel.startsWith("kaggle/") ? "google/gemini-2.5-flash" : activeModel;
    const scoringModel = /^(mistral|ministral|magistral|codestral|pixtral)/i.test(hiddenPolishModel)
      ? hiddenPolishModel
      : "mistral-large-latest";

    // --- Persist a job row so progress survives tab switches / sleep ---
    // For a fresh run we insert a new row; for a resume we just reuse the
    // existing job id so further updates land on the same record.
    let jobId: string | null = resumeJob?.id ?? null;
    if (!resumeJob && projectId && userId) {
      const created = await createJob({
        user_id: userId,
        project_id: projectId,
        message_id: assistantMsg.id,
        chapter_number: targetChapter,
        model: activeModel,
        params: {
          rewrite: !!rewrite,
          notes: notes || null,
          wordCountMin,
          wordCountMax,
          perspective: perspective || null,
          fictionType: aiSettings.fiction_type_enabled ? aiSettings.fiction_type : null,
        },
      });
      jobId = created?.id ?? null;
    } else if (resumeJob && assistantMsg.id !== resumeJob.message_id) {
      // Update the job's message_id if we had to re-create the assistant message
      await updateJob(resumeJob.id, { message_id: assistantMsg.id });
    }
    jobIdRef.current = jobId;

    // Show "Drafting..." placeholder in the message
    setMessages(prev =>
      prev.map(m => m.id === assistantMsg!.id ? { ...m, content: "" } : m)
    );

    try {
      // === PHASE 1: Generate (or restore) the draft chapter ===
      let draftText = "";
      const isKaggle = activeModel.startsWith("kaggle/");
      const resumedDraft = resumeJob?.draft_text?.trim() || "";
      const resumedWorking = resumeJob?.working_text?.trim() || "";

      if (resumedWorking || resumedDraft) {
        // Already past the draft phase — pick up from saved text.
        draftText = resumedDraft || resumedWorking;
        toast("Resuming previous chapter generation…", { duration: 2500 });
      } else if (isKaggle && resumeJob?.kernel_slug && resumeJob?.kernel_user) {
        // The Kaggle kernel kept running on Kaggle's servers — just reconnect.
        toast("Reconnecting to running Kaggle kernel…", { duration: 2500 });
        if (jobId) await updateJob(jobId, { phase: "kaggle-polling" });
        draftText = await pollKaggleKernel(resumeJob.kernel_slug, resumeJob.kernel_user);
        if (jobId) await updateJob(jobId, { phase: "drafting", draft_text: draftText, working_text: draftText });
      } else if (isKaggle) {
        const modelEntry = AI_MODELS.find(m => m.id === activeModel);
        const ctx = modelEntry?.contextWindow ?? 8192;

        if (jobId) await updateJob(jobId, { phase: "kaggle-submitting" });
        const submitResp = await fetch(KAGGLE_SUBMIT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            outline,
            contextBooks,
            chapterNumber: targetChapter,
            rewriteNotes: rewrite ? notes : undefined,
            previousChapters: committedChapters,
            fullManuscript: documentContent || undefined,
            wordCountInstruction,
            wordCountMin: parseInt(wordCountMin) || 3500,
            wordCountMax: parseInt(wordCountMax) || 4000,
            perspective: perspective || undefined,
            fictionType: aiSettings.fiction_type_enabled ? aiSettings.fiction_type : undefined,
            partialContent,
            styleGuides: styleGuides.length > 0 ? styleGuides : undefined,
            structuredMemory: styleMemory ? {
              voiceProfile: styleMemory.voice_profile,
              styleCache: styleMemory.style_cache,
              detectedGenre: styleMemory.detected_genre,
              genreConventions: styleMemory.genre_conventions,
            } : undefined,
            checklist: stylePatterns
              .filter(p => p.confidence >= 0.40)
              .map(p => ({ q: p.checklist_question, confidence: p.confidence, locked: p.locked, category: p.category })),
            ultraContextInjection: ultraContextInjection || undefined,
            model: activeModel,
            temperature: aiSettings.temperature,
            topP: aiSettings.top_p,
            contextWindow: ctx,
          }),
          signal: controller.signal,
        });

        draftText = await streamKaggleNotebookResult(submitResp, assistantMsg.id);
        if (jobId) await updateJob(jobId, { phase: "drafting", draft_text: draftText, working_text: draftText });
      } else {
        if (jobId) await updateJob(jobId, { phase: "drafting" });
        const draftResp = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            outline,
            contextBooks,
            chapterNumber: targetChapter,
            rewriteNotes: rewrite ? notes : undefined,
            previousChapters: committedChapters,
            fullManuscript: documentContent || undefined,
            wordCountInstruction,
            perspective: perspective || undefined,
            fictionType: aiSettings.fiction_type_enabled ? aiSettings.fiction_type : undefined,
            styleGuides: styleGuides.length > 0 ? styleGuides : undefined,
            partialContent,
            model: activeModel,
            temperature: aiSettings.temperature,
            top_p: aiSettings.top_p,
            structuredMemory: styleMemory ? {
              voiceProfile: styleMemory.voice_profile,
              styleCache: styleMemory.style_cache,
              detectedGenre: styleMemory.detected_genre,
              genreConventions: styleMemory.genre_conventions,
            } : undefined,
            checklist: stylePatterns
              .filter(p => p.confidence >= 0.40)
              .map(p => ({ q: p.checklist_question, confidence: p.confidence, locked: p.locked, category: p.category })),
            ultraContextInjection: ultraContextInjection || undefined,
          }),
          signal: controller.signal,
        });

        if (!draftResp.ok) {
          const err = await draftResp.json().catch(() => ({ error: "Generation failed" }));
          toast.error(err.error || "Generation failed");
          if (!continueMsg && !resumeJob) await onDeleteMessage(assistantMsg.id);
          if (jobId) await updateJob(jobId, { status: "failed", error: err.error || "draft failed" });
          setIsGenerating(false);
          setEnhancePhase("idle");
          return;
        }

        draftText = await readStreamToString(draftResp, controller.signal);
        if (jobId) await updateJob(jobId, { draft_text: draftText, working_text: draftText });
      }

      if (!draftText.trim()) {
        if (!continueMsg && !resumeJob) await onDeleteMessage(assistantMsg.id);
        toast.error("AI returned an empty response. Try again.");
        if (jobId) await updateJob(jobId, { status: "failed", error: "empty draft" });
        setIsGenerating(false);
        setEnhancePhase("idle");
        return;
      }

      contentRef.current = draftText;

      const draftWordCount = countWords(draftText);
      toast(`Draft complete (${draftWordCount.toLocaleString()} words). Polishing…`, { duration: 2500 });

      // Build style + fact context for the patch editor
      let styleRulesText = "";
      const activePatterns = stylePatterns.filter(p => p.confidence >= 0.40);
      if (activePatterns.length > 0) {
        styleRulesText = activePatterns.map(p => `- ${p.pattern_text}`).join("\n");
      }

      const factCheckContext = [
        outline ? `=== OUTLINE ===\n${outline}` : "",
        contextBooks.length > 0 ? `=== REFERENCE / SERIES CONTEXT ===\n${contextBooks.join("\n\n---\n\n")}` : "",
        committedChapters ? `=== PRIOR COMMITTED CHAPTERS ===\n${committedChapters}` : "",
        documentContent && documentContent !== committedChapters
          ? `=== FULL CURRENT MANUSCRIPT ===\n${documentContent}` : "",
        ultraContextInjection ? `=== MEMORY / CANONICAL FACTS ===\n${ultraContextInjection}` : "",
      ].filter(Boolean).join("\n\n");

      const checklistPayload = stylePatterns
        .filter(p => p.confidence >= 0.40)
        .map(p => ({ q: p.checklist_question, confidence: p.confidence, locked: p.locked, category: p.category }));

      // === PHASE 2+: Polish loop. Persist working_text + round + phase
      // before every step so a sleep/refresh can pick up further along.
      const MAX_POLISH_ROUNDS = 3;
      let workingText = resumedWorking || draftText;
      let cleanRun = false;
      const startingRound = Math.max(1, Math.min(MAX_POLISH_ROUNDS, (resumeJob?.round || 0) + 1));
      if (resumedWorking) {
        toast(`Resuming polish at round ${startingRound}…`, { duration: 2000 });
      }

      for (let round = startingRound; round <= MAX_POLISH_ROUNDS; round++) {
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        setPhaseIteration(round);

        // --- Surgical enhancement edits ---
        setEnhancePhase("enhancing");
        if (jobId) await updateJob(jobId, { phase: "enhancing", round, working_text: workingText });
        toast(`Round ${round}: editing for craft…`, { duration: 2500 });
        try {
          const { text: enhancedText, appliedCount } = await applyPatchEdits({
            msgId: assistantMsg.id,
            baseText: workingText,
            goal: "enhance",
            wordCountMin,
            wordCountMax,
            checklist: checklistPayload,
            styleRules: styleRulesText || undefined,
            ultraContextInjection: ultraContextInjection || undefined,
            perspective: perspective || undefined,
            fictionType: aiSettings.fiction_type_enabled ? aiSettings.fiction_type : undefined,
            contextBundle: factCheckContext,
            signal: controller.signal,
          });
          workingText = enhancedText;
          if (jobId) await updateJob(jobId, { working_text: workingText });
          if (appliedCount > 0) toast(`Round ${round}: ${appliedCount} edit${appliedCount > 1 ? "s" : ""} applied.`, { duration: 2000 });
        } catch (err: any) {
          if (err?.name === "AbortError") throw err;
          console.warn(`[round ${round}] enhance patches failed`, err);
        }

        // --- Fact-check ---
        setEnhancePhase("fact-checking");
        if (jobId) await updateJob(jobId, { phase: "fact-checking", working_text: workingText });
        let issues: any[] = [];
        if (factCheckContext.trim()) {
          try {
            const fcResp = await fetch(FACT_CHECK_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              },
              body: JSON.stringify({ chapter: workingText, context: factCheckContext, model: hiddenPolishModel }),
              signal: controller.signal,
            });
            if (fcResp.ok) {
              const fcData = await fcResp.json();
              issues = Array.isArray(fcData.issues) ? fcData.issues : [];
            }
          } catch (err: any) {
            if (err?.name === "AbortError") throw err;
            console.warn(`[round ${round}] fact-check failed`, err);
          }
        }

        // --- Surgical fact-fix edits ---
        if (issues.length > 0) {
          setEnhancePhase("correcting");
          if (jobId) await updateJob(jobId, { phase: "correcting", working_text: workingText });
          const critical = issues.filter((i: any) => i.severity === "critical" || i.severity === "high").length;
          toast(`Round ${round}: fixing ${issues.length} detail${issues.length > 1 ? "s" : ""} (${critical} serious)…`, { duration: 2500 });
          try {
            const { text: correctedText } = await applyPatchEdits({
              msgId: assistantMsg.id,
              baseText: workingText,
              goal: "fix-issues",
              issues,
              wordCountMin,
              wordCountMax,
              checklist: checklistPayload,
              styleRules: styleRulesText || undefined,
              ultraContextInjection: ultraContextInjection || undefined,
              perspective: perspective || undefined,
              fictionType: aiSettings.fiction_type_enabled ? aiSettings.fiction_type : undefined,
              contextBundle: factCheckContext,
              signal: controller.signal,
            });
            workingText = correctedText;
            if (jobId) await updateJob(jobId, { working_text: workingText });
          } catch (err: any) {
            if (err?.name === "AbortError") throw err;
            console.warn(`[round ${round}] correction patches failed`, err);
          }
        }

        // --- Quality checklist ---
        setEnhancePhase("checking");
        if (jobId) await updateJob(jobId, { phase: "checking", working_text: workingText });
        let checklistScore = 1;
        let checklistFailures = 0;
        if (stylePatterns.length > 0) {
          try {
            const result = await onScoreFidelity(workingText, scoringModel);
            if (result) {
              checklistScore = result.fidelityScore;
              checklistFailures = result.failures.filter(f => f.severity === "high" || f.severity === "medium").length;
            }
          } catch { /* scoring failed silently */ }
        }

        const factsClean = issues.length === 0;
        const checklistClean = checklistScore >= 0.85 && checklistFailures === 0;
        console.log(`[polish round ${round}] facts=${factsClean ? "clean" : `${issues.length} issues`} checklist=${(checklistScore * 100).toFixed(0)}% (${checklistFailures} serious failures)`);

        if (factsClean && checklistClean) {
          cleanRun = true;
          toast.success(`Chapter passed all checks on round ${round}.`, { duration: 3000 });
          break;
        }

        if (round === MAX_POLISH_ROUNDS) {
          toast(`Reached max polish rounds (${MAX_POLISH_ROUNDS}). Delivering best version.`, { duration: 3500 });
          break;
        }

        setEnhancePhase("polishing");
        if (jobId) await updateJob(jobId, { phase: "polishing", working_text: workingText });
      }

      // === FINAL: Persist the polished chapter ===
      setEnhancePhase("finalizing");
      contentRef.current = workingText;
      setMessages(prev => prev.map(m => m.id === assistantMsg!.id ? { ...m, content: workingText } : m));
      await onUpdateMessage(assistantMsg.id, workingText);
      if (jobId) await updateJob(jobId, { phase: "finalizing", status: "done", working_text: workingText });

      const finalWordCount = countWords(workingText);
      toast.success(
        cleanRun
          ? `Chapter ready: ${finalWordCount.toLocaleString()} words (clean).`
          : `Chapter ready: ${finalWordCount.toLocaleString()} words.`,
        { duration: 4000 }
      );

    } catch (e: any) {
      if (e.name === "AbortError") {
        if (contentRef.current.trim()) {
          await onUpdateMessage(assistantMsg.id, contentRef.current);
          toast("Generation stopped. Partial chapter saved.");
        } else if (!continueMsg && !resumeJob) {
          await onDeleteMessage(assistantMsg.id);
        }
        if (jobIdRef.current) await updateJob(jobIdRef.current, { status: "aborted", working_text: contentRef.current });
        setEnhancePhase("idle");
        return;
      }
      if (contentRef.current.trim()) {
        await onUpdateMessage(assistantMsg.id, contentRef.current);
        toast("Connection lost. Partial chapter saved — it will resume when you return.");
        // Leave status='running' so on next mount the job is auto-resumed.
        if (jobIdRef.current) await updateJob(jobIdRef.current, { working_text: contentRef.current });
      } else {
        toast.error(e.message || "Stream failed");
        if (!continueMsg && !resumeJob) await onDeleteMessage(assistantMsg.id);
        if (jobIdRef.current) await updateJob(jobIdRef.current, { status: "failed", error: String(e?.message || e) });
      }
    } finally {
      setIsGenerating(false);
      setEnhancePhase("idle");
      setPhaseIteration(0);
      generatingMsgIdRef.current = null;
      jobIdRef.current = null;
    }
  }, [outline, contextBooks, chapterNum, validChapter, committedChapters, isGenerating, wordCountMin, wordCountMax, perspective, styleGuides, aiSettings, onAddMessage, onUpdateMessage, onDeleteMessage, setMessages, readStreamToString, documentContent, ultraContextInjection, stylePatterns, onScoreFidelity, styleMemory, streamKaggleNotebookResult, applyPatchEdits, projectId, userId, messages, pollKaggleKernel]);

  // --- Resume detection ---
  // On mount (and whenever the active project changes) look for a job that
  // was left running. If we find one, auto-resume immediately so the user
  // doesn't have to think about it — exactly the "doesn't reset its
  // progress" behavior they asked for.
  useEffect(() => {
    if (!projectId || !userId) return;
    let cancelled = false;
    (async () => {
      await reapStaleJobs(projectId);
      const job = await findResumableJob(projectId);
      if (cancelled || !job) return;
      if (isGenerating) return;
      setResumableJob(job);
      // Auto-resume after a tiny delay so the user sees the toast.
      toast("Resuming previous chapter generation…", { duration: 2500 });
      setTimeout(() => {
        if (!cancelled) {
          streamGenerate(false, undefined, undefined, job);
        }
      }, 400);
    })();
    return () => { cancelled = true; };
    // Only re-run when project or user identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, userId]);


  const handleCommit = async (msg: AiMessage) => {
    const separator = documentContent.length > 0 ? "\n\n\n\n" : "";
    await onSaveDocument(documentContent + separator + msg.content);
    await onCommitMessage(msg.id);
    toast.success("Chapter committed to document");
    const nextChapter = (msg.chapter_number || chapterNum) + 1;
    setChapterInput(String(nextChapter));
    onUpdateAiSettings({ chapter_number: nextChapter });
  };

  const handleRewrite = async (msgId: string) => {
    if (rewriteId === msgId) {
      await onDeleteMessage(msgId);
      const idx = messages.findIndex(m => m.id === msgId);
      if (idx > 0 && messages[idx - 1].role === "user") {
        await onDeleteMessage(messages[idx - 1].id);
      }
      setRewriteId(null);
      await streamGenerate(true, rewriteNotes);
      setRewriteNotes("");
    } else {
      setRewriteId(msgId);
      setRewriteNotes("");
    }
  };

  const canContinue = (msg: AiMessage) =>
    msg.role === "assistant" && !msg.committed && msg.content.trim().length > 0 && !isGenerating;

  const filteredModels = AI_MODELS.filter(m =>
    m.label.toLowerCase().includes(modelSearch.toLowerCase()) ||
    m.id.toLowerCase().includes(modelSearch.toLowerCase())
  );

  const selectedModelLabel = AI_MODELS.find(m => m.id === aiSettings.model)?.label || aiSettings.model;

  const filteredFictionTypes = FICTION_TYPES.filter(f =>
    f.toLowerCase().includes(fictionSearch.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 md:px-24 md:py-16 pb-24 space-y-6">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Drafting Engine</h2>
        <p className="text-xs text-muted-foreground">
          Generate chapters from your outline. Review, rewrite, or commit.
        </p>
      </div>

      {!outline && (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 p-6 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Upload an outline in the <span className="font-medium text-foreground">Files</span> tab to start generating chapters.
          </p>
        </div>
      )}

      {/* Chapter selector + generate */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Chapter</span>
          <input
            type="text"
            inputMode="numeric"
            value={chapterInput}
            onChange={e => {
              const v = e.target.value;
              if (v === "" || /^\d+$/.test(v)) {
                setChapterInput(v);
                const num = parseInt(v, 10);
                if (!isNaN(num) && num >= 1) onUpdateAiSettings({ chapter_number: num });
              }
            }}
            className="w-16 h-9 rounded-md border bg-background px-3 text-sm tabular-nums text-center"
          />
        </div>
        {isGenerating ? (
          <Button
            onClick={handleStop}
            variant="destructive"
            className="h-9 px-4 text-sm active:scale-95 transition-transform"
          >
            <StopCircle className="h-4 w-4 mr-2" />
            Stop
          </Button>
        ) : (
          <Button
            onClick={() => streamGenerate()}
            disabled={!outline || !validChapter}
            className="h-9 px-4 text-sm active:scale-95 transition-transform"
          >
            Generate{validChapter ? ` Chapter ${chapterNum}` : ""}
          </Button>
        )}
        <div className="ml-auto">
          <MemoryBadge
            injection={ultraContextInjection}
            totalTriples={memoryTotalCount}
            categoryCounts={memoryCategoryCounts}
          />
        </div>
      </div>

      {/* Word count range */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Word Count Range</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px] text-xs space-y-1.5 p-3">
                <p className="font-medium">Format examples:</p>
                <p><span className="font-mono bg-muted px-1 rounded">3500 – 4000</span> exactly that range</p>
                <p><span className="font-mono bg-muted px-1 rounded">3500 –</span> at least 3,500</p>
                <p><span className="font-mono bg-muted px-1 rounded">– 4000</span> at most 4,000</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Min"
            value={wordCountMin}
            onChange={e => {
              const v = e.target.value;
              if (v === "" || /^\d+$/.test(v)) setWordCountMin(v);
            }}
            className="w-20 h-9 rounded-md border bg-background px-3 text-sm tabular-nums text-center"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Max"
            value={wordCountMax}
            onChange={e => {
              const v = e.target.value;
              if (v === "" || /^\d+$/.test(v)) setWordCountMax(v);
            }}
            className="w-20 h-9 rounded-md border bg-background px-3 text-sm tabular-nums text-center"
          />
        </div>
      </div>

      {/* Perspective */}
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground font-medium">Narrative Perspective</span>
        <select
          value={perspective}
          onChange={e => {
            setPerspective(e.target.value);
            onUpdateAiSettings({ perspective: e.target.value });
          }}
          className="w-full h-9 rounded-md border bg-background px-3 text-sm"
        >
          {PERSPECTIVES.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Fiction Type */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-medium">Fiction Type</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <span className="text-[10px] text-muted-foreground">{aiSettings.fiction_type_enabled ? "On" : "Off"}</span>
            <button
              type="button"
              onClick={() => onUpdateAiSettings({ fiction_type_enabled: !aiSettings.fiction_type_enabled })}
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${aiSettings.fiction_type_enabled ? "bg-primary" : "bg-muted"}`}
            >
              <span className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg transition-transform ${aiSettings.fiction_type_enabled ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </label>
        </div>
        {aiSettings.fiction_type_enabled && (
          <div className="relative" ref={fictionDropdownRef}>
            <button
              type="button"
              onClick={() => setFictionDropdownOpen(!fictionDropdownOpen)}
              className="w-full h-9 rounded-md border bg-background px-3 text-sm text-left flex items-center justify-between"
            >
              <span className="truncate">{aiSettings.fiction_type || "Select fiction type…"}</span>
              <svg className={`h-4 w-4 text-muted-foreground transition-transform ${fictionDropdownOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            {fictionDropdownOpen && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                <div className="p-2 border-b">
                  <div className="flex items-center gap-2 px-2 py-1 rounded-md border bg-background">
                    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <input
                      type="text"
                      value={fictionSearch}
                      onChange={e => setFictionSearch(e.target.value)}
                      placeholder="Search fiction types…"
                      className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-[200px] overflow-y-auto p-1">
                  {filteredFictionTypes.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No types found</div>
                  ) : (
                    filteredFictionTypes.map(f => (
                      <button
                        key={f}
                        onClick={() => {
                          onUpdateAiSettings({ fiction_type: f });
                          setFictionDropdownOpen(false);
                          setFictionSearch("");
                        }}
                        className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent transition-colors ${
                          aiSettings.fiction_type === f ? "bg-accent font-medium" : ""
                        }`}
                      >
                        {f}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Model selector */}
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground font-medium">AI Model</span>
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            className="w-full h-9 rounded-md border bg-background px-3 text-sm text-left flex items-center justify-between"
          >
            <span className="truncate">{selectedModelLabel}</span>
            <svg className={`h-4 w-4 text-muted-foreground transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          {modelDropdownOpen && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
              <div className="p-2 border-b">
                <div className="flex items-center gap-2 px-2 py-1 rounded-md border bg-background">
                  <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <input
                    type="text"
                    value={modelSearch}
                    onChange={e => setModelSearch(e.target.value)}
                    placeholder="Search models…"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-[200px] overflow-y-auto p-1">
                {filteredModels.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No models found</div>
                ) : (
                  filteredModels.map(m => (
                    <button
                      key={m.id}
                      onClick={() => {
                        onUpdateAiSettings({ model: m.id });
                        setModelDropdownOpen(false);
                        setModelSearch("");
                      }}
                      className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent transition-colors ${
                        aiSettings.model === m.id ? "bg-accent font-medium" : ""
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate">{m.label}</span>
                        {m.contextWindow && (
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5">
                            {formatContextWindow(m.contextWindow)} ctx
                          </span>
                        )}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">{m.provider} · {m.id}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Temperature slider */}
      <div className="space-y-3">
        <span className="text-xs text-muted-foreground font-medium">Temperature</span>
        <div className="px-1">
           <Slider
            value={[aiSettings.temperature]}
            onValueChange={([v]) => onUpdateAiSettings({ temperature: Math.round(v * 100) / 100 })}
            min={0}
            max={1}
            step={0.01}
            className="w-full"
          />
        </div>
        <div className="text-center text-sm font-mono tabular-nums text-foreground">
          {aiSettings.temperature.toFixed(2)}
        </div>
      </div>

      {/* Top P slider */}
      <div className="space-y-3">
        <span className="text-xs text-muted-foreground font-medium">Top P</span>
        <div className="px-1">
          <Slider
            value={[aiSettings.top_p]}
            onValueChange={([v]) => onUpdateAiSettings({ top_p: Math.round(v * 100) / 100 })}
            min={0}
            max={1}
            step={0.01}
            className="w-full"
          />
        </div>
        <div className="text-center text-sm font-mono tabular-nums text-foreground">
          {aiSettings.top_p.toFixed(2)}
        </div>
      </div>

      {/* Fidelity score display */}
      {(scoring || lastFidelity) && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2">
            {scoring ? (
              <>
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
                <span className="text-sm text-muted-foreground">Scoring chapter fidelity…</span>
              </>
            ) : lastFidelity ? (
              <>
                <div className={`text-lg font-mono font-bold ${
                  lastFidelity.fidelityScore >= 0.8 ? "text-green-400" :
                  lastFidelity.fidelityScore >= 0.6 ? "text-yellow-400" : "text-destructive"
                }`}>
                  {(lastFidelity.fidelityScore * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-muted-foreground">
                  {lastFidelity.passed}/{lastFidelity.total} checks passed
                </div>
                {lastFidelity.newPatterns.length > 0 && (
                  <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full ml-auto">
                    +{lastFidelity.newPatterns.length} new patterns
                  </span>
                )}
              </>
            ) : null}
          </div>
          {lastFidelity && lastFidelity.failures.length > 0 && (
            <details className="group">
              <summary className="text-[10px] text-muted-foreground cursor-pointer">
                {lastFidelity.failures.length} failed checks
              </summary>
              <div className="mt-2 space-y-1">
                {lastFidelity.failures.map((f, i) => (
                  <div key={i} className="text-[10px] p-1.5 rounded border border-border/50 bg-card/50">
                    <span className={`font-medium ${f.severity === "high" ? "text-destructive" : f.severity === "medium" ? "text-yellow-400" : "text-muted-foreground"}`}>
                      [{f.severity}]
                    </span>{" "}
                    <span className="text-foreground">{f.question}</span>
                    <div className="text-muted-foreground/60 mt-0.5 italic">{f.evidence}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
          {lastFidelity?.notes && (
            <p className="text-[10px] text-muted-foreground/70 italic">{lastFidelity.notes}</p>
          )}
        </div>
      )}

      <div className="space-y-6">
        {messages.filter(m => m.role === "assistant").map((msg, i) => (
          <div key={msg.id} className="animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
            <div className="space-y-3">
              <div className="prose prose-sm max-w-none font-manuscript text-foreground leading-relaxed">
                {msg.content ? (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                ) : (isGenerating && generatingMsgIdRef.current === msg.id ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">
                      {enhancePhase === "drafting" ? "Generating draft…" :
                       enhancePhase === "enhancing" ? `Enhancing prose${phaseIteration ? ` (round ${phaseIteration}/3)` : ""} — adding depth, dialogue, emotion…` :
                       enhancePhase === "fact-checking" ? `Fact-checking against established context${phaseIteration ? ` (round ${phaseIteration}/3)` : ""}…` :
                       enhancePhase === "correcting" ? `Correcting detail errors${phaseIteration ? ` (round ${phaseIteration}/3)` : ""}…` :
                       enhancePhase === "checking" ? `Running quality checklist${phaseIteration ? ` (round ${phaseIteration}/3)` : ""}…` :
                       enhancePhase === "polishing" ? `Re-polishing — issues remain, running another round…` :
                       enhancePhase === "finalizing" ? "Finalizing chapter…" :
                       "Planning chapter…"}
                    </span>
                  </div>
                ) : "")}
              </div>
              {msg.content && !(isGenerating && generatingMsgIdRef.current === msg.id) && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => handleRewrite(msg.id)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-muted"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Rewrite
                  </button>
                  {!msg.committed && (
                    <button
                      onClick={() => handleCommit(msg)}
                      className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors px-3 py-1.5 rounded-md hover:bg-primary/5"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Commit
                    </button>
                  )}
                  <button
                    onClick={() => handleCopy(msg.content)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-muted"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                  <button
                    onClick={async () => {
                      const idx = messages.findIndex(m => m.id === msg.id);
                      if (idx > 0 && messages[idx - 1].role === "user") {
                        await onDeleteMessage(messages[idx - 1].id);
                      }
                      await onDeleteMessage(msg.id);
                      toast.success("Chapter deleted");
                    }}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded-md hover:bg-muted"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                  {canContinue(msg) && (
                    <button
                      onClick={() => streamGenerate(false, undefined, msg)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-muted"
                    >
                      <PlayCircle className="h-3.5 w-3.5" />
                      Continue
                    </button>
                  )}
                  {msg.committed && (
                    <span className="text-[10px] text-primary font-medium ml-1">✓ Committed</span>
                  )}
                </div>
              )}
              {rewriteId === msg.id && (
                <div className="space-y-2 p-3 rounded-md bg-muted">
                  <Textarea
                    value={rewriteNotes}
                    onChange={e => setRewriteNotes(e.target.value)}
                    placeholder="Additional notes for the rewrite (optional)…"
                    className="min-h-[60px] text-sm bg-background"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setRewriteId(null)} className="text-xs">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => handleRewrite(msg.id)} className="text-xs active:scale-95 transition-transform">
                      Rewrite Now
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default AiTab;
