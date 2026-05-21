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
  "mradermacher-l3-2-rogue-creative-instruct": { repo: "mradermacher/L3.2-Rogue-Creative-Instruct-Uncensored-Abliterated-7B-GGUF", filename: "L3.2-Rogue-Creative-Instruct-Uncensored-Abliterated-7B.Q8_0.gguf" },
  "mradermacher-mars-27b-v-1": { repo: "mradermacher/Mars_27B_V.1-i1-GGUF", filename: "Mars_27B_V.1.i1-Q5_K_S.gguf" },
  "mradermacher-broken-tutu-24b-i1-gguf": { repo: "mradermacher/Broken-Tutu-24B-i1-GGUF", filename: "Broken-Tutu-24B.i1-Q6_K.gguf" },
  "mradermacher-synthia-s1-27b": { repo: "mradermacher/Synthia-S1-27b-GGUF", filename: "Synthia-S1-27b.Q5_K_M.gguf" },
  "mradermacher-gemma4-garnetv2-31b": { repo: "mradermacher/Gemma4-GarnetV2-31B-i1-GGUF", filename: "Gemma4-GarnetV2-31B.i1-Q4_1.gguf" },
  "mradermacher-mag-mell-r1-21b": { repo: "mradermacher/Mag-Mell-R1-21B-GGUF", filename: "Mag-Mell-R1-21B.Q5_K_M.gguf" },
  "thedrummer-fallen-gemma3-27b-v1-gguf": { repo: "TheDrummer/Fallen-Gemma3-27B-v1-GGUF", filename: "Fallen-Gemma3-27B-v1c-Q5_K_M.gguf" },
  "thedrummer-big-tiger-gemma-27b-v3": { repo: "TheDrummer/Big-Tiger-Gemma-27B-v3-GGUF", filename: "Tiger-Gemma-27B-v3a-Q5_K_M.gguf" },
  "thedrummer-magidonia-24b-v4-3": { repo: "TheDrummer/Magidonia-24B-v4.3-GGUF", filename: "Cydonia-24B-v4zk-Q6_K.gguf" },
  "mradermacher-mistralsmallcreative": { repo: "mradermacher/MistralSmall-Creative-24B-Realist-GGUF", filename: "MistralSmall-Creative-24B-Realist.Q4_K_M.gguf" },
  "mradermacher-gemma-the-writer-n-restless-quill-v2": { repo: "mradermacher/Gemma-The-Writer-N-Restless-Quill-V2-Enhanced32-10B-Uncensored-GGUF", filename: "Gemma-The-Writer-N-Restless-Quill-V2-Enhanced32-10B-Uncensored.Q8_0.gguf" },
  "thedrummer-skyfall-31b-v4-2": { repo: "TheDrummer/Skyfall-31B-v4.2-GGUF", filename: "Skyfall-31B-v4y-Q4_K_M.gguf" },
  "fallenmerick-mn-violet-lotus-12b": { repo: "mradermacher/MN-Violet-Lotus-12B-GGUF", filename: "MN-Violet-Lotus-12B.Q8_0.gguf" },
  "davidau-lfm2-5-1-2b-thinking-claude-4-6-opus": { repo: "mradermacher/LFM2.5-1.2B-Instruct-Thinking-Claude-High-Reasoning-GGUF", filename: "LFM2.5-1.2B-Instruct-Thinking-Claude-High-Reasoning.f16.gguf" },
  "davidau-llama-3-2-8x3b-moe-dark-champion": { repo: "DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B-GGUF", filename: "L3.2-8X3B-MOE-Dark-Champion-Inst-18.4B-uncen-ablit_D_AU-Q5_k_s.gguf" },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function sampleLongText(text: string, maxChars: number): string {
  const cleaned = normalizeText(text);
  if (!cleaned || cleaned.length <= maxChars) return cleaned;
  const divider = "\n\n[... condensed ...]\n\n";
  const seg = Math.max(120, Math.floor((maxChars - divider.length * 2) / 3));
  const mid = Math.max(seg, Math.floor(cleaned.length / 2) - Math.floor(seg / 2));
  const excerpt = [cleaned.slice(0, seg), cleaned.slice(mid, mid + seg), cleaned.slice(-seg)].join(divider);
  return excerpt.length > maxChars ? excerpt.slice(0, maxChars) : excerpt;
}

