import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Save, Trash2, CheckCircle2, AlertCircle, Loader2, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useKaggleEndpoints } from "@/hooks/useKaggleEndpoints";
import { kaggleRunnerUrl } from "@/lib/kaggleRunners";

interface Props {
  modelId: string;
}

type Health = "unknown" | "checking" | "live" | "dead";

const KaggleEndpointPanel = ({ modelId }: Props) => {
  const { getFor, upsert, remove } = useKaggleEndpoints();
  const existing = getFor(modelId);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<Health>("unknown");
  const runnerUrl = kaggleRunnerUrl(modelId);
  const lastCheckedRef = useRef<string>("");

  useEffect(() => {
    setUrl(existing?.tunnel_url || "");
    setKey(existing?.api_key || "");
    setPaste("");
    setHealth("unknown");
  }, [existing?.id, modelId]);

  // Auto health-check whenever a saved endpoint exists / changes.
  const ping = useCallback(async (testUrl: string, testKey: string) => {
    if (!testUrl.startsWith("https://")) { setHealth("unknown"); return; }
    const target = `${testUrl.replace(/\/$/, "")}/v1/models`;
    if (lastCheckedRef.current === target) return;
    lastCheckedRef.current = target;
    setHealth("checking");
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(target, {
        signal: ctrl.signal,
        headers: testKey ? { Authorization: `Bearer ${testKey}` } : {},
      });
      clearTimeout(t);
      setHealth(r.ok ? "live" : "dead");
    } catch {
      setHealth("dead");
    }
  }, []);

  useEffect(() => {
    if (existing?.tunnel_url) ping(existing.tunnel_url, existing.api_key || "");
  }, [existing?.tunnel_url, existing?.api_key, ping]);

  // Auto-parse a pasted loomink_endpoint.json blob.
  const applyPaste = useCallback((raw: string) => {
    setPaste(raw);
    const trimmed = raw.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      const t = String(parsed.tunnel_url || parsed.url || "").trim();
      const k = String(parsed.api_key || parsed.apiKey || "").trim();
      if (t) setUrl(t);
      if (k) setKey(k);
      if (t || k) toast.success("Parsed endpoint JSON");
    } catch {
      // Not JSON — try to grab a URL out of it as a fallback.
      const m = trimmed.match(/https:\/\/[^\s"']+/);
      if (m) { setUrl(m[0]); toast.success("Detected tunnel URL"); }
    }
  }, []);

  const save = async () => {
    if (!url.trim().startsWith("https://")) {
      toast.error("Tunnel URL must start with https://");
      return;
    }
    setSaving(true);
    try {
      await upsert(modelId, url, key, "");
      lastCheckedRef.current = "";
      await ping(url, key);
      toast.success("Endpoint saved");
      setPaste("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await remove(modelId);
      setUrl(""); setKey(""); setPaste("");
      setHealth("unknown");
      lastCheckedRef.current = "";
      toast.success("Endpoint cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear failed");
    } finally { setSaving(false); }
  };

  const statusNode = (() => {
    if (!existing) return <><AlertCircle className="h-3.5 w-3.5 text-amber-600" /> Endpoint required</>;
    if (health === "checking") return <><Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> Checking endpoint…</>;
    if (health === "live") return <><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Endpoint live — ready to generate</>;
    if (health === "dead") return <><AlertCircle className="h-3.5 w-3.5 text-red-600" /> Endpoint not responding — restart the Kaggle notebook</>;
    return <><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Endpoint saved</>;
  })();

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium flex items-center gap-1.5">{statusNode}</span>
        {runnerUrl && (
          <a href={runnerUrl} target="_blank" rel="noreferrer"
             className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
            Open notebook <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Open the Kaggle notebook → Save &amp; Run All with GPU T4. When it prints <code className="text-[10px] bg-background px-1 rounded">loomink_endpoint.json</code>, copy the whole file and paste it below — the URL and key are filled in automatically.
      </p>
      <Textarea
        value={paste}
        onChange={e => applyPaste(e.target.value)}
        placeholder='Paste loomink_endpoint.json here  → {"tunnel_url":"https://…","api_key":"…"}'
        className="text-[11px] font-mono min-h-[60px]"
      />
      <div className="grid gap-1.5">
        <Input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://xxxx.trycloudflare.com"
          className="h-8 text-xs font-mono"
        />
        <Input
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder="API key"
          className="h-8 text-xs font-mono"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving} className="h-7 text-xs">
          {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />} Save
        </Button>
        {existing && (
          <>
            <Button size="sm" variant="outline" onClick={() => { lastCheckedRef.current = ""; ping(url, key); }} disabled={saving || health === "checking"} className="h-7 text-xs">
              <ClipboardPaste className="h-3 w-3 mr-1" /> Re-check
            </Button>
            <Button size="sm" variant="outline" onClick={clear} disabled={saving} className="h-7 text-xs">
              <Trash2 className="h-3 w-3 mr-1" /> Clear
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default KaggleEndpointPanel;
