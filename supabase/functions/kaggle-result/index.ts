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

    const outputUrl = `${KAGGLE_BASE}/kernels/output?userName=${encodeURIComponent(userName)}&kernelSlug=${encodeURIComponent(kernelSlug)}`;
    const statusResp = await fetch(`${KAGGLE_BASE}/kernels/status?userName=${encodeURIComponent(userName)}&kernelSlug=${encodeURIComponent(kernelSlug)}`, { headers });
    let status: any = {};
    let state = "unknown";
    if (statusResp.ok) {
      status = await statusResp.json().catch(() => ({}));
      state = status.status || "unknown";
    } else {
      // Kaggle's status endpoint sometimes returns 5xx for a valid running or
      // just-finished notebook. Don't fail the chapter immediately; try the
      // output endpoint below and otherwise report a retryable poll.
      state = "unknown";
    }
    if (state !== "complete" && state !== "error") {
      const outResp = await fetch(outputUrl, { headers });
      if (!outResp.ok) {
        const retryable = statusResp.status === 429 || statusResp.status >= 500 || outResp.status === 429 || outResp.status >= 500;
        return json({ status: state, done: false, retryable, error: statusResp.ok ? undefined : `status ${statusResp.status}` }, retryable ? 503 : 200);
      }
      const out = await outResp.json().catch(() => ({}));
      const files: Array<{ fileName: string; url: string }> = out.files || [];
      const target = files.find((f) => f.fileName === "loomink_output.json");
      if (!target) return json({ status: state, done: false, retryable: true, error: statusResp.ok ? undefined : `status ${statusResp.status}` });
      const fileResp = await fetch(target.url);
      if (!fileResp.ok) return json({ status: state, done: false, retryable: true, error: `output file fetch ${fileResp.status}` }, fileResp.status >= 500 ? 503 : 200);
      const parsed = await fileResp.json().catch(() => null);
      if (!parsed) return json({ status: state, done: false, retryable: true, error: "output file not valid JSON yet" });
      return json({ status: "complete", done: true, result: parsed });
    }

    // Fetch output file listing
    const outResp = await fetch(outputUrl, { headers });
    if (!outResp.ok) {
      const retryable = outResp.status === 429 || outResp.status >= 500;
      return json({ status: state, done: !retryable, retryable, error: `could not fetch output listing (${outResp.status})` }, retryable ? 503 : 200);
    }
    const out = await outResp.json();
    const files: Array<{ fileName: string; url: string }> = out.files || [];
    const target = files.find((f) => f.fileName === "loomink_output.json");

    if (!target) {
      return json({
        status: state, done: state === "error",
        retryable: state !== "error",
        error: state === "error" ? (status.failureMessage || "notebook failed before producing output") : "output file missing",
        log: (out.log || "").slice(-2000),
      });
    }

    const fileResp = await fetch(target.url);
    if (!fileResp.ok) {
      const retryable = fileResp.status === 429 || fileResp.status >= 500;
      return json({ status: state, done: !retryable, retryable, error: `output file fetch ${fileResp.status}` }, retryable ? 503 : 200);
    }
    const parsed = await fileResp.json().catch(() => null);
    if (!parsed) return json({ status: state, done: true, error: "output file not valid JSON" });

    return json({ status: state, done: true, result: parsed });
  } catch (e) {
    console.error("kaggle-result error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