function takeTail(text: string, maxChars: number): string {
  const cleaned = normalizeText(text);
  if (!cleaned || cleaned.length <= maxChars) return cleaned;
  const prefix = "[Earlier content omitted]\n\n";
  return `${prefix}${cleaned.slice(-(maxChars - prefix.length))}`;
}

function compressCollection(values: unknown, totalMax: number, perItem: number): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  let used = 0;
  for (const value of values) {
    const cleaned = normalizeText(value);
    if (!cleaned) continue;
    const remaining = totalMax - used;
    if (remaining < 500) break;
    const excerpt = sampleLongText(cleaned, Math.min(perItem, remaining));
    if (!excerpt) continue;
    result.push(excerpt);
    used += excerpt.length;
  }
  return result;
}

function extractRelevantOutline(outline: string, chapterNumber: number): string {
  const cleaned = normalizeText(outline);
  if (!cleaned) return "";
  const next = chapterNumber + 1;
  for (const pattern of [
    new RegExp(`(^|\\n)(chapter\\s*${chapterNumber}\\b[\\s\\S]*?)(?=(\\nchapter\\s*${next}\\b)|$)`, "i"),
    new RegExp(`(^|\\n)(ch\\.?\\s*${chapterNumber}\\b[\\s\\S]*?)(?=(\\nch\\.?\\s*${next}\\b)|$)`, "i"),
  ]) {
    const match = cleaned.match(pattern);
    if (match?.[2]) return sampleLongText(match[2], 30_000);
  }
  return sampleLongText(cleaned, 30_000);
}

function buildPrompts(body: Record<string, unknown>) {
  const chapterNumber = Number.isFinite(Number(body.chapterNumber)) ? Number(body.chapterNumber) : 1;
  const outline = extractRelevantOutline(String(body.outline || ""), chapterNumber);
  const contextBooks = compressCollection(body.contextBooks, 20_000, 10_000);
  const previousChapters = takeTail(String(body.previousChapters || ""), 16_000);
  const fullManuscript = sampleLongText(String(body.fullManuscript || ""), 40_000);
  const partialContent = takeTail(String(body.partialContent || ""), 8_000);
  const rewriteNotes = normalizeText(body.rewriteNotes);
  const wordCountInstruction = normalizeText(body.wordCountInstruction);
  const perspective = normalizeText(body.perspective);
  const fictionType = normalizeText(body.fictionType);
  const styleGuides = compressCollection(body.styleGuides, 18_000, 9_000).join("\n\n---\n\n");
  const ultraContextInjection = normalizeText(body.ultraContextInjection);
  const checklist = Array.isArray(body.checklist) ? body.checklist : [];
  const checklistText = checklist
    .slice(0, 20)
    .map((item: any) => `- ${item?.q || ""}`)
    .filter(Boolean)
    .join("\n");

  if (!outline) throw new Error("Outline is required");

  let system = `You are a professional novelist writing a complete chapter of fiction. Output only the finished chapter prose.

Rules:
- The very first line must be exactly: ## Chapter ${chapterNumber}: [Chapter Title]
- Write only Chapter ${chapterNumber}.
- Use only details from the Chapter ${chapterNumber} outline.
- Never summarize scenes that should be dramatized.
- Preserve continuity with all provided manuscript and reference material.
- Keep names, places, relationships, and canonical facts exact.`;

  if (perspective) system += `\n- Write every sentence in ${perspective} perspective.`;
  if (fictionType) system += `\n- Match the conventions, pacing, tone, and dialogue style of ${fictionType}.`;
  if (wordCountInstruction) system += `\n- ${wordCountInstruction}`;
  if (styleGuides) system += `\n\nSTYLE GUIDE:\n${styleGuides}`;
  if (checklistText) system += `\n\nSTYLE CHECKLIST:\n${checklistText}`;
  if (ultraContextInjection) system += `\n\nMEMORY CONTEXT:\n${ultraContextInjection}`;

  let user = "";
  if (contextBooks.length > 0) user += `REFERENCE MATERIALS:\n\n${contextBooks.join("\n\n---\n\n")}\n\n`;
  if (fullManuscript) user += `CURRENT MANUSCRIPT:\n\n${fullManuscript}\n\n`;
  else if (previousChapters) user += `PREVIOUS CHAPTERS:\n\n${previousChapters}\n\n`;

  if (partialContent) {
    user += `Continue chapter ${chapterNumber} from this existing text without repeating it:\n\n${partialContent}\n\n`;
  }

  user += `CHAPTER ${chapterNumber} OUTLINE:\n\n${outline}`;
  if (rewriteNotes) user += `\n\nRewrite instructions: ${rewriteNotes}`;
  user += `\n\nNow write the full chapter with rich scenes, strong dialogue, deep interiority, and exact continuity.`;

  return { system, user };
}

