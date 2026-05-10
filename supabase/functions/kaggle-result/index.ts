// Polls a Kaggle notebook job. Client calls this repeatedly until status === 'complete'
// (or 'error'). When complete, fetches the output file written by the notebook
// (/kaggle/working/loomink_output.json) and returns its parsed contents.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KAGGLE_BASE = "https://www.kaggle.com/api/v1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const KAGGLE_KEY = Deno.env.get("KAGGLE_KEY");
    if (!KAGGLE_KEY) return json({ error: "Kaggle key not configured" }, 500);

    const url = new URL(req.url);
    const userName = url.searchParams.get("userName") || "";
    const kernelSlug = url.searchParams.get("kernelSlug") || "";
    if (!userName || !kernelSlug) return json({ error: "userName and kernelSlug required" }, 400);

    const headers = { Authorization: `Bearer ${KAGGLE_KEY}` };

    const statusResp = await fetch(`${KAGGLE_BASE}/kernels/status?userName=${encodeURIComponent(userName)}&kernelSlug=${encodeURIComponent(kernelSlug)}`, { headers });
    if (!statusResp.ok) return json({ error: `status ${statusResp.status}` }, 502);
    const status = await statusResp.json();

    const state: string = status.status || "unknown";
    if (state !== "complete" && state !== "error") {
      return json({ status: state, done: false });
    }

    // Fetch output file listing
    const outResp = await fetch(`${KAGGLE_BASE}/kernels/output?userName=${encodeURIComponent(userName)}&kernelSlug=${encodeURIComponent(kernelSlug)}`, { headers });
    if (!outResp.ok) return json({ status: state, done: true, error: "could not fetch output listing" });
    const out = await outResp.json();
    const files: Array<{ fileName: string; url: string }> = out.files || [];
    const target = files.find((f) => f.fileName === "loomink_output.json");

    if (!target) {
      return json({
        status: state, done: true,
        error: state === "error" ? (status.failureMessage || "notebook failed before producing output") : "output file missing",
        log: (out.log || "").slice(-2000),
      });
    }

    const fileResp = await fetch(target.url);
    if (!fileResp.ok) return json({ status: state, done: true, error: `output file fetch ${fileResp.status}` });
    const parsed = await fileResp.json().catch(() => null);
    if (!parsed) return json({ status: state, done: true, error: "output file not valid JSON" });

    return json({ status: state, done: true, result: parsed });
  } catch (e) {
    console.error("kaggle-result error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
