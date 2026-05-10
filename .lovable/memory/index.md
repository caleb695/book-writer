# Project Memory

## Core
"Loom & Ink" — AI book writing app. Mistral API for generation. Supabase backend. Newsreader serif for content, Geist for UI.
Five-tab bottom nav: Files, Development, Style, AI, Document. All tabs persist state.
Two-layer memory: Memori (semantic triples) + UltraContext (context assembly). Practice mode with judge panel.

## Memories
- [Project overview](mem://project/overview) — App purpose and high-level architecture
- [UI navigation](mem://ui/navigation) — Five-tab layout details
- [Typography](mem://style/typography) — Newsreader serif + Geist fonts
- [Auth provider](mem://auth/provider) — Google OAuth + username/password via Supabase
- [Database schema](mem://tech/database-schema) — Projects, uploaded_files, ai_messages, user_ai_settings tables
- [AI integration](mem://tech/ai-integration) — Mistral API setup and model selection
- [AI generation logic](mem://features/ai-generation-logic) — Single-pass streaming with planning+drafting
- [AI writing flow](mem://features/ai-writing-flow) — Markdown rendering, chapter workflow
- [Style training](mem://features/style-training) — File upload and style analysis pipeline
- [Style memory system](mem://features/style-memory-system) — Memori semantic triples + UltraContext assembly + practice mode + lag detection
- [Development tab](mem://features/development-tab) — Chat interface for story architecture
- [Document editor](mem://features/document-editor) — Search/replace, word counter, scroll-to-bottom
- [Manuscript export](mem://features/manuscript-export) — Plain text export
- [File requirements](mem://features/file-requirements) — Supported upload formats
- [Persistence](mem://features/persistence) — Auto-save to Supabase