function buildNotebook(repo: string, filename: string, system: string, user: string, maxTokens: number, temperature: number, topP: number, ctxSize: number, slug: string): string {
  const code = `
import json, os, sys, shutil, glob, traceback, subprocess
# Kaggle wipes /kaggle/working between kernel versions, but a kernel's own
# previous output is mounted read-only at /kaggle/input/<slug>/ when we add
# the kernel itself as a kernelDataSource. Check there first, then fall back
# to a fresh HF download. The downloaded GGUF is written to /kaggle/working
# so the NEXT version picks it up via /kaggle/input automatically.
WORK_DIR = '/kaggle/working/models'
os.makedirs(WORK_DIR, exist_ok=True)
PROMPT = json.loads(${JSON.stringify(JSON.stringify({ system, user, max_tokens: maxTokens, temperature, top_p: topP, n_ctx: ctxSize }))})
REPO = ${JSON.stringify(repo)}
FILENAME = ${JSON.stringify(filename)}
SLUG = ${JSON.stringify(slug)}
WORK_PATH = os.path.join(WORK_DIR, FILENAME)

def locate_cached():
    bases = [f'/kaggle/input/{SLUG}', '/kaggle/input']
    for base in bases:
        if not os.path.isdir(base): continue
        for p in glob.glob(f'{base}/**/{FILENAME}', recursive=True):
            if os.path.exists(p) and os.path.getsize(p) > 1_000_000:
                return p
    return None

try:
    from llama_cpp import Llama
except Exception:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', '-U', 'llama-cpp-python'])
    from llama_cpp import Llama

try:
    cached = locate_cached()
    if cached:
        print('LOOMINK_CACHE_HIT', cached, os.path.getsize(cached))
        MODEL_PATH = cached
        try:
            if not os.path.exists(WORK_PATH):
                shutil.copy(cached, WORK_PATH)
        except Exception: pass
    else:
        try:
            from huggingface_hub import hf_hub_download
        except Exception:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', '-q', '-U', 'huggingface_hub'])
            from huggingface_hub import hf_hub_download
        print('LOOMINK_DOWNLOAD', REPO, FILENAME)
        downloaded = hf_hub_download(repo_id=REPO, filename=FILENAME, local_dir=WORK_DIR, local_dir_use_symlinks=False)
        MODEL_PATH = downloaded if os.path.exists(downloaded) else WORK_PATH

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

    const { system, user } = buildPrompts(body as Record<string, unknown>);
    if (!user) return json({ error: "user prompt required" }, 400);

    const maxTokens = Math.min(8192, Math.max(256, Number(body.maxTokens) || 4096));
    const temperature = Math.max(0, Math.min(2, Number(body.temperature) ?? 0.7));
    const topP = Math.max(0, Math.min(1, Number(body.topP ?? body.top_p) ?? 0.9));
    const ctxSize = Math.min(32768, Math.max(2048, Number(body.contextWindow) || 8192));

    // Stable per-model slug — re-pushing creates a new version of the SAME
    // kernel, which preserves the cached GGUF in /kaggle/working across runs.
    const slug = `loomink-${modelId}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 50);
    const nbSource = buildNotebook(runtime.repo, runtime.filename, system, user, maxTokens, temperature, topP, ctxSize, slug);

    const buildPayload = (title: string, includeSelfKernel: boolean) => ({
      id: 0,
      slug,
      newTitle: title,
      text: nbSource,
      language: "python",
      kernelType: "notebook",
      isPrivate: true,
      enableGpu: true,
      enableInternet: true,
      datasetDataSources: [],
      competitionDataSources: [],
      // Mount the kernel's own previous version as input so the cached GGUF
      // at /kaggle/working/models is available at /kaggle/input/<slug>/...
      kernelDataSources: includeSelfKernel ? [`${KAGGLE_USERNAME}/${slug}`] : [],
      modelDataSources: [],
      categoryIds: [],
      machineShape: "NvidiaTeslaT4",
      sessionTimeoutSeconds: 3600,
    });

    const pushOnce = async (title: string, includeSelfKernel: boolean) => {
      const resp = await fetch(`${KAGGLE_BASE}/kernels/push`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KAGGLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(title, includeSelfKernel)),
      });
      const text = await resp.text();
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      return { resp, parsed, text };
    };

    const titles = [
      `loomink ${modelId}`.slice(0, 50),
      `loomink-${slug}`.slice(0, 50),
      `loomink-${slug}-${Date.now().toString(36)}`.slice(0, 50),
    ];

    let last: { resp: Response; parsed: any; text: string } | null = null;
    // Try with self-kernel as datasource (cache mount). If Kaggle rejects it
    // because the kernel doesn't exist yet (first run) or has no output yet,
    // retry without it.
    for (const includeSelf of [true, false]) {
      for (const title of titles) {
        last = await pushOnce(title, includeSelf);
        const conflict = last.resp.status === 409 ||
          (typeof last.parsed?.message === "string" && /already in use/i.test(last.parsed.message)) ||
          (typeof last.parsed?.error === "string" && /already in use/i.test(last.parsed.error));
        if (last.resp.ok && !last.parsed.hasError) break;
        if (!conflict) break;
      }
      if (last && last.resp.ok && !last.parsed?.hasError) break;
      // Detect missing-kernel-source error to retry without self-mount
      const msg = String(last?.parsed?.message || last?.parsed?.error || last?.text || "");
      if (!/kernel|source|not found|does not exist/i.test(msg)) break;
    }

    if (!last || !last.resp.ok || last.parsed?.hasError) {
      return json({
        error: last?.parsed?.error || last?.parsed?.message || last?.text?.slice(0, 500) || "push failed",
        status: last?.resp.status ?? 500,
      }, 502);
    }

    // Kaggle derives the actual notebook slug from the title (the slug field
    // in the payload is largely ignored). Extract the real slug from the URL
    // it returns so the client polls the correct kernel.
    const realSlug = (() => {
      const u = String(last.parsed?.url || "");
      const m = u.match(/\/code\/[^/]+\/([^/?#]+)/);
      return m?.[1] || slug;
    })();

    return json({
      ok: true,
      kernelSlug: realSlug,
      userName: KAGGLE_USERNAME,
      versionNumber: last.parsed.versionNumber,
      url: last.parsed.url,
    });
  } catch (e) {
    console.error("kaggle-submit error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
