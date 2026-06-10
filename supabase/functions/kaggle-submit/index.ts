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

function buildKernelSlug(modelId: string): string {
  const overrides: Record<string, string> = {
    "davidau-llama-3-2-8x3b-moe-dark-champion": "davidau-llama-3-2-8x3b-moe-dark-champion-instruct",
  };
  return (overrides[modelId] || modelId).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

function buildSlugSearchTerms(modelId: string, slug: string): string[] {
  const modelPrefix = buildKernelSlug(modelId);
  return Array.from(new Set([
    modelPrefix,
    modelPrefix.slice(0, 50),
    slug,
    slug.slice(0, 40),
    modelId.slice(0, 32).replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
  ].filter(Boolean)));
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

function buildNotebook(repo: string, filename: string, system: string, user: string, maxTokens: number, temperature: number, topP: number, ctxSize: number, slug: string, wordMin: number, wordMax: number): string {
  const code = `
import json, os, sys, shutil, glob, traceback, subprocess, re
# Kaggle wipes /kaggle/working between kernel versions, but a kernel's own
# previous output is mounted read-only at /kaggle/input/<slug>/ when we add
# the kernel itself as a kernelDataSource. Check there first, then fall back
# to a fresh HF download. The downloaded GGUF is written to /kaggle/working
# so the NEXT version picks it up via /kaggle/input automatically.
WORK_DIR = '/kaggle/working/models'
os.makedirs(WORK_DIR, exist_ok=True)
PROMPT = json.loads(${JSON.stringify(JSON.stringify({ system, user, max_tokens: maxTokens, temperature, top_p: topP, n_ctx: ctxSize, word_min: wordMin, word_max: wordMax }))})
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

def wc(s):
    return len(re.findall(r"\\S+", s or ""))

try:
    from llama_cpp import Llama
    # Sanity check: pre-built wheel exposes CUDA. If not, force reinstall from the CUDA wheel index.
    import llama_cpp as _lc
    if not getattr(_lc, 'GGML_USE_CUBLAS', False) and not os.environ.get('LOOMINK_LLAMA_OK'):
        raise ImportError('non-cuda llama_cpp')
except Exception:
    # Install the official prebuilt CUDA 12.1 wheel — avoids a 3-6 min source compile.
    print('LOOMINK_INSTALL_LLAMA_CPP_CUDA')
    subprocess.check_call([
        sys.executable, '-m', 'pip', 'install', '-q', '--upgrade',
        '--extra-index-url', 'https://abetlen.github.io/llama-cpp-python/whl/cu121',
        'llama-cpp-python',
    ])
    os.environ['LOOMINK_LLAMA_OK'] = '1'
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
        n_batch=1024,
        n_ubatch=512,
        flash_attn=True,
        verbose=False,
    )

    WORD_MIN = int(PROMPT['word_min'] or 3500)
    WORD_MAX = int(PROMPT['word_max'] or 4000)
    T = float(PROMPT['temperature'])
    P = float(PROMPT['top_p'])

    # Multi-pass generation: the model sees an updated live word count
    # between each pass and paces itself toward the target. The same Llama
    # instance is reused so KV cache is shared — only new tokens are
    # processed each pass, keeping latency low.
    SEGMENTS = [
        ('opening',    0.30, "Open the chapter. Establish scene, viewpoint, immediate stakes. Use vivid sensory detail and at least one strong line of dialogue or interiority."),
        ('rising',     0.60, "Develop the rising action. Deepen conflict, layer character motivation, advance the outline beats. Heavy on dialogue and concrete action."),
        ('climax',     0.88, "Build to this chapter's peak. Highest tension, most decisive choice or revelation. No summary — fully dramatize."),
        ('resolution', 1.00, "Land the chapter. Resolve the immediate beat and plant a clear hook into the next chapter. Do not write 'End of chapter' or any meta text."),
    ]

    convo = [
        {'role': 'system', 'content': PROMPT['system'] + f"\\n\\nWORD COUNT DISCIPLINE:\\n- Total target: {WORD_MIN}-{WORD_MAX} words.\\n- You will receive a live PROGRESS update before each new section telling you exactly how many words you have written and how many remain.\\n- Pace yourself: do not rush the ending, do not pad the middle."},
        {'role': 'user', 'content': PROMPT['user'] + f"\\n\\nTARGET: {WORD_MIN}-{WORD_MAX} words for this chapter. I will guide you section-by-section with live word-count updates so you can pace the prose precisely."},
    ]

    full_chapter = ''
    for idx, (label, frac, guidance) in enumerate(SEGMENTS):
        target_at_end = int(WORD_MAX * frac)
        current = wc(full_chapter)
        needed = max(80, target_at_end - current)
        budget_tokens = min(int(PROMPT['max_tokens']), int(needed * 1.9) + 200)

        if idx == 0:
            convo.append({'role': 'user', 'content': f"FIRST SECTION ({label}): {guidance}\\nWrite approximately {needed} words. Begin the chapter now with the required heading on the very first line."})
        else:
            convo.append({'role': 'assistant', 'content': last_response})
            convo.append({'role': 'user', 'content': f"PROGRESS: {current} / {WORD_MAX} words written ({int(current/WORD_MAX*100)}% of target). Remaining budget: {WORD_MAX - current} words.\\n\\nNEXT SECTION ({label}): {guidance}\\nWrite approximately {needed} more words. Continue seamlessly from your last sentence — do NOT restart, do NOT repeat the chapter heading, do NOT summarize what came before."})

        print(f'LOOMINK_PASS {idx+1}/{len(SEGMENTS)} {label} current={current} target={target_at_end} budget={budget_tokens}')
        out = llm.create_chat_completion(
            messages=convo,
            max_tokens=budget_tokens,
            temperature=T,
            top_p=P,
        )
        last_response = (out['choices'][0]['message']['content'] or '').strip()
        if not last_response:
            print(f'LOOMINK_PASS_EMPTY {label}')
            continue
        # Strip a duplicated chapter heading the model sometimes re-emits.
        if idx > 0:
            last_response = re.sub(r'^\\s*##\\s*Chapter\\s+\\d+[^\\n]*\\n+', '', last_response, count=1, flags=re.IGNORECASE)
        full_chapter += ('\\n\\n' if full_chapter else '') + last_response
        # Pop the most recent user instruction so the next pass slots a fresh
        # progress update in its place — keeps the conversation lean.
        convo.pop()
        print(f'LOOMINK_AFTER_PASS {label} total_words={wc(full_chapter)}')

        # Early exit if we already exceeded max — let the model land cleanly.
        if wc(full_chapter) >= WORD_MAX and label != 'resolution':
            print('LOOMINK_AT_MAX skipping_remaining_segments')
            convo.append({'role': 'assistant', 'content': last_response})
            convo.append({'role': 'user', 'content': f"PROGRESS: {wc(full_chapter)} / {WORD_MAX} words. You have hit the target. Write ONLY a short final paragraph (60-150 words) that lands this chapter and plants a hook. Do not start new scenes."})
            out = llm.create_chat_completion(messages=convo, max_tokens=400, temperature=T, top_p=P)
            tail = (out['choices'][0]['message']['content'] or '').strip()
            if tail:
                tail = re.sub(r'^\\s*##\\s*Chapter\\s+\\d+[^\\n]*\\n+', '', tail, count=1, flags=re.IGNORECASE)
                full_chapter += '\\n\\n' + tail
            break

    final_count = wc(full_chapter)
    with open('/kaggle/working/loomink_output.json', 'w') as f:
        json.dump({'ok': True, 'content': full_chapter, 'word_count': final_count, 'target': [WORD_MIN, WORD_MAX]}, f)
    print('LOOMINK_DONE', final_count, 'words')
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
    const wordMin = Math.max(100, Number(body.wordCountMin) || 3500);
    const wordMax = Math.max(wordMin, Number(body.wordCountMax) || 4000);

    // Stable per-model slug — re-pushing creates a new version of the SAME
    // kernel, which preserves the cached GGUF in /kaggle/working across runs.
    const slug = buildKernelSlug(modelId).slice(0, 50);
    const nbSource = buildNotebook(runtime.repo, runtime.filename, system, user, maxTokens, temperature, topP, ctxSize, slug, wordMin, wordMax);

    const buildPayload = (includeSelfKernel: boolean) => ({
      // Kaggle's push API expects `slug` in full `username/kernel-slug`
      // format. Passing only the trailing slug triggers
      // "Invalid slug: '<slug>'" on some models. Its `id` field, meanwhile,
      // is numeric in this endpoint, so we must omit it.
      slug: `${KAGGLE_USERNAME}/${slug}`,
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

    const pushOnce = async (includeSelfKernel: boolean) => {
      const resp = await fetch(`${KAGGLE_BASE}/kernels/push`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KAGGLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(includeSelfKernel)),
      });
      const text = await resp.text();
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch { /* ignore */ }
      return { resp, parsed, text };
    };

    let last: { resp: Response; parsed: any; text: string } | null = null;
    // Try with self-kernel as datasource (cache mount). If Kaggle rejects it
    // because the kernel doesn't exist yet (first run) or has no output yet,
    // retry without it.
    for (const includeSelf of [true, false]) {
      last = await pushOnce(includeSelf);
      if (last && last.resp.ok && !last.parsed?.hasError) break;
      // Detect missing-kernel-source error to retry without self-mount
      const msg = String(last?.parsed?.message || last?.parsed?.error || last?.text || "");
      if (!/kernel|source|not found|does not exist/i.test(msg)) break;
    }

    if (!last || !last.resp.ok || last.parsed?.hasError) {
      // If Kaggle says the kernel is already in use, find the actually-running
      // kernel and reconnect. Kaggle derives the real slug from the title, so
      // our `slug` variable may not match. We check three sources in order:
      //   1) a client-supplied hint (knownKernelSlug from the previous submit)
      //   2) direct status check on our stable slug
      //   3) list kernels matching the loomink-<modelId> prefix
      const errMsg = String(last?.parsed?.message || last?.parsed?.error || last?.text || "");
      const conflict = last?.resp.status === 409 || /already in use|in use/i.test(errMsg);
      if (conflict) {
        const checkSlug = async (candidate: string) => {
          try {
            const r = await fetch(
              `${KAGGLE_BASE}/kernels/status?userName=${encodeURIComponent(KAGGLE_USERNAME)}&kernelSlug=${encodeURIComponent(candidate)}`,
              { headers: { Authorization: `Bearer ${KAGGLE_KEY}` } },
            );
            if (!r.ok) return null;
            const st = await r.json();
            const state = String(st?.status || "");
            return (state === "running" || state === "queued") ? state : null;
          } catch { return null; }
        };

        const candidates: string[] = [];
        const hint = typeof body.knownKernelSlug === "string" ? body.knownKernelSlug.trim() : "";
        if (hint) candidates.push(hint);
        if (!candidates.includes(slug)) candidates.push(slug);

        // Search Kaggle for kernels with the same prefix, including truncated
        // prefixes for long model ids whose real kernel slug was shortened.
        for (const term of buildSlugSearchTerms(modelId, slug)) {
          try {
            const listResp = await fetch(
              `${KAGGLE_BASE}/kernels/list?user=${encodeURIComponent(KAGGLE_USERNAME)}&search=${encodeURIComponent(term)}&pageSize=30&sortBy=dateRun`,
              { headers: { Authorization: `Bearer ${KAGGLE_KEY}` } },
            );
            if (!listResp.ok) continue;
            const arr = await listResp.json();
            if (Array.isArray(arr)) {
              for (const k of arr) {
                const ref = String(k?.ref || ""); // "user/slug"
                const s = ref.split("/").pop();
                if (s && !candidates.includes(s)) candidates.push(s);
              }
            }
          } catch { /* ignore */ }
        }

        for (const cand of candidates) {
          const state = await checkSlug(cand);
          if (state) {
            return json({
              ok: true,
              kernelSlug: cand,
              userName: KAGGLE_USERNAME,
              reused: true,
              status: state,
            });
          }
        }
      }
      return json({
        error: last?.parsed?.error || last?.parsed?.message || last?.text?.slice(0, 500) || "push failed",
        status: last?.resp.status ?? 500,
        conflict,
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
