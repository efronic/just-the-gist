# GitHub Copilot Instructions for `just-the-gist`

Authoritative engineering guidelines for automated or AI-assisted contributions to this repository. Follow these rules by default; do not require the maintainer to repeat them. Keep PRs small, focused, and standards-compliant.

---

## 1. Project Overview

Chrome/Edge Manifest V3 extension that summarizes the current page (and optionally detected video transcript / cues) using Google Gemini.

Primary flows:

1. User clicks popup → choose mode + detail level → request summary.
2. User uses context menu entry.
3. Background script injects / messages content script → gathers structured extraction → builds adaptive prompt → calls Gemini API → returns structured result to popup.

Key Features:

- Adaptive summarization modes: `auto`, `page`, `video`.
- Detail levels: `concise`, `standard`, `detailed`, `expanded` (affect char limits, token budgets, formatting instructions, cue limits).
- YouTube transcript caching & replacement logic.
- SCSS + Tailwind + DaisyUI design system with generated theme tokens.

---

## 2. Repository Structure (Authoritative)

- `manifest.json` – Source manifest; a processed copy is emitted into `dist/manifest.json` during build with path adjustments.
- `scripts/` – Build & token generation logic.
  - `build.mjs` – Bundles TS with esbuild, compiles SCSS→CSS via Sass + Tailwind, copies static assets, re-emits manifest (removing leading `dist/` in path fields), watch mode support.
  - `design-tokens.mjs` – Source-of-truth design tokens; emits `src/styles/tokens.generated.scss` (DO NOT manually edit generated file).
- `src/`
  - `background.ts` – Context menu, runtime message handling, transcript cache usage, prompt assembly, Gemini call/continuations.
  - `contentScript.ts` – Extraction orchestration & message responder for `EXTRACT_PAGE`.
  - `extract/` – Extraction helpers (`mainText.ts`, `video.ts`). Keep pure & defensive.
  - `yt/` – YouTube-specific transcript fetch/parse helpers (`captions.ts`, `parse.ts`, etc.).
  - `gemini.ts` – Low-level Gemini API caller (`callGeminiRaw`). Keep dependency surface tiny.
  - `types/` – Centralized TypeScript type contracts for messages & extraction (`messages.ts`, `extract.ts`). Add new message types here first.
  - `styles/` – SCSS entry + generated tokens + design system layer.
  - `popup.*`, `options.*` – UI entry points (HTML + TS). The build rewrites/relocates into `dist/`.
- `dist/` – Fully ephemeral; always regenerated. NEVER commit or reference as source of truth.
- `docs/` – Supplementary typed/token documentation. Expand here for deeper internal docs, not in README.

---

## 3. Build & Tooling Conventions

Commands (npm scripts):

- `npm run build` – Full clean build (implicitly recreates `dist/`).
- `npm run watch` – Dev watch (rebuilds JS; SCSS tokens + Tailwind recompiled on watched changes).
- `npm run lint` / `lint:fix` – ESLint TS/JS.
- `npm run lint:css` / `lint:css:fix` – Stylelint for SCSS.
- `npm run format` / `format:check` – Prettier.

Rules:

- Never hand-edit files under `dist/` or `src/styles/tokens.generated.scss`.
- Always regenerate if touching tokens: `npm run build` (script auto-emits tokens before Tailwind compilation).
- Esbuild targets Chrome 114+ / Edge 114+; assume modern ESM environment (no CommonJS additions unless absolutely required).

---

## 4. Type & Messaging Contracts

Central message types: `src/types/messages.ts`.

- Discriminated unions with `type` string literal. Always extend there before usage.
- Provide type guards (`isFooMessage`) when adding a new discriminant.
- Validate minimal shape; fail fast & return structured `{ ok: false, error }` where possible.

Extraction types: `src/types/extract.ts`.

- Keep additions backwards-compatible; prefer optional fields vs. structural change.
- If expanding `ExtractedPage` or `ExtractedVideo`, update prompt builder in `background.ts` & any logic in `buildPrompt` referencing new semantics.
- Respect existing char/ cue limit constants; if adding detail levels, update all limit maps + style instructions + popup UI selection.

---

## 5. Prompt Assembly & Gemini Use

