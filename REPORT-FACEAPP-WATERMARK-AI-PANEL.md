# Technical Deep-Dive Report — Items 8, 9, 10

**Scope.** This report evaluates the most efficient delivery path for three deferred items before any implementation begins:

| # | Feature | Spec |
|---|---|---|
| 8 | Admin AI & Intelligence Review | Centralized admin visibility into all AI modules (face models, chatbot, filters), with control over their algorithms. |
| 9 | FaceApp-style Feature Expansion | Makeup looks, hair volume adjustments, impressions, retouching. |
| 10 | Watermark & Scratch Remover | Robust watermark removal + scratch/imperfection removal for old photos. |

Per direction: **prefer the existing 15-key API pool**, fall back to **lightweight open-source local models only when an API route is genuinely unavailable**, and only commit to integration after this analysis.

---

## 1. Current capabilities of the 15-key pool

The pool is governed by `artifacts/api-server/src/lib/provider-key-manager.ts` and routes to four groups:

| Group | Models | Capability class |
|---|---|---|
| **primary** (OpenRouter) | `bytedance/seedance-2.0`, `alibaba/wan-2.7`, `inclusionai/ling-2.6-flash:free`, `moonshotai/kimi-k2.5` | LLM + vision **analysis** (text + image understanding) |
| **standard** (OpenRouter) | `stepfun/step-3.5-flash:free`, `tencent/hy3-preview:free`, `nvidia/nemotron-3-super-120b-a12b:free`, `nvidia/nemotron-3-nano-30b-a3b:free`, `z-ai/glm-4.5-air:free`, `openai/gpt-oss-120b:free` | LLM + vision **analysis** |
| **nvidia** (direct API) | `moonshotai/kimi-k2.5`, `minimaxai/minimax-m2.5`, `nvidia/nemotron-3-super-120b-a12b` | LLM + vision **analysis** |
| **gemini** (fallback, premium-only) | `gemini-2.0-flash` | LLM + vision **analysis** |

### Key insight

> **All 15 keys are LLM / vision-language *analysis* APIs. None of them perform image generation, inpainting, makeup application, or watermark removal.**

They can describe a face ("subject is wearing red lipstick, hair appears flat") and classify damage ("photo has visible scratches in upper-left quadrant"), but they cannot produce a modified image. This is the same constraint that drove the existing GFPGAN / CodeFormer / Real-ESRGAN sidecar — those are **manipulation** models running locally because no manipulation API exists in the pool.

This means items 9 and 10 cannot be served end-to-end by the existing keys alone. The keys can still play a *supporting* role (segmentation guidance, damage detection, prompt construction), but a **manipulation provider** is required regardless.

---

## 2. Item 8 — Admin AI & Intelligence Review

### What's already in place

`artifacts/api-server/src/routes/admin.ts` already exposes:

- `GET /admin/keys` — full key catalog with status, latency, total calls, errors
- `GET /admin/keys/usage-report` — per-group + per-model usage rollup with recommendations
- `POST /admin/keys/load-from-env` and `/validate-all` — manual key lifecycle controls
- `PATCH /admin/keys/:id/status` and `/tier` — runtime promotion / suspension

The frontend `pages/admin.tsx` already calls these endpoints.

### Gap analysis

The admin panel surfaces *infrastructure* (keys, latency, errors) but does not yet centralize the *AI capability* layer:

| Layer | Visible today? | Required addition |
|---|---|---|
| LLM/vision keys + groups | ✅ Yes | — |
| Sidecar models (GFPGAN / CodeFormer / Real-ESRGAN) | ❌ No | New endpoint `GET /admin/ai-models` returning sidecar registry |
| Filter pipeline (`@workspace/filter-registry`) | Partial | New endpoint exposing tier flags, premium filter list |
| Chat assistant (`ai-chat-widget.tsx`) | ❌ Not metered | Wire chat replies through `provider-key-manager` so they show up in `usage-report` |
| Per-feature toggles (e.g. disable Codeformer cluster-wide) | ❌ No | New `ai_capabilities` config table; admin UI to toggle |

### Recommended path (no model integration needed — pure UI / API surfacing)

