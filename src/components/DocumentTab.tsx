import { useState, useRef, useEffect, useMemo } from "react";
import { Download, LogOut, Search, X, Replace, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface DocumentTabProps {
  content: string;
  onSave: (content: string) => Promise<void>;
  onSignOut: () => void;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(w => w.length > 0).length;
}

const DocumentTab = ({ content, onSave, onSignOut }: DocumentTabProps) => {
  const [text, setText] = useState(content);
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => {
    setText(content);
  }, [content]);

  const wordCount = useMemo(() => countWords(text), [text]);

  const handleChange = (val: string) => {
    setText(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSave(val);
    }, 1000);
  };

  const handleExport = () => {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "manuscript.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Manuscript downloaded");
  };

  const scrollToBottom = () => {
    if (textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
      // Also place cursor at end
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
      textareaRef.current.focus();
    }
  };

  const matchCount = useMemo(() => {
    if (!searchTerm) return 0;
    try {
      const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      return (text.match(regex) || []).length;
    } catch {
      return 0;
    }
  }, [text, searchTerm]);

  const handleReplaceOne = () => {
    if (!searchTerm) return;
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    const newText = text.replace(regex, replaceTerm);
    if (newText !== text) {
      handleChange(newText);
      toast.success("Replaced 1 occurrence");
    }
  };

  const handleReplaceAll = () => {
    if (!searchTerm) return;
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    const newText = text.replace(regex, replaceTerm);
    const count = matchCount;
    if (count > 0) {
      handleChange(newText);
      toast.success(`Replaced ${count} occurrence${count > 1 ? "s" : ""}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden pb-16">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b md:px-24">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-foreground">Manuscript</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {wordCount.toLocaleString()} words
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={scrollToBottom}
            className="text-xs"
            title="Scroll to bottom"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSearch(prev => !prev)}
            className="text-xs"
          >
            <Search className="h-3.5 w-3.5 mr-1.5" />
            Find
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="text-xs active:scale-95 transition-transform"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSignOut}
            className="text-xs text-muted-foreground"
          >
            <LogOut className="h-3.5 w-3.5 mr-1.5" />
            Sign Out
          </Button>
        </div>
      </div>

      {/* Search & Replace */}
      {showSearch && (
        <div className="px-6 md:px-24 py-3 border-b bg-muted/30 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Find…"
                className="w-full h-8 rounded-md border bg-background px-3 pr-16 text-sm"
                autoFocus
              />
              {searchTerm && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums">
                  {matchCount} found
                </span>
              )}
            </div>
            <button onClick={() => { setShowSearch(false); setSearchTerm(""); setReplaceTerm(""); }} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={replaceTerm}
              onChange={e => setReplaceTerm(e.target.value)}
              placeholder="Replace with…"
              className="flex-1 h-8 rounded-md border bg-background px-3 text-sm"
            />
            <Button size="sm" variant="outline" onClick={handleReplaceOne} disabled={!searchTerm || matchCount === 0} className="text-xs h-8">
              Replace
            </Button>
            <Button size="sm" variant="outline" onClick={handleReplaceAll} disabled={!searchTerm || matchCount === 0} className="text-xs h-8">
              All
            </Button>
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => handleChange(e.target.value)}
          placeholder="Your manuscript will appear here as you commit chapters…"
          className="w-full h-full min-h-[calc(100vh-10rem)] resize-none border-0 outline-none bg-transparent font-manuscript text-lg leading-relaxed px-8 py-12 md:px-24 md:py-16 text-foreground placeholder:text-muted-foreground/50"
        />
      </div>
    </div>
  );
};

export default DocumentTab;
