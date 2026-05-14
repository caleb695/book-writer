// Submits a Kaggle GPU notebook that runs a llama.cpp inference job and writes
// /kaggle/working/loomink_output.json with { content: "..." }. Returns a job
// identifier (kernel slug) the client polls via kaggle-result.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KAGGLE_BASE = "https://www.kaggle.com/api/v1";

// Model id (without "kaggle/" prefix) -> { repo_id, filename } verified live
// from each notebook's source on Kaggle.
const MODEL_RUNTIME: Record<string, { repo: string; filename: string }> = {
  "sophosympatheia-magistry-24b-v1-1": { repo: "bartowski/sophosympatheia_Magistry-24B-v1.1-GGUF", filename: "sophosympatheia_Magistry-24B-v1.1-Q6_K_L.gguf" },
  "thedrummer-cydonia-24b-v4-3": { repo: "TheDrummer/Cydonia-24B-v4.3-GGUF", filename: "Cydonia-24B-v4zg-Q6_K.gguf" },
  "pygmalionai-pygmalion-3-12b": { repo: "PygmalionAI/Pygmalion-3-12B-GGUF", filename: "Pygmalion-3-12B-Q6_K.gguf" },
  "mradermacher-gemma3-27b-it-vl-glm-4-7": { repo: "mradermacher/Gemma3-27B-it-vl-GLM-4.7-Uncensored-Heretic-Deep-Reasoning-GGUF", filename: "Gemma3-27B-it-vl-GLM-4.7-Uncensored-Heretic-Deep-Reasoning.Q5_K_M.gguf" },
  "mradermacher-qwen3-4b-fiction-on-fire-series-7": { repo: "mradermacher/Qwen3-4B-Fiction-On-Fire-Series-7-Model-1004-i1-GGUF", filename: "Qwen3-4B-Fiction-On-Fire-Series-7-Model-1004.i1-Q6_K.gguf" },
  "thedrummer-rocinante-x-12b-v1": { repo: "TheDrummer/Rocinante-X-12B-v1-GGUF", filename: "Rocinante-X-12B-v1b-Q8_0.gguf" },
  "mradermacher-l3-2-rogue-creative-instruct": { repo: "mradermacher/L3.2-Rogue-Creative-Instruct-Uncensored-Abliterated-7B-GGUF", filename: "L3.2-Rogue-Creative-Instruct-Uncensored-Abliterated-7B.F16.gguf" },
  "mradermacher-mars-27b-v-1": { repo: "mradermacher/Mars_27B_V.1-i1-GGUF", filename: "Mars_27B_V.1.i1-Q5_K_S.gguf" },
  "mradermacher-broken-tutu-24b-i1-gguf": { repo: "mradermacher/Broken-Tutu-24B-i1-GGUF", filename: "Broken-Tutu-24B.i1-Q6_K.gguf" },
  "mradermacher-synthia-s1-27b": { repo: "mradermacher/Synthia-S1-27b-GGUF", filename: "Synthia-S1-27b.Q5_K_M.gguf" },
  "mradermacher-gemma4-garnetv2-31b": { repo: "mradermacher/Gemma4-GarnetV2-31B-i1-GGUF", filename: "Gemma4-GarnetV2-31B.i1-Q4_1.gguf" },
  "mradermacher-mag-mell-r1-21b": { repo: "mradermacher/Mag-Mell-R1-21B-GGUF", filename: "Mag-Mell-R1-21B.Q8_0.gguf" },
  "thedrummer-fallen-gemma3-27b-v1-gguf": { repo: "TheDrummer/Fallen-Gemma3-27B-v1-GGUF", filename: "Fallen-Gemma3-27B-v1c-Q5_K_M.gguf" },
  "thedrummer-big-tiger-gemma-27b-v3": { repo: "TheDrummer/Big-Tiger-Gemma-27B-v3-GGUF", filename: "Tiger-Gemma-27B-v3a-Q5_K_M.gguf" },
  "thedrummer-magidonia-24b-v4-3": { repo: "TheDrummer/Magidonia-24B-v4.3-GGUF", filename: "Cydonia-24B-v4zk-Q6_K.gguf" },
  "mradermacher-mistralsmallcreative": { repo: "mradermacher/MistralSmall-Creative-24B-Realist-GGUF", filename: "MistralSmall-Creative-24B-Realist.Q8_0.gguf" },
  "mradermacher-gemma-the-writer-n-restless-quill-v2": { repo: "mradermacher/Gemma-The-Writer-N-Restless-Quill-V2-Enhanced32-10B-Uncensored-GGUF", filename: "Gemma-The-Writer-N-Restless-Quill-V2-Enhanced32-10B-Uncensored.F16.gguf" },
  "thedrummer-skyfall-31b-v4-2": { repo: "TheDrummer/Skyfall-31B-v4.2-GGUF", filename: "Skyfall-31B-v4y-Q4_K_M.gguf" },
  "fallenmerick-mn-violet-lotus-12b": { repo: "mradermacher/MN-Violet-Lotus-12B-GGUF", filename: "MN-Violet-Lotus-12B.Q8_0.gguf" },
  "davidau-lfm2-5-1-2b-thinking-claude-4-6-opus": { repo: "mradermacher/LFM2.5-1.2B-Instruct-Thinking-Claude-High-Reasoning-GGUF", filename: "LFM2.5-1.2B-Instruct-Thinking-Claude-High-Reasoning.f16.gguf" },
  "davidau-llama-3-2-8x3b-moe-dark-champion": { repo: "DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B-GGUF", filename: "L3.2-8X3B-MOE-Dark-Champion-Inst-18.4B-uncen-ablit_D_AU-Q5_k_s.gguf" },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function buildNotebook(repo: string, filename: string, system: string, user: string, maxTokens: number, temperature: number, topP: number, ctxSize: number): string {
  const code = `
import json, os, sys, traceback, subprocess
# /kaggle/working persists across runs when the user enables "Persistence: Files
# and variables". We cache the GGUF inside it so the second run skips download.
MODEL_DIR = '/kaggle/working/models'
os.makedirs(MODEL_DIR, exist_ok=True)
PROMPT = json.loads(${JSON.stringify(JSON.stringify({ system, user, max_tokens: maxTokens, temperature, top_p: topP, n_ctx: ctxSize }))})
REPO = ${JSON.stringify(repo)}
FILENAME = ${JSON.stringify(filename)}
MODEL_PATH = os.path.join(MODEL_DIR, FILENAME)

try:
    from llama_cpp import Llama
except Exception:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', '-U', 'llama-cpp-python'])
    from llama_cpp import Llama

try:
    if not os.path.exists(MODEL_PATH) or os.path.getsize(MODEL_PATH) < 1_000_000:
        try:
            from huggingface_hub import hf_hub_download
        except Exception:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', '-U', 'huggingface_hub'])
            from huggingface_hub import hf_hub_download
        print('LOOMINK_DOWNLOAD', REPO, FILENAME)
        downloaded = hf_hub_download(repo_id=REPO, filename=FILENAME, local_dir=MODEL_DIR, local_dir_use_symlinks=False)
        if downloaded != MODEL_PATH:
            try: os.replace(downloaded, MODEL_PATH)
            except Exception: MODEL_PATH = downloaded
    else:
        print('LOOMINK_CACHE_HIT', MODEL_PATH, os.path.getsize(MODEL_PATH))

    llm = Llama(
        model_path=MODEL_PATH,
        n_ctx=PROMPT['n_ctx'],
        n_gpu_layers=-1,
        verbose=False,
    )
    out = llm.create_chat_completion(
        messages=[
            {'role': 'system', 'content': PROMPT['system']},
            {'role': 'user', 'content': PROMPT['user']},
        ],
        max_tokens=PROMPT['max_tokens'],
        temperature=PROMPT['temperature'],
        top_p=PROMPT['top_p'],
    )
    content = out['choices'][0]['message']['content']
    with open('/kaggle/working/loomink_output.json', 'w') as f:
        json.dump({'ok': True, 'content': content, 'usage': out.get('usage', {})}, f)
    print('LOOMINK_DONE', len(content), 'chars')
except Exception as e:
    with open('/kaggle/working/loomink_output.json', 'w') as f:
        json.dump({'ok': False, 'error': str(e), 'trace': traceback.format_exc()}, f)
    print('LOOMINK_ERROR', e)
    raise
`;
  const nb = {
    metadata: { kernelspec: { language: "python", display_name: "Python 3", name: "python3" }, language_info: { name: "python" } },
    nbformat: 4, nbformat_minor: 4,
    cells: [{ cell_type: "code", source: code, metadata: {}, outputs: [], execution_count: null }],
  };
  return JSON.stringify(nb);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const KAGGLE_KEY = Deno.env.get("KAGGLE_KEY");
    const KAGGLE_USERNAME = (Deno.env.get("KAGGLE_USERNAME") || "").toLowerCase();
    if (!KAGGLE_KEY || !KAGGLE_USERNAME) return json({ error: "Kaggle credentials not configured" }, 500);

    const body = await req.json();
    const modelId: string = String(body.model || "").replace(/^kaggle\//, "");
    const runtime = MODEL_RUNTIME[modelId];
    if (!runtime) return json({ error: `Unknown Kaggle model: ${modelId}` }, 400);

    const system: string = String(body.system || "");
    const user: string = String(body.user || "");
    if (!user) return json({ error: "user prompt required" }, 400);

    const maxTokens = Math.min(8192, Math.max(256, Number(body.maxTokens) || 4096));
    const temperature = Math.max(0, Math.min(2, Number(body.temperature) ?? 0.7));
    const topP = Math.max(0, Math.min(1, Number(body.topP) ?? 0.9));
    const ctxSize = Math.min(32768, Math.max(2048, Number(body.contextWindow) || 8192));

    // Stable per-model slug. We always overwrite the same notebook (new version)
    // so the user accumulates one notebook per model, not one per request.
    const slug = `loomink-${modelId}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 50);
    const nbSource = buildNotebook(runtime.repo, runtime.filename, system, user, maxTokens, temperature, topP, ctxSize);

    const payload = {
      id: 0,
      slug,
      newTitle: `loomink ${modelId}`.slice(0, 50),
      text: nbSource,
      language: "python",
      kernelType: "notebook",
      isPrivate: true,
      enableGpu: true,
      enableInternet: true,
      datasetDataSources: [],
      competitionDataSources: [],
      kernelDataSources: [],
      modelDataSources: [],
      categoryIds: [],
      // Kaggle dual-T4 = 2x 16GB. Single-GPU is also fine for these models.
      machineShape: "NvidiaTeslaT4",
      sessionTimeoutSeconds: 3600,
    };

    const pushResp = await fetch(`${KAGGLE_BASE}/kernels/push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KAGGLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const pushText = await pushResp.text();
    let pushJson: any = {};
    try { pushJson = JSON.parse(pushText); } catch { /* ignore */ }
    if (!pushResp.ok || pushJson.hasError) {
      return json({ error: pushJson.error || pushText.slice(0, 500) || "push failed", status: pushResp.status }, 502);
    }

    return json({
      ok: true,
      kernelSlug: slug,
      userName: KAGGLE_USERNAME,
      versionNumber: pushJson.versionNumber,
      url: pushJson.url,
    });
  } catch (e) {
    console.error("kaggle-submit error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
