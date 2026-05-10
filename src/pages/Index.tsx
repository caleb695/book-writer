import { useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useProject } from "@/hooks/useProject";
import { useAiSettings } from "@/hooks/useAiSettings";
import { useStyleMemory } from "@/hooks/useStyleMemory";
import { useMemori } from "@/hooks/useMemori";
import { assembleContext } from "@/lib/ultraContext";
import BottomNav, { type TabId } from "@/components/BottomNav";
import FilesTab from "@/components/FilesTab";
import AiTab from "@/components/AiTab";
import StyleTab from "@/components/StyleTab";
import DevTab from "@/components/DevTab";
import DocumentTab from "@/components/DocumentTab";

const Index = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const {
    files, messages, documentContent, loading: projectLoading,
    uploadFile, deleteFile, markFileAnalyzed, saveDocument, addMessage,
    updateMessage, commitMessage, deleteMessage, setMessages,
  } = useProject();
  const { settings: aiSettings, updateSettings: updateAiSettings } = useAiSettings();
  const { memory: styleMemory, patterns: stylePatterns, saveSynthesis, scoreFidelity, scoring: styleScoring, lastFidelity } = useStyleMemory();
  const { triples: memoriTriples, retrieve: memoriRetrieve, storeTriples } = useMemori();
  const [activeTab, setActiveTab] = useState<TabId>("files");

  // Chunk long text into ~10k char windows so we can extract from large files
  const chunkText = useCallback((text: string, size = 10000): string[] => {
    const clean = (text || "").trim();
    if (clean.length <= size) return [clean];
    const chunks: string[] = [];
    // Split on paragraph boundaries when possible
    const paragraphs = clean.split(/\n{2,}/);
    let current = "";
    for (const p of paragraphs) {
      if ((current + "\n\n" + p).length > size && current) {
        chunks.push(current);
        current = p;
      } else {
        current = current ? current + "\n\n" + p : p;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }, []);

  // Auto-extract semantic triples from arbitrary text and persist them via Memori
  const learnFromText = useCallback(async (text: string, sourceLabel: string) => {
    const trimmed = (text || "").trim();
    if (!trimmed || trimmed.length < 200) return { stored: 0, merged: 0 };
    let totalStored = 0, totalMerged = 0;
    const chunks = chunkText(trimmed, 10000);
    for (let i = 0; i < chunks.length; i++) {
      const label = chunks.length > 1 ? `${sourceLabel} (part ${i + 1}/${chunks.length})` : sourceLabel;
      try {
        const { data, error } = await supabase.functions.invoke("extract-triples", {
          body: { text: chunks[i], sourceLabel: label },
        });
        if (error) { console.error("extract-triples invoke error:", error); continue; }
        const triples = Array.isArray(data?.triples) ? data.triples : [];
        if (triples.length === 0) continue;
        const result = await storeTriples(triples);
        totalStored += result.stored;
        totalMerged += result.merged;
      } catch (e) {
        console.error("learnFromText chunk failed:", e);
      }
    }
    return { stored: totalStored, merged: totalMerged };
  }, [chunkText, storeTriples]);

  const learnFromChapter = useCallback(async (chapterText: string, chapterNumber?: number | null) => {
    const result = await learnFromText(chapterText, chapterNumber ? `Chapter ${chapterNumber}` : "Chapter");
    if (result.stored > 0 || result.merged > 0) {
      toast.success(`Memory updated: +${result.stored} new, ${result.merged} reinforced`);
    }
  }, [learnFromText]);

  // Wrap commitMessage so committing a chapter auto-extracts triples
  const handleCommitMessage = useCallback(async (id: string) => {
    const msg = messages.find(m => m.id === id);
    await commitMessage(id);
    if (msg && msg.role === "assistant" && msg.content) {
      learnFromChapter(msg.content, msg.chapter_number ?? null);
    }
  }, [messages, commitMessage, learnFromChapter]);

  // Wrap uploadFile so uploading a context/outline file pre-seeds Memori with canonical facts
  const handleUploadFile = useCallback(async (fileName: string, content: string, fileType: "context" | "outline" | "style") => {
    const file = await uploadFile(fileName, content, fileType);
    if (!file) return null;
    // Style files have their own pipeline (analyze-style) — skip triple extraction
    if (fileType === "style") return file;
    // Run extraction in the background so the UI doesn't block
    (async () => {
      const label = fileType === "outline" ? `Outline: ${fileName}` : `Reference: ${fileName}`;
      toast(`Reading ${fileName} into memory…`, { duration: 3000 });
      const result = await learnFromText(content, label);
      if (result.stored > 0 || result.merged > 0) {
        toast.success(`${fileName}: learned ${result.stored} new facts, reinforced ${result.merged}`);
      }
      await markFileAnalyzed(file.id);
    })();
    return file;
  }, [uploadFile, learnFromText, markFileAnalyzed]);

  // Assemble UltraContext injection whenever relevant state changes
  const ultraContextInjection = useMemo(() => {
    if (memoriTriples.length === 0) return "";
    const relevant = memoriRetrieve("", { includeCharacters: true, includeWorldRules: true });
    if (relevant.length === 0) return "";
    const payload = assembleContext(relevant, {
      model: aiSettings.model,
      voiceProfile: styleMemory?.voice_profile as Record<string, any> | undefined,
      genreConventions: styleMemory?.genre_conventions as Array<{ convention: string; checklist_question: string }> | undefined,
      detectedGenre: styleMemory?.detected_genre ?? undefined,
      styleCache: styleMemory?.style_cache,
    });
    return payload.injection;
  }, [memoriTriples, aiSettings.model, styleMemory]);

  // Compute category breakdown for the memory badge tooltip
  const memoryCategoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of memoriTriples) {
      const cat = t.category || "other";
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [memoriTriples]);

  if (authLoading || (user && projectLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const styleFiles = files.filter(f => f.file_type === "style");

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className={activeTab === "files" ? "flex-1 flex flex-col" : "hidden"}>
        <FilesTab files={files} onUpload={handleUploadFile} onDelete={deleteFile} />
      </div>
      <div className={activeTab === "ai" ? "flex-1 flex flex-col" : "hidden"}>
        <AiTab
          files={files}
          messages={messages}
          documentContent={documentContent}
          onAddMessage={addMessage}
          onUpdateMessage={updateMessage}
          onCommitMessage={handleCommitMessage}
          onDeleteMessage={deleteMessage}
          onSaveDocument={saveDocument}
          setMessages={setMessages}
          styleGuides={styleFiles.map(f => f.content)}
          aiSettings={aiSettings}
          onUpdateAiSettings={updateAiSettings}
          styleMemory={styleMemory}
          stylePatterns={stylePatterns}
          onScoreFidelity={scoreFidelity}
          scoring={styleScoring}
          lastFidelity={lastFidelity}
          ultraContextInjection={ultraContextInjection}
          memoryTotalCount={memoriTriples.length}
          memoryCategoryCounts={memoryCategoryCounts}
        />
      </div>
      <div className={activeTab === "style" ? "flex-1 flex flex-col" : "hidden"}>
        <StyleTab files={files} onUpload={handleUploadFile} onDelete={deleteFile} styleMemory={styleMemory} stylePatterns={stylePatterns} onSaveSynthesis={saveSynthesis} />
      </div>
      <div className={activeTab === "development" ? "flex-1 flex flex-col" : "hidden"}>
        <DevTab
          files={files}
          documentContent={documentContent}
          ultraContextInjection={ultraContextInjection}
          fictionType={aiSettings.fiction_type_enabled ? aiSettings.fiction_type : ""}
          perspective={aiSettings.perspective}
          model={aiSettings.model}
          memoryTotalCount={memoriTriples.length}
          memoryCategoryCounts={memoryCategoryCounts}
        />
      </div>
      <div className={activeTab === "document" ? "flex-1 flex flex-col" : "hidden"}>
        <DocumentTab
          content={documentContent}
          onSave={saveDocument}
          onSignOut={signOut}
        />
      </div>
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default Index;
