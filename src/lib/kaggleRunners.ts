// Per-model Kaggle runner notebook slugs (owned by mynameishiiii). Each runner
// loads the GGUF from its attached download notebook's /kaggle/input/<slug>/
// output, then starts an OpenAI-compatible llama-cpp-python server on port
// 8000 exposed via cloudflared. The runner writes
// /kaggle/working/loomink_endpoint.json with { tunnel_url, api_key }.
export const KAGGLE_RUNNER_USER = "mynameishiiii";

export const KAGGLE_RUNNER_SLUGS: Record<string, string> = {
  "kaggle/sophosympatheia-magistry-24b-v1-1": "sophosympatheia-magistry-24b-v1-1",
  "kaggle/thedrummer-cydonia-24b-v4-3": "thedrummer-cydonia-24b-v4-3",
  "kaggle/pygmalionai-pygmalion-3-12b": "pygmalionai-pygmalion-3-12b",
  "kaggle/mradermacher-gemma3-27b-it-vl-glm-4-7": "mradermacher-gemma3-27b-it-vl-glm-4-7",
  "kaggle/mradermacher-qwen3-4b-fiction-on-fire-series-7": "mradermacher-qwen3-4b-fiction-on-fire-series-7",
  "kaggle/thedrummer-rocinante-x-12b-v1": "thedrummer-rocinante-x-12b-v1",
  "kaggle/mradermacher-l3-2-rogue-creative-instruct": "mradermacher-l3-2-rogue-creative-instruct",
  "kaggle/mradermacher-mars-27b-v-1": "mradermacher-mars-27b-v-1",
  "kaggle/mradermacher-broken-tutu-24b-i1-gguf": "mradermacher-broken-tutu-24b-i1-gguf",
  "kaggle/mradermacher-synthia-s1-27b": "mradermacher-synthia-s1-27b",
  "kaggle/mradermacher-gemma4-garnetv2-31b": "mradermacher-gemma4-garnetv2-31b",
  "kaggle/mradermacher-mag-mell-r1-21b": "mradermacher-mag-mell-r1-21b",
  "kaggle/thedrummer-fallen-gemma3-27b-v1-gguf": "thedrummer-fallen-gemma3-27b-v1-gguf",
  "kaggle/thedrummer-big-tiger-gemma-27b-v3": "thedrummer-big-tiger-gemma-27b-v3",
  "kaggle/thedrummer-magidonia-24b-v4-3": "thedrummer-magidonia-24b-v4-3",
  "kaggle/mradermacher-mistralsmallcreative": "mradermacher-mistralsmallcreative",
  "kaggle/mradermacher-gemma-the-writer-n-restless-quill-v2": "mradermacher-gemma-the-writer-n-restless-quill-v2",
  "kaggle/thedrummer-skyfall-31b-v4-2": "thedrummer-skyfall-31b-v4-2",
  "kaggle/fallenmerick-mn-violet-lotus-12b": "fallenmerick-mn-violet-lotus-12b",
  "kaggle/davidau-lfm2-5-1-2b-thinking-claude-4-6-opus": "davidau-lfm2-5-1-2b-thinking-claude-4-6-opus",
  "kaggle/davidau-llama-3-2-8x3b-moe-dark-champion": "davidau-llama-3-2-8x3b-moe-dark-champion-instruct",
  "kaggle/nanovel-27b": "nanovel-27b",
  "kaggle/the-creative-wordsmith-31b": "the-creative-wordsmith-31b",
};


export const kaggleRunnerUrl = (modelId: string) => {
  const slug = KAGGLE_RUNNER_SLUGS[modelId];
  return slug ? `https://www.kaggle.com/code/${KAGGLE_RUNNER_USER}/${slug}` : null;
};
