import { useRef, useState } from "react";
import { Upload, X, FileText, Loader2, Sparkles, BookOpen, CheckCircle2, Shield, ShieldAlert, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";
import type { UploadedFile } from "@/hooks/useProject";
import type { StylePattern, StyleMemory } from "@/hooks/useStyleMemory";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

interface StyleTabProps {
  files: UploadedFile[];
  onUpload: (name: string, content: string, type: "context" | "outline" | "style" | "draft") => Promise<UploadedFile | null>;
  onDelete: (id: string) => void;
  styleMemory: StyleMemory | null;
  stylePatterns: StylePattern[];
  onSaveSynthesis: (synthesis: any, sourceFileId?: string) => Promise<void>;
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
  id: string;
  name: string;
  status: "extracting" | "analyzing" | "synthesizing" | "done" | "error" | "duplicate";
  error?: string;
  chunksTotal?: number;
  chunksCompleted?: number;
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

const StyleTab = ({ files, onUpload, onDelete, styleMemory, stylePatterns, onSaveSynthesis }: StyleTabProps) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [showPatterns, setShowPatterns] = useState(true);

  const styleFiles = files.filter(f => f.file_type === "style");
  const isProcessing = pendingFiles.some(f => ["extracting", "analyzing", "synthesizing"].includes(f.status));

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

      // 3. Call structured analysis
      setPendingFiles(prev => prev.map(f => f.id === pendingId ? { ...f, status: "analyzing" } : f));

      const bookTitle = file.name.replace(/\.[^.]+$/, "");
      const resp = await fetch(ANALYZE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ excerpts: fullText, bookTitle, mode: "structured" }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(err.error || "Style analysis failed");
      }

      const data = await resp.json();

      if (!data.synthesis) {
        throw new Error("No structured analysis returned");
      }

      setPendingFiles(prev => prev.map(f => f.id === pendingId ? { ...f, status: "synthesizing", chunksTotal: data.totalChunks, chunksCompleted: data.chunksAnalyzed } : f));

      // 4. Save legacy style file for backward compat
      const legacyContent = `[HASH:${hash}]\n\n${data.analysis || data.synthesis.style_cache || ""}`;
      await onUpload(file.name, legacyContent, "style");

      // 5. Save structured memory to DB
      await onSaveSynthesis(data.synthesis);

      setPendingFiles(prev => prev.map(f => f.id === pendingId ? { ...f, status: "done" } : f));
      
      const patternCount = data.synthesis.patterns?.length || 0;
      toast.success(`${file.name}: ${patternCount} patterns extracted across ${data.chunksAnalyzed} chunks!`);

      if (data.contradictions?.length > 0) {
        toast.warning(`${data.contradictions.length} contradictions detected and resolved.`);
      }

      setTimeout(() => setPendingFiles(prev => prev.filter(f => f.id !== pendingId)), 4000);
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
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-foreground">Style Memory</span>
            {styleMemory.detected_genre && (
              <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full ml-auto">
                {styleMemory.detected_genre}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{styleMemory.style_cache}</p>
          <div className="flex gap-4 text-[10px] text-muted-foreground">
            <span>{activePatterns.length} active patterns</span>
            <span>{dormantPatterns.length} dormant</span>
            <span>{stylePatterns.filter(p => p.locked).length} locked</span>
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
