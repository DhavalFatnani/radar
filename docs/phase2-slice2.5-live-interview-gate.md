# Phase 2 · Slice 2.5 — Live Interview Gate (operator checklist)

> **Status:** the interview pipeline is fully built and shipped (Slices 2.3/2c + 2.4).
> Slice 2.5 is a *verification gate*, not new code: **"end-to-end with a real vendor —
> does it pull genuinely precise data?"** Run this whenever you have an LLM key.
> It does not block the rest of the platform build.

## Prerequisite — configure one LLM provider

The SIA engine (`src/ai/sia`) makes live calls through a provider fallback chain
(`src/ai/llm/config.ts`). Configure **at least one** of these in `.env.local`, then
restart the dev server (env is read at boot):

| Provider | Env var | Notes |
|----------|---------|-------|
| Anthropic (default) | `ANTHROPIC_API_KEY` | first in the chain |
| OpenAI | `OPENAI_API_KEY` | |
| DeepSeek | `DEEPSEEK_API_KEY` | |
| xAI | `XAI_API_KEY` | |
| Ollama (local) | `OLLAMA_MODEL` | no key; local model name |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | |

**Caveat (same class as the bcrypt-hash gotcha):** `@next/env` runs dotenv-expand, so a
`$` in any value is treated as variable interpolation. API keys rarely contain `$`, but if
yours does, escape each as `\$` or the key will be silently corrupted and every call will
fail through the whole chain. After editing `.env.local`, **stop and restart** `npm run dev`.

## The gate — run end to end with a real vendor

1. **Pick or create a vendor stub** — `/vendors` → add a vendor (real one you can speak for),
   or open an existing one at `/vendors/<id>`.
2. **Start interview** — click **Start interview** on the vendor detail page.
   SIA's first question should appear (a live LLM call — if it errors, the key isn't loaded).
3. **Answer 5+ turns** — respond naturally; give real, specific figures (capacity, geographies,
   project-size range, lead times, differentiators). Watch the coverage panel fill in.
4. **Save & version** — click **Save & version**. You return to the vendor detail page at a
   **bumped `version`**, and `interview_history` gains an entry with
   `kind: "interview"` and the `interviewId` cross-link.
5. **Re-open** — click **Start interview** again; it should offer **"Re-interview · append & amend"**
   (not a fresh start), proving the completed session is recorded.
6. **Resume check** — start a new interview, answer 1–2 turns, **refresh the page mid-interview**:
   the session resumes with the transcript intact (`vendor_interviews.messages`).

## The judgment (the actual gate)

Open the vendor detail page and read the extracted profile. **Pass = the interview pulled
genuinely precise, vendor-specific data** — concrete capabilities, real geographies, actual
project-size range and constraints — **not vague/generic filler**. If answers are precise but
extraction is mushy, that's an `extractProfile` prompt-quality signal to log for a later slice.

## Where the evidence lives (for your records)

- **Transcript:** `vendor_interviews.messages` (full `LlmMessage[]`, area-tagged turns) for that `interview_id`.
- **Extracted profile + audit:** `vendor_profiles` row (the versioned fields) and its
  `interview_history` entry (`changed[]`, `version`, `interviewId`, `provider`).
- `vendor_interviews.resulting_version` + `provider` record which version the interview produced and which LLM did the extraction.

Capturing a screenshot of the thread + the resulting profile diff is enough to mark Phase 2 done.
