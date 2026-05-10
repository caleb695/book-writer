import { useRef, useState } from "react";
import { Upload, X, FileText, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import mammoth from "mammoth";
import type { UploadedFile } from "@/hooks/useProject";

interface FilesTabProps {
  files: UploadedFile[];
  onUpload: (name: string, content: string, type: "context" | "outline" | "style") => Promise<UploadedFile | null>;
  onDelete: (id: string) => void;
}

const ACCEPTED_EXTENSIONS = ".txt,.md,.docx";

const readFileContent = async (file: File): Promise<string> => {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    if (!result.value || result.value.trim().length === 0) {
      throw new Error("The .docx file appears to be empty or unreadable.");
    }
    return result.value;
  }

  // .txt, .md — read as plain text
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      if (!text || text.trim().length === 0) {
        reject(new Error("The file appears to be empty."));
        return;
      }
      resolve(text);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
};

const FilesTab = ({ files, onUpload, onDelete }: FilesTabProps) => {
  const contextRef = useRef<HTMLInputElement>(null);
  const outlineRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const contextFiles = files.filter(f => f.file_type === "context");
  const outlineFiles = files.filter(f => f.file_type === "outline");

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: "context" | "outline") => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["txt", "md", "docx"].includes(ext || "")) {
      toast.error("Unsupported file type. Use .txt, .md, or .docx");
      e.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large. Maximum size is 10 MB.");
      e.target.value = "";
      return;
    }

    setUploading(true);
    try {
      const content = await readFileContent(file);
      await onUpload(file.name, content, type);
    } catch (err: any) {
      toast.error(err.message || "Failed to read file");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 md:px-24 md:py-16 pb-24 space-y-8">
      {uploading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Processing file…
        </div>
      )}

      {/* Context Zone */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">Series Context</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
            Optional
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Upload previous books (.txt, .md, or .docx) to give the AI continuity with your series.
        </p>
        <div
          onClick={() => !uploading && contextRef.current?.click()}
          className={`border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center gap-3 transition-colors ${
            uploading ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-muted-foreground/40"
          }`}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Drop files or click to upload</span>
          <input ref={contextRef} type="file" accept={ACCEPTED_EXTENSIONS} className="hidden" onChange={e => handleUpload(e, "context")} />
        </div>
        {contextFiles.map(f => (
          <div key={f.id} className="flex items-center gap-2 p-3 rounded-md bg-muted">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-foreground flex-1 truncate">{f.file_name}</span>
            <button onClick={() => onDelete(f.id)} className="text-muted-foreground hover:text-destructive transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </section>

      {/* Outline Zone */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">Chapter Outline</h2>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            Required
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Upload your outline (.txt, .md, or .docx) with chapter-by-chapter details. The AI follows this exactly.
        </p>
        <div
          onClick={() => !uploading && outlineRef.current?.click()}
          className={`border-2 border-primary/30 rounded-lg p-8 flex flex-col items-center justify-center gap-3 transition-colors ${
            uploading ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-primary/50"
          }`}
        >
          <Upload className="h-6 w-6 text-primary" />
          <span className="text-xs text-muted-foreground">Upload outline document</span>
          <input ref={outlineRef} type="file" accept={ACCEPTED_EXTENSIONS} className="hidden" onChange={e => handleUpload(e, "outline")} />
        </div>
        {outlineFiles.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>An outline is required before the AI can generate chapters.</span>
          </div>
        )}
        {outlineFiles.map(f => (
          <div key={f.id} className="flex items-center gap-2 p-3 rounded-md bg-primary/5 border border-primary/10">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm text-foreground flex-1 truncate">{f.file_name}</span>
            <button onClick={() => onDelete(f.id)} className="text-muted-foreground hover:text-destructive transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
};

export default FilesTab;