**Effort:** ~1 session (small/medium).
**Cost:** none.
**Risk:** none — read-mostly admin endpoints over existing in-memory registries.

1. Add `artifacts/api-server/src/routes/admin.ts` endpoint `GET /admin/ai-capabilities` that joins:
   - `providerKeyManager.getSafeEntries()` (already exists)
   - A new sidecar inventory (hardcoded list of GFPGAN/CodeFormer/Real-ESRGAN/Old-Photo-Restore + their `services/restoration/server.py` health probe)
   - Filter registry summary from `@workspace/filter-registry`
2. Add a new admin tab "AI & Intelligence" in `artifacts/glimpse-ai/src/pages/admin.tsx` that renders four panels: Vision Keys / Sidecar Models / Filters / Chat — each with cards showing model id, status, last call, error rate.
3. Add a single feature flag table `ai_capability_flags(name TEXT PRIMARY KEY, enabled BOOLEAN)` and have media routes consult it to allow runtime kill-switching of, e.g., `codeformer` or `auto_face` without redeploying.

### Verdict — Item 8

**Ship as a pure admin UI / API task. No new ML, no new costs. Highest-confidence delivery.**

---

## 3. Item 9 — FaceApp-style features (makeup, hair, retouching)

### What "FaceApp-like" actually means

| Sub-feature | Type of operation |
|---|---|
| Lipstick / eyeliner / blush "makeup looks" | Region-mask + colored overlay or generative blend |
| Hair volume adjustment | Mask + style-transfer or generative resampling |
| Skin retouch (smoothing, blemish removal) | High-frequency separation or generative repair |
| "Impressions" (mood / age preset) | Generative, full-image conditioning |

Some of these are achievable with *procedural image processing* (Sharp + face landmarks + mask compositing) — they look acceptable and ship today. The rest genuinely need a generative model.

### Route A — API-first (commercial third-party)

