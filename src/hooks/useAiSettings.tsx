import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface AiSettings {
  model: string;
  temperature: number;
  top_p: number;
  chapter_number: number;
  fiction_type: string;
  fiction_type_enabled: boolean;
  perspective: string;
  word_count_min: number;
  word_count_max: number;
  brainstorm_model: string;
  thinking_enabled: boolean;
}

const DEFAULTS: AiSettings = {
  model: "mistral-large-latest",
  temperature: 0.7,
  top_p: 0.9,
  chapter_number: 1,
  fiction_type: "",
  fiction_type_enabled: false,
  perspective: "",
  word_count_min: 3500,
  word_count_max: 4000,
  brainstorm_model: "mistral-large-latest",
  thinking_enabled: true,
};


export interface ModelEntry {
  id: string;
  label: string;
  provider: "mistral" | "groq" | "openrouter" | "meganova" | "kaggle";
  /** Max context window in tokens (input + output combined) */
  contextWindow?: number;
  /** For kaggle models: HF/origin label and notes */
  hfRepo?: string;
  /** True if the model uses internal <think>/reasoning tokens the user can toggle off */
  supportsThinking?: boolean;
}


export const AI_MODELS: ModelEntry[] = [
  // ========== MISTRAL — Frontier Generalist ==========
  { id: "mistral-large-latest", label: "Mistral Large 3", provider: "mistral", contextWindow: 131072 },
  { id: "mistral-medium-latest", label: "Mistral Medium 3.1", provider: "mistral", contextWindow: 131072 },
  { id: "mistral-medium-2505", label: "Mistral Medium 3", provider: "mistral", contextWindow: 131072 },
  { id: "mistral-small-latest", label: "Mistral Small 4", provider: "mistral", contextWindow: 131072 },
  { id: "mistral-small-2506", label: "Mistral Small 3.2", provider: "mistral", contextWindow: 131072 },
  // --- Reasoning ---
  { id: "magistral-medium-latest", label: "Magistral Medium 1.2", provider: "mistral", contextWindow: 40960 },
  { id: "magistral-small-latest", label: "Magistral Small 1.2", provider: "mistral", contextWindow: 40960 },
  // --- Compact ---
  { id: "ministral-3-14b-latest", label: "Ministral 3 14B", provider: "mistral", contextWindow: 131072 },
  { id: "ministral-3-8b-latest", label: "Ministral 3 8B", provider: "mistral", contextWindow: 131072 },
  { id: "ministral-3-3b-latest", label: "Ministral 3 3B", provider: "mistral", contextWindow: 131072 },
  // --- Open Source ---
  { id: "open-mistral-nemo", label: "Mistral Nemo 12B", provider: "mistral", contextWindow: 131072 },
  // --- Specialist ---
  { id: "mistral-embed", label: "Mistral Embed", provider: "mistral", contextWindow: 8192 },
  // --- Legacy ---
  { id: "open-mistral-7b", label: "Mistral 7B", provider: "mistral", contextWindow: 32768 },
  { id: "open-mixtral-8x7b", label: "Mixtral 8x7B", provider: "mistral", contextWindow: 32768 },
  { id: "open-mixtral-8x22b", label: "Mixtral 8x22B", provider: "mistral", contextWindow: 65536 },
  { id: "mistral-small-2402", label: "Mistral Small (Feb 2024)", provider: "mistral", contextWindow: 32768 },
  { id: "mistral-medium-2312", label: "Mistral Medium (Dec 2023)", provider: "mistral", contextWindow: 32768 },
  { id: "mistral-large-2402", label: "Mistral Large (Feb 2024)", provider: "mistral", contextWindow: 32768 },
  { id: "mistral-large-2407", label: "Mistral Large 2 (Jul 2024)", provider: "mistral", contextWindow: 131072 },
  { id: "mistral-large-2411", label: "Mistral Large (Nov 2024)", provider: "mistral", contextWindow: 131072 },

  // ========== GROQ ==========
  { id: "qwen/qwen3-32b", label: "Qwen3 32B", provider: "groq", contextWindow: 131072 },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", provider: "groq", contextWindow: 131072 },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile", provider: "groq", contextWindow: 131072 },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B", provider: "groq", contextWindow: 131072 },
  { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2 Instruct", provider: "groq", contextWindow: 131072 },
  { id: "moonshotai/kimi-k2-instruct-0905", label: "Kimi K2 Instruct 0905", provider: "groq", contextWindow: 262144 },
  { id: "openai/gpt-oss-120b", label: "GPT OSS 120B", provider: "groq", contextWindow: 131072 },
  { id: "openai/gpt-oss-20b", label: "GPT OSS 20B", provider: "groq", contextWindow: 131072 },
  

  // ========== OPENROUTER ==========
  { id: "google/gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B", provider: "openrouter", contextWindow: 131072 },
  { id: "google/gemma-4-31b-it", label: "Gemma 4 31B", provider: "openrouter", contextWindow: 131072 },
  { id: "nvidia/nemotron-3-super", label: "Nemotron 3 Super", provider: "openrouter", contextWindow: 131072 },
  { id: "nvidia/nemotron-3-nano-30b-a3b", label: "Nemotron 3 Nano 30B A3B", provider: "openrouter", contextWindow: 131072 },
  { id: "nvidia/nemotron-nano-12b-2-vl", label: "Nemotron Nano 12B 2 VL", provider: "openrouter", contextWindow: 131072 },
  { id: "qwen/qwen3-next-80b-a3b-instruct", label: "Qwen3 Next 80B A3B Instruct", provider: "openrouter", contextWindow: 262144 },
  { id: "nvidia/nemotron-nano-9b-v2", label: "Nemotron Nano 9B V2", provider: "openrouter", contextWindow: 131072 },
  { id: "google/gemma-3-27b-it", label: "Gemma 3 27B", provider: "openrouter", contextWindow: 131072 },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct", provider: "openrouter", contextWindow: 131072 },
  { id: "meta-llama/llama-3.2-3b-instruct", label: "Llama 3.2 3B Instruct", provider: "openrouter", contextWindow: 131072 },

  // ========== MEGANOVA (context windows verified live from api.meganova.ai/v1/models) ==========
  { id: "BruhzWater/Sapphira-L3.3-70b-0.1", label: "Sapphira-L3.3-70b-0.1", provider: "meganova", contextWindow: 65536 },
  { id: "FallenMerick/MN-Violet-Lotus-12B", label: "MN-Violet-Lotus-12B", provider: "meganova", contextWindow: 65536 },
  { id: "Steelskull/L3.3-MS-Nevoria-70b", label: "L3.3-MS-Nevoria-70b", provider: "meganova", contextWindow: 65536 },
  { id: "mistralai/Mistral-Small-3.2-24B-Instruct-2506", label: "Mistral-Small-3.2-24B-Instruct-2506", provider: "meganova", contextWindow: 32768 },
  { id: "Sao10K/L3-70B-Euryale-v2.1", label: "L3-70B-Euryale-v2.1", provider: "meganova", contextWindow: 8192 },

  // ========== KAGGLE / HUGGING FACE (run on Kaggle GPU notebook via API) ==========
  // Each model corresponds to a Kaggle notebook (mynameishiiii/<slug>) that loads a
  // GGUF quantization on a Tesla T4 (~15GB VRAM). Repos / filenames verified live from
  // each notebook source. Context windows are conservative — the model + prompt + output
  // must all fit in VRAM.
  { id: "kaggle/sophosympatheia-magistry-24b-v1-1", label: "Magistry-24B-v1.1 (Q6_K_L)", provider: "kaggle", contextWindow: 8192, hfRepo: "bartowski/sophosympatheia_Magistry-24B-v1.1-GGUF", supportsThinking: true },
  { id: "kaggle/thedrummer-cydonia-24b-v4-3", label: "Cydonia-24B-v4.3 (Q6_K)", provider: "kaggle", contextWindow: 8192, hfRepo: "TheDrummer/Cydonia-24B-v4.3-GGUF" },
  { id: "kaggle/fallenmerick-mn-violet-lotus-12b", label: "MN-Violet-Lotus-12B", provider: "kaggle", contextWindow: 16384, hfRepo: "FallenMerick/MN-Violet-Lotus-12B" },
  { id: "kaggle/pygmalionai-pygmalion-3-12b", label: "Pygmalion-3-12B (F16)", provider: "kaggle", contextWindow: 8192, hfRepo: "PygmalionAI/Pygmalion-3-12B-GGUF" },
  { id: "kaggle/mradermacher-gemma3-27b-it-vl-glm-4-7", label: "Gemma3-27B-IT-VL GLM-4.7 (Q5_K_M)", provider: "kaggle", contextWindow: 8192, hfRepo: "mradermacher/Gemma3-27B-it-vl-GLM-4.7-Uncensored-Heretic-Deep-Reasoning-GGUF", supportsThinking: true },
  { id: "kaggle/davidau-lfm2-5-1-2b-thinking-claude-4-6-opus", label: "LFM2.5-1.2B Thinking Claude-4.6", provider: "kaggle", contextWindow: 16384, hfRepo: "DavidAU/LFM2.5-1.2B-Thinking-Claude-4.6-Opus", supportsThinking: true },
  { id: "kaggle/mradermacher-qwen3-4b-fiction-on-fire-series-7", label: "Qwen3-4B Fiction-On-Fire S7 (Q6_K)", provider: "kaggle", contextWindow: 16384, hfRepo: "mradermacher/Qwen3-4B-Fiction-On-Fire-Series-7-Model-1004-i1-GGUF", supportsThinking: true },
  { id: "kaggle/thedrummer-rocinante-x-12b-v1", label: "Rocinante-X-12B-v1 (Q8_0)", provider: "kaggle", contextWindow: 16384, hfRepo: "TheDrummer/Rocinante-X-12B-v1-GGUF" },
  { id: "kaggle/mradermacher-l3-2-rogue-creative-instruct", label: "L3.2-Rogue-Creative-Instruct (F16)", provider: "kaggle", contextWindow: 16384, hfRepo: "mradermacher/L3.2-Rogue-Creative-Instruct-Uncensored-Abliterated-7B-GGUF" },
  { id: "kaggle/davidau-llama-3-2-8x3b-moe-dark-champion", label: "Llama-3.2-8x3B-MoE Dark-Champion", provider: "kaggle", contextWindow: 8192, hfRepo: "DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct" },
  { id: "kaggle/mradermacher-mars-27b-v-1", label: "Mars-27B-v1 (i1-Q5_K_S)", provider: "kaggle", contextWindow: 8192, hfRepo: "mradermacher/Mars_27B_V.1-i1-GGUF" },
  { id: "kaggle/mradermacher-broken-tutu-24b-i1-gguf", label: "Broken-Tutu-24B (i1-Q6_K)", provider: "kaggle", contextWindow: 8192, hfRepo: "mradermacher/Broken-Tutu-24B-i1-GGUF" },
  { id: "kaggle/mradermacher-synthia-s1-27b", label: "Synthia-S1-27B (Q5_K_M)", provider: "kaggle", contextWindow: 8192, hfRepo: "mradermacher/Synthia-S1-27b-GGUF", supportsThinking: true },
  { id: "kaggle/mradermacher-gemma4-garnetv2-31b", label: "Gemma4-Garnet-v2-31B (i1-Q4_1)", provider: "kaggle", contextWindow: 8192, hfRepo: "mradermacher/Gemma4-GarnetV2-31B-i1-GGUF" },
  { id: "kaggle/mradermacher-mag-mell-r1-21b", label: "Mag-Mell-R1-21B (Q8_0)", provider: "kaggle", contextWindow: 8192, hfRepo: "mradermacher/Mag-Mell-R1-21B-GGUF" },
  { id: "kaggle/thedrummer-fallen-gemma3-27b-v1-gguf", label: "Fallen-Gemma3-27B-v1 (Q5_K_M)", provider: "kaggle", contextWindow: 8192, hfRepo: "TheDrummer/Fallen-Gemma3-27B-v1-GGUF" },
  { id: "kaggle/thedrummer-big-tiger-gemma-27b-v3", label: "Big-Tiger-Gemma-27B-v3 (Q5_K_M)", provider: "kaggle", contextWindow: 8192, hfRepo: "TheDrummer/Big-Tiger-Gemma-27B-v3-GGUF" },
  { id: "kaggle/thedrummer-magidonia-24b-v4-3", label: "Magidonia-24B-v4.3 (Q6_K)", provider: "kaggle", contextWindow: 8192, hfRepo: "TheDrummer/Magidonia-24B-v4.3-GGUF" },
  { id: "kaggle/mradermacher-mistralsmallcreative", label: "MistralSmall-Creative-24B (Q8_0)", provider: "kaggle", contextWindow: 8192, hfRepo: "mradermacher/MistralSmall-Creative-24B-Realist-GGUF" },
  { id: "kaggle/mradermacher-gemma-the-writer-n-restless-quill-v2", label: "Gemma-Writer-Restless-Quill-v2 (F16)", provider: "kaggle", contextWindow: 8192, hfRepo: "mradermacher/Gemma-The-Writer-N-Restless-Quill-V2-Enhanced32-10B-Uncensored-GGUF" },
  { id: "kaggle/thedrummer-skyfall-31b-v4-2", label: "Skyfall-31B-v4.2 (Q4_K_M)", provider: "kaggle", contextWindow: 8192, hfRepo: "TheDrummer/Skyfall-31B-v4.2-GGUF" },
  // Newly added (matched to Kaggle runners nanovel-27b and the-creative-wordsmith-31b)
  { id: "kaggle/nanovel-27b", label: "NaNovel-27B (Q4_K_M)", provider: "kaggle", contextWindow: 8192, hfRepo: "mradermacher/NaNovel-27B-GGUF", supportsThinking: true },
  { id: "kaggle/the-creative-wordsmith-31b", label: "Creative-Wordsmith-31B (Q4_K_S)", provider: "kaggle", contextWindow: 8192, hfRepo: "llmfan46/gemma-4-Ortenzya-The-Creative-Wordsmith-31B-it-uncensored-heretic-GGUF" },
];


