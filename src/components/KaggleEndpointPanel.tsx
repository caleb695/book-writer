import { useEffect, useState } from "react";
import { ExternalLink, Save, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useKaggleEndpoints } from "@/hooks/useKaggleEndpoints";
import { kaggleRunnerUrl } from "@/lib/kaggleRunners";

interface Props {
  modelId: string;
}

const KaggleEndpointPanel = ({ modelId }: Props) => {
  const { getFor, upsert, remove } = useKaggleEndpoints();
  const existing = getFor(modelId);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const runnerUrl = kaggleRunnerUrl(modelId);

  useEffect(() => {
    setUrl(existing?.tunnel_url || "");
    setKey(existing?.api_key || "");
  }, [existing?.id, modelId]);

  const save = async () => {
    if (!url.trim().startsWith("https://")) {
      toast.error("Tunnel URL must start with https://");
      return;
    }
    setSaving(true);
    try {
      await upsert(modelId, url, key, "");
      toast.success("Endpoint saved");
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
      setUrl(""); setKey("");
      toast.success("Endpoint cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium flex items-center gap-1.5">
          {existing ? (
            <><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Kaggle endpoint configured</>
          ) : (
            <><AlertCircle className="h-3.5 w-3.5 text-amber-600" /> Kaggle endpoint required</>
          )}
        </span>
        {runnerUrl && (
          <a href={runnerUrl} target="_blank" rel="noreferrer"
             className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
            Open notebook <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        1. Open the Kaggle notebook → "Save & Run All" with GPU T4 enabled.
        2. Once the cloudflared tunnel prints, open <code className="text-[10px] bg-background px-1 rounded">/kaggle/working/loomink_endpoint.json</code>.
        3. Paste <code className="text-[10px] bg-background px-1 rounded">tunnel_url</code> + <code className="text-[10px] bg-background px-1 rounded">api_key</code> below.
      </p>
      <Input
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="https://xxxx.trycloudflare.com"
        className="h-8 text-xs font-mono"
      />
      <Input
        value={key}
        onChange={e => setKey(e.target.value)}
        placeholder="API key (from loomink_endpoint.json)"
        className="h-8 text-xs font-mono"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving} className="h-7 text-xs">
          <Save className="h-3 w-3 mr-1" /> Save
        </Button>
        {existing && (
          <Button size="sm" variant="outline" onClick={clear} disabled={saving} className="h-7 text-xs">
            <Trash2 className="h-3 w-3 mr-1" /> Clear
          </Button>
        )}
      </div>
    </div>
  );
};

export default KaggleEndpointPanel;