`buildPrompt` (in `background.ts`) is the single source of summarization formatting.
Guidelines when modifying:

- Keep deterministic structure; additions belong in clearly labeled sections.
- Avoid uncontrolled length expansion; adjust `maxTokensByDetail` if output sections grow.
- Changes affecting content classification heuristics must stay cheap (regex only, small prefix slice, no network calls).
- Continuation logic: Only modify heuristic (`looksTruncated`) if false positives/negatives emerge. Keep attempt cap small (<=2) for latency.

`gemini.ts` guidelines:

- Keep API client stateless & minimal: pure function `callGeminiRaw({ apiKey, model, input, maxOutputTokens })`.
- Use native `fetch`; avoid adding broad HTTP libraries.
- Validate candidate presence; gracefully surface Gemini finish reason.

---

## 6. SCSS / Design System

- All raw token values live in `design-tokens.mjs`. Add palette/theme values there.
- Generated SCSS variables + CSS custom properties go into `tokens.generated.scss` – never edit manually.
- `design-system.scss` consumes tokens, sets component primitives. Keep layering: tokens (generated) → base resets → utilities → component classes.
- Prefer semantic custom properties (e.g., `--color-primary`) rather than hard-coded hex in authored SCSS.
- Dark/alt themes: extend via `themes` object in tokens script, not inline CSS.

---

## 7. Logging & Diagnostics

- Use `dlog` / `dwarn` from `log.ts` in the content context only (keeps prefix `[gist][content]`). For background additions, consider a separate tag prefix if noise increases.
- Avoid noisy logs in production-critical loops (e.g., per-cue processing). Use conditional heuristics or level gating if needed.

---

## 8. Adding New Features (Workflow Template)

1. Define/extend types in `src/types/...` first.
2. Add message discriminant + type guard if runtime messaging involved.
3. Implement background handling (validate inputs early; wrap errors to user-friendly message).
4. Update content script extraction only if raw data is required for prompt (keep minimal to reduce injection cost).
5. Extend prompt builder sections—keep ordering stable; document rationale in a short code comment.
6. UI: wire popup controls → send `chrome.runtime.sendMessage` with new fields.
7. Lint & format; run build; manual smoke in a test tab.
8. Update `README.md` (features) & optionally `docs/` for deeper detail.
9. Add guidance to this `COPILOT.md` only if introducing a new cross-cutting pattern.

---

## 9. Performance & Limits

- Extraction truncates page text to 30k chars early; prompt builder then slices again per detail level. Keep both stages (defense-in-depth).
- Cue limits: set in both `extract.ts` and `buildPrompt`. If adjusting, ensure they remain coherent.
- Avoid synchronous heavy DOM traversal expansions—current selectors are bounded (`h1..h6, p, li, blockquote`).
- No external dependencies for classification heuristics—regex only.

---

## 10. Error Handling Principles

- User-facing errors: concise, actionable ("Missing API key", "Cannot summarize this page type").
- Internal errors: console warnings okay; do not leak stack traces to user surfaces.
- Retry logic: Only where needed (content script injection; Gemini truncation continuation). Keep attempt counters explicit & capped.

---

## 11. Security & Privacy

- API keys live in `chrome.storage.sync`; never log them or embed defaults.
- Do not persist full transcript or large page text beyond in-memory unless explicit caching policy is added (currently only YouTube transcript cache by video ID in `chrome.storage.local`).
- Host permissions are broad (`https?://*/*`). When adding network fetches for transcripts/subresources, validate origin necessity; constrain if feasible.

---

## 12. Code Style & Quality Gates

Automated requirements before merging (Copilot or human):

- Pass ESLint / Stylelint / Prettier (`npm run lint`, `lint:css`, `format:check`).
- No changes inside `dist/` (should not be committed).
- No unreferenced dead code / unused exports (remove promptly).
- TypeScript passes implicit build via `esbuild` (no TS errors). If adding new TS config rules, document rationale in `tsconfig.json` comment.
- Keep functions small & composable (< ~80 loc unless strongly justified).

Preferred patterns:

- Narrow object destructuring at top of function for clarity.
- Early returns for error states.
- Pure utility functions in their own small modules if reused.

---

## 13. Commit & PR Conventions