/** Format a context window like 131072 → "128K" */
export function formatContextWindow(tokens?: number): string {
  if (!tokens) return "";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1024) return `${Math.round(tokens / 1024)}K`;
  return `${tokens}`;
}

// Keep backward compat
export const MISTRAL_MODELS = AI_MODELS;

export const FICTION_TYPES = [
  // Literary
  "Literary Fiction", "Contemporary Fiction", "Upmarket Fiction",
  // Genre — Romance
  "Romance", "Contemporary Romance", "Historical Romance", "Paranormal Romance",
  "Romantic Suspense", "Dark Romance", "Reverse Harem", "Sports Romance",
  "Billionaire Romance", "Small Town Romance", "Enemies to Lovers",
  // Genre — Fantasy
  "Fantasy", "Epic Fantasy", "Urban Fantasy", "Dark Fantasy", "Grimdark",
  "Sword & Sorcery", "Portal Fantasy", "Cozy Fantasy", "Romantasy",
  "Progression Fantasy", "LitRPG", "GameLit",
  // Genre — Science Fiction
  "Science Fiction", "Hard Sci-Fi", "Space Opera", "Cyberpunk", "Solarpunk",
  "Biopunk", "Military Sci-Fi", "Post-Apocalyptic", "Dystopian",
  "First Contact", "Time Travel", "Alternate History",
  // Genre — Mystery / Thriller
  "Mystery", "Cozy Mystery", "Police Procedural", "Noir", "Whodunit",
  "Thriller", "Psychological Thriller", "Legal Thriller", "Medical Thriller",
  "Spy Thriller", "Techno-Thriller", "Political Thriller", "Domestic Thriller",
  // Genre — Horror
  "Horror", "Cosmic Horror", "Gothic Horror", "Supernatural Horror",
  "Slasher", "Body Horror", "Folk Horror", "Psychological Horror",
  // Genre — Historical
  "Historical Fiction", "Historical Mystery", "Historical Fantasy",
  "Regency", "Victorian", "Medieval", "Ancient World",
  // Genre — Action / Adventure
  "Action-Adventure", "Survival", "Heist", "Military Fiction",
  "Nautical Fiction", "Westerns",
  // Genre — Speculative
  "Speculative Fiction", "Magical Realism", "Weird Fiction",
  "New Weird", "Slipstream", "Afrofuturism",
  // Genre — Young Adult / Middle Grade
  "Young Adult (YA)", "YA Fantasy", "YA Sci-Fi", "YA Contemporary",
  "YA Romance", "Middle Grade",
  // Genre — Other Popular
  "Women's Fiction", "Book Club Fiction", "Family Saga",
  "Coming-of-Age", "Satire", "Humor / Comedy",
  "Erotica", "LGBTQ+ Fiction", "Multicultural Fiction",
  "Cli-Fi (Climate Fiction)", "Xianxia", "Wuxia", "Cultivation",
  "Isekai", "Light Novel", "Web Novel", "Fanfiction",
];

