import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, X, FileText, Loader2, Sparkles, BookOpen, CheckCircle2, Shield, ShieldAlert, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { UploadedFile } from "@/hooks/useProject";
import type { StylePattern, StyleMemory } from "@/hooks/useStyleMemory";
import type { AiSettings } from "@/hooks/useAiSettings";
import { buildFullSystemPrompt } from "@/lib/systemPromptTemplate";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

interface StyleTabProps {
  files: UploadedFile[];
  onUpload: (name: string, content: string, type: "context" | "outline" | "style" | "draft") => Promise<UploadedFile | null>;
  onDelete: (id: string) => void;
  styleMemory: StyleMemory | null;
  stylePatterns: StylePattern[];
  onSaveSynthesis: (synthesis: any, sourceFileId?: string) => Promise<void>;
  onUpdateCustomPrompt: (text: string | null) => Promise<void>;
  aiSettings: AiSettings;
}


const ANALYZE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-style`;
const ACCEPTED_TYPES = ".pdf,.json,.jsonl,.csv,.txt,.md,.docx,.zip,.epub,.mobi";

// --- File extraction helpers ---
async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const textParts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    textParts.push(content.items.map((item: any) => item.str).join(" "));
  }
  return textParts.join("\n\n");
}

async function extractFileText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return extractPdfText(file);
  if (ext === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value || "";
  }
  if (ext === "epub" || ext === "mobi" || ext === "zip") {
    // Best-effort text extraction from binary/container formats: read as text,
    // strip non-printable bytes and any HTML/XML tags, and collapse whitespace.
    // Good enough to feed style analysis; for perfect fidelity users can
    // pre-convert to .txt or .docx.
    const raw = await file.text();
    return raw
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/[^\x20-\x7E\n\r\t]/g, " ")
      .replace(/\s{3,}/g, "\n\n")
      .trim();
  }
  return file.text();
}

// Simple content hash for deduplication
async function hashContent(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

interface PendingFile {
  id: string;         // local UI id
  jobId?: string;     // DB style_analysis_jobs.id once created
  name: string;
  status: "extracting" | "analyzing" | "synthesizing" | "done" | "error" | "duplicate";
  error?: string;
  chunksTotal?: number;
  chunksCompleted?: number;
  hash?: string;      // set once extraction+hash is done
  fullText?: string;  // kept in memory for legacy file save on completion
}

const CONFIDENCE_LABELS: Record<string, { label: string; color: string }> = {
  locked: { label: "Locked", color: "text-primary" },
  hard: { label: "Hard Rule", color: "text-green-400" },
  soft: { label: "Soft", color: "text-yellow-400" },
  dormant: { label: "Dormant", color: "text-muted-foreground/50" },
};

function getConfidenceLevel(p: StylePattern) {
  if (p.locked || p.confidence >= 0.95) return "locked";
  if (p.confidence >= 0.75) return "hard";
  if (p.confidence >= 0.40) return "soft";
  return "dormant";
}

const StyleTab = ({ files, onUpload, onDelete, styleMemory, stylePatterns, onSaveSynthesis, onUpdateCustomPrompt, aiSettings }: StyleTabProps) => {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [showPatterns, setShowPatterns] = useState(true);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const finalizedJobsRef = useRef<Set<string>>(new Set());

  const styleFiles = files.filter(f => f.file_type === "style");
  const isProcessing = pendingFiles.some(f => ["extracting", "analyzing", "synthesizing"].includes(f.status));

  // Full default prompt = every static instruction the model receives,
  // seeded with the learned patterns/style_cache. The user can edit this
  // freely — whatever they save is used verbatim.
  const buildDefaultPrompt = useCallback(() => {
    return buildFullSystemPrompt({
      fictionType: aiSettings.fiction_type_enabled ? aiSettings.fiction_type : "",
      perspective: aiSettings.perspective || "",
      wordCountMin: aiSettings.word_count_min,
      wordCountMax: aiSettings.word_count_max,
      styleCache: styleMemory?.style_cache || "",
      patterns: stylePatterns.map(p => ({
        pattern_text: p.pattern_text,
        checklist_question: p.checklist_question,
        confidence: p.confidence,
      })),
      genreConventions: styleMemory?.genre_conventions ?? [],
      detectedGenre: styleMemory?.detected_genre ?? "",
    });
  }, [styleMemory, stylePatterns, aiSettings]);

  const openPromptEditor = () => {
    const initial = (styleMemory?.custom_prompt || "").trim() || buildDefaultPrompt();
    setPromptDraft(initial);
    setPromptEditorOpen(true);
  };

  const savePrompt = async () => {
    setSavingPrompt(true);
    try {
      await onUpdateCustomPrompt(promptDraft.trim() || null);
      toast.success(promptDraft.trim() ? "Custom style prompt saved" : "Reverted to auto style prompt");
      setPromptEditorOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save prompt");
    } finally {
      setSavingPrompt(false);
    }
  };

  const resetPrompt = () => setPromptDraft(buildDefaultPrompt());



  // Resume any in-flight analysis jobs from the DB when the tab (re)mounts.
  // This is what makes analysis truly background: even after leaving the app
  // or switching tabs, coming back reattaches the pending UI to the job.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("style_analysis_jobs")
        .select("id, file_name, status, chunks_total, chunks_completed")
        .eq("user_id", user.id)
        .eq("status", "running")
        .order("updated_at", { ascending: false });
      if (cancelled || !data?.length) return;
      setPendingFiles(prev => {
        const existingJobIds = new Set(prev.map(p => p.jobId).filter(Boolean));
        const additions = data
          .filter(j => !existingJobIds.has(j.id))
          .map(j => ({
            id: crypto.randomUUID(),
            jobId: j.id,
            name: j.file_name,
            status: "analyzing" as const,
            chunksTotal: j.chunks_total ?? undefined,
            chunksCompleted: j.chunks_completed ?? undefined,
          }));
        return [...prev, ...additions];
      });
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Poll running jobs. Each active DB job is checked every 3s until done/failed.
  useEffect(() => {
    const active = pendingFiles.filter(p => p.jobId && (p.status === "analyzing" || p.status === "synthesizing"));
    if (active.length === 0) return;
    const interval = setInterval(async () => {
      for (const pf of active) {
        if (!pf.jobId) continue;
        const { data: job } = await supabase
          .from("style_analysis_jobs")
          .select("id, status, chunks_total, chunks_completed, synthesis, contradictions, error")
          .eq("id", pf.jobId)
          .maybeSingle();
        if (!job) continue;

        // Progress update
        setPendingFiles(prev => prev.map(p => p.id === pf.id
          ? { ...p, chunksTotal: job.chunks_total ?? p.chunksTotal, chunksCompleted: job.chunks_completed ?? p.chunksCompleted, status: job.status === "running" && (job.chunks_completed ?? 0) > 0 ? "synthesizing" : p.status }
          : p));

        if (job.status === "done" && !finalizedJobsRef.current.has(job.id)) {
          finalizedJobsRef.current.add(job.id);
          const synthesis: any = job.synthesis;
          if (synthesis) {
            const legacyHash = pf.hash ? `[HASH:${pf.hash}]\n\n` : "";
            const legacyContent = `${legacyHash}${synthesis.style_cache || ""}`;
            try {
              await onUpload(pf.name, legacyContent, "style");
              await onSaveSynthesis(synthesis);
              const patternCount = synthesis.patterns?.length || 0;
              const chunksDone = job.chunks_completed || 0;
              toast.success(`${pf.name}: ${patternCount} patterns extracted across ${chunksDone} chunks!`);
              // If the analyzer produced a merged custom prompt (added new
              // instructions to the user's existing prompt), persist it.
              const updatedPrompt = typeof synthesis.updated_custom_prompt === "string"
                ? synthesis.updated_custom_prompt.trim()
                : "";
              if (updatedPrompt) {
                try {
                  await onUpdateCustomPrompt(updatedPrompt);
                  const added = Number(synthesis.custom_prompt_additions ?? 0);
                  toast.success(added > 0
                    ? `Style prompt updated with ${added} new instruction${added === 1 ? "" : "s"}.`
                    : "Style prompt reviewed — no new rules to add.");
                } catch (e: any) {
                  console.warn("Failed to save updated custom prompt:", e);
                }
              }
              const contradictions: any = job.contradictions;
              if (Array.isArray(contradictions) && contradictions.length > 0) {
                toast.warning(`${contradictions.length} contradictions detected and resolved.`);
              }
            } catch (e: any) {
              toast.error(`${pf.name}: save failed — ${e.message}`);
            }
          }
          setPendingFiles(prev => prev.map(p => p.id === pf.id ? { ...p, status: "done" } : p));
          setTimeout(() => setPendingFiles(prev => prev.filter(p => p.id !== pf.id)), 4000);
        } else if (job.status === "failed") {

          setPendingFiles(prev => prev.map(p => p.id === pf.id ? { ...p, status: "error", error: job.error || "Analysis failed" } : p));
          toast.error(`${pf.name}: ${job.error || "Analysis failed"}`);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [pendingFiles, onUpload, onSaveSynthesis]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const validExts = ["pdf", "json", "jsonl", "csv", "txt", "md", "docx", "zip", "epub", "mobi"];
      if (!validExts.includes(ext)) {
        toast.error(`${file.name}: Unsupported file type.`);
        continue;
      }

      const pendingId = crypto.randomUUID();
      setPendingFiles(prev => [...prev, { id: pendingId, name: file.name, status: "extracting" }]);
      processFile(file, pendingId);
    }
    e.target.value = "";
  };

  const processFile = async (file: File, pendingId: string) => {
    try {
      // 1. Extract text
      const fullText = await extractFileText(file);
      if (!fullText || fullText.trim().length < 100) {
        setPendingFiles(prev => prev.map(f => f.id === pendingId ? { ...f, status: "error", error: "Not enough text" } : f));
        toast.error(`${file.name}: Not enough text to analyze.`);
        return;
      }

      // 2. Check for duplicate content
      const hash = await hashContent(fullText);
      const existingStyle = styleFiles.find(sf => sf.content.includes(hash));
      if (existingStyle) {
        setPendingFiles(prev => prev.map(f => f.id === pendingId ? { ...f, status: "duplicate" } : f));
        toast.info(`${file.name}: Already analyzed. Skipping.`);
        setTimeout(() => setPendingFiles(prev => prev.filter(f => f.id !== pendingId)), 3000);
        return;
      }

      // 3. Submit to background analysis job. The edge function returns
      // immediately with a jobId; the polling effect above watches it.
      setPendingFiles(prev => prev.map(f => f.id === pendingId ? { ...f, status: "analyzing", hash } : f));

      const bookTitle = file.name.replace(/\.[^.]+$/, "");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(ANALYZE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          excerpts: fullText,
          bookTitle,
          mode: "structured",
          contentHash: hash,
          // Send the user's currently active style prompt (custom or default).
          // The analyzer will inspect it, extract patterns from the new file,
          // and only ADD instructions for patterns not already covered.
          currentCustomPrompt: (styleMemory?.custom_prompt || "").trim() || buildDefaultPrompt(),
        }),

      });

      if (!resp.ok && resp.status !== 202) {
        const err = await resp.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error || "Style analysis failed");
      }

      const data = await resp.json();
      if (!data.jobId) throw new Error("No jobId returned");

      setPendingFiles(prev => prev.map(f => f.id === pendingId ? { ...f, jobId: data.jobId, hash } : f));
    } catch (err: any) {
      setPendingFiles(prev => prev.map(f => f.id === pendingId ? { ...f, status: "error", error: err.message } : f));
      toast.error(`${file.name}: ${err.message || "Failed to process"}`);
    }
  };


  const activePatterns = stylePatterns.filter(p => p.confidence >= 0.40);
  const dormantPatterns = stylePatterns.filter(p => p.confidence < 0.40);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 md:px-24 md:py-16 pb-24 space-y-8">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Writing Style Training</h2>
        <p className="text-xs text-muted-foreground">
          Upload books or text files. The AI chunks text, extracts patterns with confidence scores, and builds a structured memory.
        </p>
      </div>

      {/* Upload area */}
      <div
        onClick={() => !isProcessing && fileRef.current?.click()}
        className={`border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center gap-3 transition-colors ${
          isProcessing ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-muted-foreground/40"
        }`}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Upload files to analyze writing style</span>
        <span className="text-[10px] text-muted-foreground/60">PDF, TXT, MD, DOCX, EPUB, MOBI, JSON, JSONL, CSV, ZIP — duplicate detection enabled</span>
        <input ref={fileRef} type="file" accept={ACCEPTED_TYPES} multiple className="hidden" onChange={handleUpload} />
      </div>

      {/* Pending uploads */}
      {pendingFiles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Processing</h3>
          {pendingFiles.map(pf => (
            <div key={pf.id} className="flex items-center gap-2 p-3 rounded-md border border-border bg-card">
              {pf.status === "extracting" && <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />}
              {pf.status === "analyzing" && <Sparkles className="h-4 w-4 text-primary animate-pulse shrink-0" />}
              {pf.status === "synthesizing" && <Sparkles className="h-4 w-4 text-primary animate-pulse shrink-0" />}
              {pf.status === "done" && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
              {pf.status === "error" && <X className="h-4 w-4 text-destructive shrink-0" />}
              {pf.status === "duplicate" && <Shield className="h-4 w-4 text-muted-foreground shrink-0" />}
              <span className="text-sm flex-1 truncate">{pf.name}</span>
              <span className="text-[10px] text-muted-foreground">
                {pf.status === "extracting" && "Extracting text…"}
                {pf.status === "analyzing" && `Analyzing chunks…`}
                {pf.status === "synthesizing" && `Synthesizing ${pf.chunksCompleted}/${pf.chunksTotal} chunks…`}
                {pf.status === "done" && "Complete"}
                {pf.status === "error" && (pf.error || "Failed")}
                {pf.status === "duplicate" && "Already analyzed"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Memory summary */}
      {styleMemory && (
        <button
          type="button"
          onClick={openPromptEditor}
          className="w-full text-left rounded-lg border border-border bg-card p-4 space-y-3 hover:border-primary/50 transition-colors"
          title="Click to view and edit the full style prompt sent to every model"
        >
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-foreground">Style Memory</span>
            {styleMemory.custom_prompt && (
              <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded-full">Custom</span>
            )}
            {styleMemory.detected_genre && (
              <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full ml-auto">
                {styleMemory.detected_genre}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{styleMemory.custom_prompt || styleMemory.style_cache}</p>
          <div className="flex gap-4 text-[10px] text-muted-foreground">
            <span>{activePatterns.length} active patterns</span>
            <span>{dormantPatterns.length} dormant</span>
            <span>{stylePatterns.filter(p => p.locked).length} locked</span>
            <span className="ml-auto text-primary">Tap to edit prompt →</span>
          </div>
        </button>
      )}

      {promptEditorOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => !savingPrompt && setPromptEditorOpen(false)}>
          <div className="w-full max-w-2xl bg-card border border-border rounded-lg p-5 space-y-3 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-medium">Edit Style Prompt</h3>
              <button onClick={() => setPromptEditorOpen(false)} className="ml-auto text-muted-foreground hover:text-foreground text-xs">Close</button>
            </div>
            <p className="text-[11px] text-muted-foreground">This exact text is injected into every chapter generation (Kaggle and cloud models). Plain paragraph — no markdown needed.</p>
            <textarea
              value={promptDraft}
              onChange={e => setPromptDraft(e.target.value)}
              className="flex-1 w-full min-h-[300px] rounded-md border border-border bg-background p-3 text-sm font-serif leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Describe the exact writing style, voice, and rules the AI must follow…"
            />
            <div className="flex items-center gap-2 justify-end">
              <button onClick={resetPrompt} disabled={savingPrompt} className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent disabled:opacity-50">Reset from patterns</button>
              <button onClick={() => { setPromptDraft(""); }} disabled={savingPrompt} className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-accent disabled:opacity-50">Clear</button>
              <button onClick={savePrompt} disabled={savingPrompt} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {savingPrompt ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Pattern list */}
      {stylePatterns.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowPatterns(!showPatterns)}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
          >
            {showPatterns ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            Patterns ({stylePatterns.length})
          </button>

          {showPatterns && (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {activePatterns.map(p => {
                const level = getConfidenceLevel(p);
                const meta = CONFIDENCE_LABELS[level];
                return (
                  <div key={p.id} className="flex items-start gap-2 p-2 rounded border border-border bg-card/50 text-xs">
                    <span className={`shrink-0 font-mono text-[10px] ${meta.color}`}>
                      {(p.confidence * 100).toFixed(0)}%
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground truncate">{p.pattern_text}</div>
                      <div className="text-muted-foreground/60 truncate">✓ {p.checklist_question}</div>
                    </div>
                    <span className={`text-[10px] ${meta.color} shrink-0`}>{meta.label}</span>
                  </div>
                );
              })}
              {dormantPatterns.length > 0 && (
                <details className="group">
                  <summary className="text-[10px] text-muted-foreground/50 cursor-pointer">
                    {dormantPatterns.length} dormant patterns (below 40% confidence)
                  </summary>
                  {dormantPatterns.map(p => (
                    <div key={p.id} className="flex items-start gap-2 p-2 rounded border border-border/50 bg-card/30 text-xs opacity-50 mt-1">
                      <span className="shrink-0 font-mono text-[10px]">{(p.confidence * 100).toFixed(0)}%</span>
                      <div className="flex-1 min-w-0 truncate">{p.pattern_text}</div>
                    </div>
                  ))}
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legacy analyzed styles */}
      {styleFiles.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Source Files ({styleFiles.length})
          </h3>
          {styleFiles.map(f => (
            <div key={f.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm font-medium text-foreground flex-1 truncate">{f.file_name}</span>
                <button onClick={() => onDelete(f.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {styleFiles.length === 0 && stylePatterns.length === 0 && pendingFiles.length === 0 && (
        <div className="rounded-lg border border-dashed border-muted-foreground/20 p-6 text-center space-y-2">
          <Sparkles className="h-5 w-5 text-muted-foreground mx-auto" />
          <p className="text-xs text-muted-foreground">
            No style references yet. Upload books to train the AI on writing style.
          </p>
          <p className="text-[10px] text-muted-foreground/60">
            Text is chunked into 1500-word segments. Each chunk is analyzed for patterns with confidence scores and yes/no checklist questions. Patterns above 75% become hard rules; above 95% get locked permanently.
          </p>
        </div>
      )}
    </div>
  );
};

export default StyleTab;
