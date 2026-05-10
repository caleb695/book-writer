import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

export interface UploadedFile {
  id: string;
  file_name: string;
  file_type: "context" | "outline" | "style";
  content: string;
  created_at: string;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  chapter_number: number | null;
  committed: boolean;
  created_at: string;
}

export function useProject() {
  const { user } = useAuth();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [documentContent, setDocumentContent] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => clearTimeout(saveTimeoutRef.current);
  }, []);

  // Load or create project
  useEffect(() => {
    if (!user) {
      setLoading(false);
      setProjectId(null);
      setFiles([]);
      setMessages([]);
      setDocumentContent("");
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const { data: projects, error: projError } = await supabase
          .from("projects")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (projError) throw projError;
        if (cancelled) return;

        let pid: string;
        if (projects && projects.length > 0) {
          pid = projects[0].id;
          setDocumentContent(projects[0].document_content);
        } else {
          const { data: newProj, error: createError } = await supabase
            .from("projects")
            .insert({ user_id: user.id })
            .select()
            .single();
          if (createError) throw createError;
          if (!newProj || cancelled) { setLoading(false); return; }
          pid = newProj.id;
        }
        setProjectId(pid);

        const [filesRes, msgsRes] = await Promise.all([
          supabase.from("uploaded_files").select("*").eq("project_id", pid).order("created_at"),
          supabase.from("ai_messages").select("*").eq("project_id", pid).order("created_at"),
        ]);

        if (cancelled) return;
        if (filesRes.error) console.error("Files load error:", filesRes.error);
        if (msgsRes.error) console.error("Messages load error:", msgsRes.error);

        setFiles((filesRes.data ?? []) as UploadedFile[]);
        setMessages((msgsRes.data ?? []) as AiMessage[]);
      } catch (err: any) {
        console.error("Project load error:", err);
        if (!cancelled) toast.error("Failed to load project");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  const uploadFile = useCallback(async (fileName: string, content: string, fileType: "context" | "outline" | "style") => {
    if (!projectId || !user) return null;
    const { data, error } = await supabase.from("uploaded_files").insert({
      project_id: projectId,
      user_id: user.id,
      file_name: fileName,
      file_type: fileType,
      content,
    }).select().single();
    if (error) { toast.error("Upload failed: " + error.message); return null; }
    if (data) setFiles(prev => [...prev, data as UploadedFile]);
    toast.success(fileType === "outline" ? "Outline uploaded" : fileType === "style" ? "Style file uploaded" : "Context uploaded");
    return data as UploadedFile;
  }, [projectId, user]);

  const markFileAnalyzed = useCallback(async (fileId: string) => {
    const { error } = await supabase.from("uploaded_files").update({ analyzed: true }).eq("id", fileId);
    if (error) console.error("Mark analyzed error:", error);
  }, []);

  const deleteFile = useCallback(async (fileId: string) => {
    const { error } = await supabase.from("uploaded_files").delete().eq("id", fileId);
    if (error) { toast.error("Delete failed"); return; }
    setFiles(prev => prev.filter(f => f.id !== fileId));
  }, []);

  const saveDocument = useCallback(async (content: string) => {
    if (!projectId) return;
    setDocumentContent(content);
    const { error } = await supabase.from("projects").update({ document_content: content }).eq("id", projectId);
    if (error) console.error("Save error:", error);
  }, [projectId]);

  const addMessage = useCallback(async (role: "user" | "assistant", content: string, chapterNumber?: number) => {
    if (!projectId || !user) return null;
    const { data, error } = await supabase.from("ai_messages").insert({
      project_id: projectId,
      user_id: user.id,
      role,
      content,
      chapter_number: chapterNumber ?? null,
    }).select().single();
    if (error) { console.error("Add message error:", error); return null; }
    const msg = data as AiMessage;
    setMessages(prev => [...prev, msg]);
    return msg;
  }, [projectId, user]);

  const updateMessage = useCallback(async (id: string, content: string) => {
    const { error } = await supabase.from("ai_messages").update({ content }).eq("id", id);
    if (error) console.error("Update message error:", error);
    setMessages(prev => prev.map(m => m.id === id ? { ...m, content } : m));
  }, []);

  const commitMessage = useCallback(async (id: string) => {
    const { error } = await supabase.from("ai_messages").update({ committed: true }).eq("id", id);
    if (error) console.error("Commit error:", error);
    setMessages(prev => prev.map(m => m.id === id ? { ...m, committed: true } : m));
  }, []);

  const deleteMessage = useCallback(async (id: string) => {
    const { error } = await supabase.from("ai_messages").delete().eq("id", id);
    if (error) console.error("Delete message error:", error);
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  return {
    projectId, documentContent, files, messages, loading,
    uploadFile, deleteFile, markFileAnalyzed, saveDocument, addMessage, updateMessage,
    commitMessage, deleteMessage, setMessages,
  };
}
