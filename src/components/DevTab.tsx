import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Send, Loader2, StopCircle, Trash2, Lightbulb, Users, Map, BookOpen, Check, Copy, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import type { UploadedFile } from "@/hooks/useProject";
import MemoryBadge from "@/components/MemoryBadge";
import { AI_MODELS, formatContextWindow } from "@/hooks/useAiSettings";

interface DevTabProps {
  files: UploadedFile[];
  documentContent?: string;
  ultraContextInjection?: string;
  fictionType?: string;
  perspective?: string;
  brainstormModel?: string;
  onChangeBrainstormModel?: (id: string) => void;
  memoryTotalCount?: number;
  memoryCategoryCounts?: Record<string, number>;
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  committed?: boolean;
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-chat`;

const quickPrompts = [
  { icon: BookOpen, label: "Improve outline", prompt: "Review my current outline and suggest specific improvements for pacing, structure, and chapter flow." },
  { icon: Users, label: "Develop characters", prompt: "Help me develop the main characters. For each, suggest detailed personality traits, physical appearance, backstory, motivations, and character arcs." },
  { icon: Map, label: "Plot & conflict", prompt: "Analyze my story's plot structure. Suggest ways to strengthen the central conflict, add tension, and improve the story arc." },
  { icon: Lightbulb, label: "Brainstorm", prompt: "Let's brainstorm. Suggest creative ideas for subplots, twists, thematic elements, world-building details, or anything that could enrich my story." },
];

// Brainstorm/dev-chat runs on cloud providers only — Kaggle models are
// reserved for chapter generation. Exclude them from the picker.
const BRAINSTORM_MODELS = AI_MODELS.filter(m => m.provider !== "kaggle");

const DevTab = ({ files, documentContent = "", ultraContextInjection = "", fictionType = "", perspective = "", brainstormModel = "mistral-large-latest", onChangeBrainstormModel, memoryTotalCount = 0, memoryCategoryCounts }: DevTabProps) => {
  const [modelSearch, setModelSearch] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const modelRef = useRef<HTMLDivElement>(null);
  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return BRAINSTORM_MODELS;
    return BRAINSTORM_MODELS.filter(m => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  }, [modelSearch]);
  const currentModel = BRAINSTORM_MODELS.find(m => m.id === brainstormModel) || BRAINSTORM_MODELS[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef("");

  const outline = files.find(f => f.file_type === "outline")?.content || "";
  const contextBooks = files.filter(f => f.file_type === "context").map(f => f.content);
  const styleGuides = files.filter(f => f.file_type === "style").map(f => f.content);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const clearChat = useCallback(() => {
    if (isStreaming) return;
    setMessages([]);
  }, [isStreaming]);

  const commitMessage = useCallback((id: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, committed: true } : m));
    toast.success("Response committed — AI will remember this.");
  }, []);

  const deleteMessage = useCallback((id: string) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      // Also remove the user message right before it
      const newMsgs = [...prev];
      newMsgs.splice(idx, 1);
      if (idx > 0 && newMsgs[idx - 1]?.role === "user") {
        newMsgs.splice(idx - 1, 1);
      }
      return newMsgs;
    });
    toast.success("Response deleted — AI no longer has access.");
  }, []);

  const copyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("Copied to clipboard");
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text.trim() };
    const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: "" };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsStreaming(true);
    contentRef.current = "";

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Only include committed messages + the new user message in API history
    const committedHistory = messages
      .filter(m => m.committed || m.role === "user")
      .map(m => ({ role: m.role, content: m.content }));
    const historyForApi = [...committedHistory, { role: userMsg.role, content: userMsg.content }];

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: historyForApi,
          outline,
          documentContent,
          contextBooks,
          styleGuides,
          ultraContextInjection,
          fictionType,
          perspective,
          model: brainstormModel,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Chat failed" }));
        toast.error(err.error || "Chat failed");
        setMessages(prev => prev.filter(m => m.id !== assistantMsg.id));
        setIsStreaming(false);
        return;
      }

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
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.content ?? parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              contentRef.current += delta;
              setMessages(prev =>
                prev.map(m => m.id === assistantMsg.id ? { ...m, content: contentRef.current } : m)
              );
            }
          } catch { /* skip malformed */ }
        }
      }

      if (!contentRef.current.trim()) {
        setMessages(prev => prev.filter(m => m.id !== assistantMsg.id));
        toast.error("AI returned an empty response. Try again.");
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        if (!contentRef.current.trim()) {
          setMessages(prev => prev.filter(m => m.id !== assistantMsg.id));
        }
        return;
      }
      toast.error(e.message || "Stream failed");
      setMessages(prev => prev.filter(m => m.id !== assistantMsg.id));
    } finally {
      setIsStreaming(false);
    }
  }, [messages, isStreaming, outline, documentContent, contextBooks, styleGuides, ultraContextInjection, fictionType, perspective, brainstormModel]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const lastAssistantId = [...messages].reverse().find(m => m.role === "assistant")?.id;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 md:px-24 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-foreground">Development Studio</h2>
            <p className="text-xs text-muted-foreground">
              Develop your outline, characters, plot, and ideas with AI.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <MemoryBadge
              injection={ultraContextInjection}
              totalTriples={memoryTotalCount}
              categoryCounts={memoryCategoryCounts}
              compact
            />
            {messages.length > 0 && !isStreaming && (
              <Button variant="ghost" size="sm" onClick={clearChat} className="text-xs text-muted-foreground">
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
        {!outline && (
          <div className="rounded-lg border border-dashed border-muted-foreground/30 p-3 text-center">
            <p className="text-xs text-muted-foreground">
              Upload an outline in the <span className="font-medium text-foreground">Files</span> tab for context-aware suggestions.
            </p>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 md:px-24 space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="space-y-3 pt-4">
            <p className="text-xs text-muted-foreground text-center">Quick start or type below:</p>
            <div className="grid grid-cols-2 gap-2">
              {quickPrompts.map(qp => (
                <button
                  key={qp.label}
                  onClick={() => sendMessage(qp.prompt)}
                  className="flex items-center gap-2 p-3 rounded-lg border border-border hover:bg-muted transition-colors text-left"
                >
                  <qp.icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-xs font-medium text-foreground">{qp.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id}>
            <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}>
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    {msg.content ? (
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    ) : (
                      isStreaming && <span className="animate-pulse">Thinking…</span>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
            {/* Action buttons for assistant messages */}
            {msg.role === "assistant" && msg.content && !(isStreaming && msg.id === lastAssistantId) && (
              <div className="flex items-center gap-1 mt-1 ml-1">
                {msg.committed ? (
                  <span className="text-[10px] text-primary flex items-center gap-0.5">
                    <Check className="h-3 w-3" /> Committed
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => commitMessage(msg.id)}
                    className="h-6 px-2 text-[10px] text-muted-foreground hover:text-primary"
                  >
                    <Check className="h-3 w-3 mr-0.5" /> Commit
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyMessage(msg.content)}
                  className="h-6 px-2 text-[10px] text-muted-foreground"
                >
                  <Copy className="h-3 w-3 mr-0.5" /> Copy
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMessage(msg.id)}
                  className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3 mr-0.5" /> Delete
                </Button>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t bg-card/80 backdrop-blur-md px-6 py-3 md:px-24 pb-20">
        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about characters, plot, outline improvements…"
            className="min-h-[44px] max-h-[120px] text-sm resize-none bg-background"
            rows={1}
          />
          {isStreaming ? (
            <Button onClick={handleStop} variant="destructive" size="icon" className="shrink-0 h-[44px] w-[44px]">
              <StopCircle className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => sendMessage(input)} disabled={!input.trim()} size="icon" className="shrink-0 h-[44px] w-[44px]">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DevTab;