export function useAiSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AiSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setSettings(DEFAULTS);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from("user_ai_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("Load AI settings error:", error);
      } else if (data) {
        setSettings({
          model: data.model || DEFAULTS.model,
          temperature: Number(data.temperature) ?? DEFAULTS.temperature,
          top_p: Number(data.top_p) ?? DEFAULTS.top_p,
          chapter_number: Number(data.chapter_number) || DEFAULTS.chapter_number,
          fiction_type: data.fiction_type || "",
          fiction_type_enabled: !!data.fiction_type_enabled,
          perspective: data.perspective || "",
          word_count_min: Number(data.word_count_min) || DEFAULTS.word_count_min,
          word_count_max: Number(data.word_count_max) || DEFAULTS.word_count_max,
          brainstorm_model: data.brainstorm_model || DEFAULTS.brainstorm_model,
          thinking_enabled: data.thinking_enabled ?? DEFAULTS.thinking_enabled,
        });

      }
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  const updateSettings = useCallback(async (patch: Partial<AiSettings>) => {
    if (!user) return;
    const next = { ...settings, ...patch };
    setSettings(next);

    const { error } = await (supabase as any)
      .from("user_ai_settings")
      .upsert({
        user_id: user.id,
        model: next.model,
        temperature: next.temperature,
        top_p: next.top_p,
        chapter_number: next.chapter_number,
        fiction_type: next.fiction_type,
        fiction_type_enabled: next.fiction_type_enabled,
        perspective: next.perspective,
        word_count_min: next.word_count_min,
        word_count_max: next.word_count_max,
        brainstorm_model: next.brainstorm_model,
        thinking_enabled: next.thinking_enabled,
      }, { onConflict: "user_id" });


    if (error) console.error("Save AI settings error:", error);
  }, [user, settings]);

  return { settings, loading: loading, updateSettings };
}