| Provider | Coverage | Pricing (May 2026 retail) | Latency |
|---|---|---|---|
| **Replicate** (`tencentarc/photomaker`, `lucataco/sdxl-controlnet-lora`) | All four | ≈ $0.0011 per second; 3–8s typical → **$0.003–0.01 per image** | 4–10s cold, 2–4s warm |
| **Stability AI** (Image Edit / Inpaint) | All four | $0.04 per generation | 2–5s |
| **NVIDIA Maxine GFx Cloud** | Beauty filters, retouch | Enterprise contract; not retail | 100–300ms (real-time grade) |
| **Modiface SDK** (L'Oréal) | Makeup only | License negotiation; high MOQ | 50ms (client-side WASM) |
| **PerfectCorp YouCam SDK** | Makeup, hair | Per-MAU license; non-trivial NDA | 50–200ms |

Net: **only Replicate is realistically self-serve and pay-as-you-go for an indie launch.** Stability is fine for high quality but ~10× the cost. Modiface / PerfectCorp / Maxine require a sales contract and aren't suitable for a pre-launch indie product.

The 15 existing keys do **not** cover any of these — adding Replicate requires a new key (one secret, REST API, fits naturally into `provider-key-manager` as a new group).

### Route B — Local lightweight model

| Stack | Disk | RAM (CPU) | VRAM | Latency (CPU) | Quality |
|---|---|---|---|---|---|
| **MediaPipe FaceMesh + procedural overlay** | ≈10 MB | <500 MB | n/a | 100–400ms | Decent for makeup; poor for hair / retouch |
| **InsightFace + procedural blend** | ≈300 MB | <1 GB | n/a | 200–800ms | Better for landmark precision; same expressivity ceiling |
| **LaMa + face-parsing** (BiSeNet) | 250 MB | 1 GB | n/a | 1–3s | Strong for retouch / blemish removal |
| **InstructPix2Pix (SD 1.5)** | 4.5 GB | 8 GB | 6 GB **(GPU required for sub-30s latency)** | 30–90s on CPU — impractical | High |
| **Stable Diffusion + ControlNet (face)** | 5–7 GB | 12 GB | 8 GB **(GPU required)** | 60–180s on CPU — impractical | Highest |

**The "Gemma-4 or similarly efficient" reference is misleading here** — Gemma is an LLM, not an image generator. The lightest *image-generation* model that is both (a) open-source-licensed for commercial use and (b) CPU-runnable in <10s does not exist as of May 2026. Anything generative requires GPU.

### Recommended path

**Hybrid, in two phases:**

**Phase 1 (lightweight, ships in 1 session, no GPU dependency):**
- MediaPipe FaceMesh in the existing `services/restoration/server.py` Python sidecar.
- Procedural makeup (lipstick, eye liner, blush) via face-landmark masks + blended fills.
- Skin retouch via Sharp `median` + frequency-separation pass (already partially done in `image-enhancer.ts` for `auto_face`).
- Hair volume **NOT** shipped in Phase 1 — needs generative.
- Cost: **$0** ongoing. ~250MB additional sidecar weight (MediaPipe).

**Phase 2 (generative, ships when budget approved):**
- Add **Replicate** as a new provider group in `provider-key-manager`.
- Models: `tencentarc/photomaker` for retouch / impressions; `lucataco/sdxl-controlnet-lora` for hair.
- Per-image cost ~$0.003–0.01 → free tier should not have access; gate behind paid plans.
- Latency 3–10s → matches the existing GFPGAN flow; no UX regression.

### Verdict — Item 9

**Phase 1 (procedural makeup + retouch via MediaPipe + Sharp) ships now.** Phase 2 (generative hair + impressions) waits on a Replicate billing decision; the architecture supports it via the existing `provider-key-manager` so the integration is a 1-day add when approved.

---

## 4. Item 10 — Watermark + scratch removal

### What is needed

Both reduce to the same primitive: **inpainting** — fill a masked region with content consistent with the surrounding image. Differences:

- **Watermark:** mask is text/logo, often translucent, sometimes user-marked.
- **Scratch:** mask is thin random strokes, detectable from local high-frequency analysis.

### Route A — API-first

| Provider | Approach | Pricing | Notes |
|---|---|---|---|
| **Cleanup.pictures API** | Brush-mask + LaMa | $0.25 per call (no free tier) | Good quality, simple API |
| **Replicate `cjwbw/big-lama`** | Auto / user mask + LaMa | $0.0011/s × ~2s = $0.002 per image | Excellent value |
| **Stability AI Erase** | Mask + diffusion inpaint | $0.04 / call | Highest quality, highest cost |
| **Picwish API** | Auto watermark detection + remove | Per-image; volume tiers | Good for known watermark patterns |

Same observation as item 9: Replicate is the indie-friendly self-serve option, and again **none of the existing 15 keys cover this**.

### Route B — Local LaMa

[LaMa (Large Mask Inpainting)](https://github.com/advimman/lama) is the gold-standard open-source inpainting model:

| Metric | Value |
|---|---|
| Disk | 200 MB (`big-lama`) |
| RAM (CPU) | 1.5 GB peak |
| VRAM (GPU) | 800 MB if available |
| Latency, 1024×1024, CPU | 2–5s |
| Latency, 1024×1024, GPU | 200–400ms |
| Licence | Apache 2.0 — commercial-safe |
| Quality | State-of-the-art for non-generative inpainting |

LaMa drops cleanly into the existing Python sidecar (the same architecture already runs Real-ESRGAN). The mask source is the only delta:

- **Scratch removal:** auto-detect via the existing damage heuristic (`fadedChroma`, `flatContrast`, `softFocus` in `ai-provider.ts`) extended with a thin-feature pass.
- **Watermark removal:** offer two modes — (a) auto-detect text/logo via OCR (Tesseract.js client-side or Sharp + heuristic) for known formats, and (b) user-painted mask in the editor (canvas brush with eraser, similar to Adobe's "remove tool").

### Cost / latency comparison

| Route | $/image | Median latency | Disk | Failure-mode |
|---|---|---|---|---|
| Replicate LaMa | ~$0.002 | 1–3s | 0 | API outage |
| Local LaMa (CPU) | $0 | 2–5s | 200 MB | None — fully offline |
| Local LaMa (GPU, if available) | $0 | 200–400ms | 200 MB | GPU contention |

### Recommended path

**Local LaMa first, Replicate as fallback.**

1. **Local LaMa** in the Python sidecar — 200MB asset, fits the existing thin-client stance, $0 marginal cost. Ship behind `enhancementType: "watermark_remove"` and `enhancementType: "scratch_remove"`. Manual mask UI in editor for watermarks (best UX), auto-detected mask for scratches.
2. **Replicate fallback** wired through `provider-key-manager` so when sidecar is unavailable / overloaded, requests fall through to the API. Same pattern that already exists for vision LLMs.
3. **Both gated as Premium** in `tier-config.ts` — high quality + premium-only pricing supports the upgrade narrative we just shipped.

### Verdict — Item 10

**Local LaMa is the right primary route.** It's the rare case where the open-source model is *both* high quality *and* lightweight enough for thin-client (~250MB total impact, CPU-runnable in 2–5s). Replicate is the smart fallback for resilience. **Effort: ~1.5 sessions** (sidecar wiring + canvas brush UI + scratch auto-detection + tier gate).

---

## 5. Cross-cutting risks

| Risk | Mitigation |
|---|---|
| Adding Replicate adds a new failure surface | Reuse `provider-key-manager` cascade — existing degradation/health logic kicks in for free |
| Sidecar disk footprint grows (MediaPipe + LaMa = ~450 MB) | Already running ~2 GB of restoration models; this is +20%. Document a `MODELS_DIR` env so deployments can mount external storage |
| User-painted watermark mask UX is non-trivial | Use HTML5 `<canvas>` with brush + eraser. Existing `editor.tsx` is already at 3,900 lines — this would justify a sub-component split |
| Item 9 Phase 2 cost (~$0.005/image generative) at scale | Strict tier gating + monthly cap on generative jobs (separate from the standard credit cap) |
| Items 8, 9, 10 add admin surface complexity | Phase 1 of item 8 (read-only AI panel) ships first — gives admins visibility before runtime control complicates things |

---

## 6. Plan of action

| Phase | Items | Effort | New deps | Cost |
|---|---|---|---|---|
| **A** (next session) | Item 8 read-only admin AI panel | 1 session | None | $0 |
| **B** | Item 10 local LaMa + scratch auto-detect + manual watermark mask UI | 1.5 sessions | LaMa weights (200 MB) | $0 |
| **C** | Item 9 Phase 1: procedural makeup + retouch via MediaPipe | 1 session | MediaPipe (250 MB) | $0 |
| **D** *(needs budget approval)* | Replicate provider group integration | 0.5 session | Replicate API key | ≈ $0.003 / generative call |
| **E** *(needs budget approval)* | Item 9 Phase 2: generative hair + impressions | 1 session | Builds on D | per-call |
| **F** *(optional, on demand)* | Item 8 runtime kill-switch table + admin toggles | 0.5 session | None | $0 |

**Recommended go/no-go gate:** finish Phase A + B + C (3.5 sessions, all $0 marginal) and re-evaluate before approving D + E. By that point the local-only suite already covers the most-requested FaceApp features (lipstick, eyeliner, blush, retouch, scratch removal, watermark removal) and you have quantitative data on user demand for hair / impressions before paying per-call.

---

## 7. Decisions needed from you

1. **Phase A/B/C order.** Recommended order is A → B → C (admin visibility, then highest-impact $0 feature, then cosmetic). Confirm or reorder.
2. **Phase D budget.** Are you willing to add Replicate as a paid provider for generative work (Phase 2 hair + impressions)? Approve / hold / decline.
3. **Hosting target for Phase B.** LaMa sidecar fits the current self-hosted Python service. Confirm we'll deploy on the same node, or specify a separate machine.
4. **Watermark UX preference.** Two mask sources are possible: (a) user paints the mask with a brush in the editor, (b) auto-detect from common watermark patterns (text + logo OCR). Which to ship in v1? Recommended: ship (a) first (predictable quality), add (b) as enhancement.

Once these four are answered, I'll proceed with Phase A.
