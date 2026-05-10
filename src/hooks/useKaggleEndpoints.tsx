import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface KaggleEndpoint {
  id: string;
  model_id: string;
  tunnel_url: string;
  api_key: string;
  notes: string;
}

export function useKaggleEndpoints() {
  const { user } = useAuth();
  const [endpoints, setEndpoints] = useState<KaggleEndpoint[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) {
      setEndpoints([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("kaggle_endpoints")
      .select("id, model_id, tunnel_url, api_key, notes")
      .eq("user_id", user.id);
    if (error) console.error("Load kaggle endpoints:", error);
    else setEndpoints((data || []) as KaggleEndpoint[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const upsert = useCallback(async (modelId: string, tunnelUrl: string, apiKey = "", notes = "") => {
    if (!user) return;
    const cleanUrl = tunnelUrl.trim().replace(/\/$/, "");
    const { error } = await (supabase as any)
      .from("kaggle_endpoints")
      .upsert({
        user_id: user.id,
        model_id: modelId,
        tunnel_url: cleanUrl,
        api_key: apiKey.trim(),
        notes: notes.trim(),
      }, { onConflict: "user_id,model_id" });
    if (error) { console.error("Save kaggle endpoint:", error); throw error; }
    await reload();
  }, [user, reload]);

  const remove = useCallback(async (modelId: string) => {
    if (!user) return;
    const { error } = await (supabase as any)
      .from("kaggle_endpoints")
      .delete()
      .eq("user_id", user.id)
      .eq("model_id", modelId);
    if (error) { console.error("Delete kaggle endpoint:", error); throw error; }
    await reload();
  }, [user, reload]);

  const getFor = useCallback((modelId: string) => endpoints.find(e => e.model_id === modelId), [endpoints]);

  return { endpoints, loading, upsert, remove, getFor, reload };
}