Commit message style (imperative, scoped):

```
feat(prompt): add academic content type heuristics
fix(extract): guard against null innerText access
chore(tokens): introduce neutralAlt color
```

PR Template (implicit):

- Summary (1–2 sentences)
- Motivation / context
- Changes list
- Testing notes (manual steps / screenshots if UI)
- Follow-ups (if any)

Keep PR size: aim < 400 lines diff (excluding generated code). Split large features into: types + background plumbing, extraction changes, UI wiring, prompt adjustments.

---

## 14. Testing & Manual Validation

Manual smoke checklist for summarization changes:

- Page-only summary (article blog) – expect TL;DR + bullets.
- Video (YouTube with transcript) – verify cue inclusion count matches detail level.
- Video with missing transcript – fallback behavior noted.
- Entertainment classification (e.g., trailer) – ensures "no action items" language.
- Meeting-like or tutorial page – proper action items produced only when applicable.

If adding automated tests (future improvement): prefer lightweight pure function tests (e.g., `buildPrompt` classification heuristics) using Node + ts-node without bundling.

---

## 15. Adding a New Detail Level (Example Procedure)

1. Add to `DETAIL_LEVELS` in `extract.ts` & exported type.
2. Expand char limits (`PAGE_CHAR_LIMIT`, `CUE_LIMIT` + local maps in `background.ts`).
3. Extend `styleInstructions` & possibly token budgets `maxTokensByDetail`.
4. Update popup UI selection + default handling fallback.
5. Re-run build; verify no mismatch between stored `DETAIL_LEVEL` and UI list.

---

## 16. Adding a New Platform Extraction (e.g., Vimeo)

1. Extend `VideoPlatform` union + `VIDEO_PLATFORM` constant.
2. Implement lightweight detector + transcript fetch (if public API or timed text available) in `yt/` sibling folder (rename folder to `videoPlatforms/` if >1 platform).
3. Normalize to existing `ExtractedCue` & `HasVideo` shape.
4. Update prompt builder to mention platform (already surfaces `sourcePlatform`).
5. Add caching logic if transcripts large (mirror YouTube pattern with namespaced key).

---

## 17. Safe Extension Packaging

- Always load unpacked from project root (Chrome will read `dist/manifest.json` produced by build when selecting root folder because `dist/` contains the runtime artifacts). If Chrome instead loads source manifest, ensure `dist/manifest.json` exists – run build first.
- Validate that `manifest.json` fields referencing `dist/` assets are stripped in emitted manifest (build script handles). If new fields are added, update `emitManifestForDist` to strip `dist/` prefix.

---

## 18. Dependency Policy

- Keep zero runtime third-party libraries in bundle unless essential.
- Dev deps only: build (esbuild, sass, tailwind), linting, typing. Avoid large polyfill libs (target modern Chrome/Edge).
- Before adding a dependency: justify size/benefit & note alternative considered.

---

## 19. Common Pitfalls (Avoid)

- Forgetting to update both extraction constants and prompt maps after adding detail level.
- Editing generated SCSS tokens manually (will be overwritten or drift).
- Adding synchronous heavy loops over large DOM subsets.
- Returning raw unvalidated runtime messages (must pass `isRuntimeMessage`).
- Logging API key or raw full prompt (may contain large content; log only high-level diagnostics if needed).

---

## 20. Future Enhancements (Backlog Hints)

(Non-binding; do not implement without issue approval.)

- Automated unit tests for `buildPrompt` classification.
- More granular transcript continuation (chunked summarization for very long videos).
- Optional per-site extraction adapter architecture.
- i18n base scaffolding for UI labels.

---

## 21. When Unsure

- Prefer adding a short inline comment with rationale for non-obvious decisions.
- Keep changes minimal & reversible.
- Open a draft PR early if architectural.

---

## 22. Quick Reference Checklist (Pre-PR)

- [ ] Types updated first
- [ ] Prompt builder updated (if needed)
- [ ] UI wired & messages validated
- [ ] Build passes, no `dist/` edits committed
- [ ] Lint + format clean
- [ ] Manual smoke tests (page + video) done
- [ ] Docs updated (README or `docs/` or this file)

---

Happy summarizing.
