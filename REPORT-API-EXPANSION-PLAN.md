# Report — API Expansion & Open-API Leverage Plan

**Status.** Companion to (and partial supersession of) `REPORT-FACEAPP-WATERMARK-AI-PANEL.md`. Refines the prior assessment with live May 2026 catalog data for OpenRouter and NVIDIA NIM, corrects an inaccurate classification of two existing keys, and lays out a phased rollout that prefers existing free-tier APIs before any local model expansion.

**Scope of this report:** image manipulation (generation, edit, inpaint, style transfer, makeup/retouch, watermark removal, colorization). Video generation is included where the same key/model unlocks both surfaces.

---

## 1. Open-API Exploration — what's actually available now

### 1.1 OpenRouter — 2026 catalog (image-capable)

OpenRouter has moved well beyond pure LLM/vision-language models. As of May 2026 the relevant **image-capable** offerings split into two families:

#### Generative / edit / inpaint family

| Model | Capability | Pricing | Notes |
|---|---|---|---|
| **Google Nano Banana Pro** (`google/gemini-3-pro-image-preview`) | Generate, edit, **localized inpaint**, style transfer, multi-image blend (up to 5 subjects), 2K/4K out | Token-based; ~$0.08–0.12 per 1024² image (Pro tier) | Industry-leading text-in-image and identity preservation |
| **Google Nano Banana 2** (`google/gemini-3.1-flash-image-preview`) | Same family, "Pro-level visual quality at Flash speed" | $0.50/M input + $3/M output ≈ **~$0.005/image** | **Best price/quality on the market** for edit + inpaint |
| **Google Nano Banana** (`google/gemini-2.5-flash-image`) | Generate + edit + multi-turn | $0.30/M input + $2.50/M output ≈ **~$0.004/image** | Stable, GA, well-documented |
| **ByteDance Seedream 4.5** (`bytedance-seed/seedream-4.5`) | Edit-focused: subject preservation, lighting, color tone, portrait refinement, small-text rendering | **$0.04 / image, flat** | Strong for photo retouch / portrait edit |
| **OpenAI GPT-5.4 Image 2** | Reasoning + image generation, OpenAI tooling | Token-based, premium pricing | Best for prompt-engineered generative workflows |

#### Video generation family — **already in our key pool but mis-classified as analysis-only**

| Model | We already hold a key? | Real capability |
|---|---|---|
| **ByteDance Seedance 2.0** (`bytedance/seedance-2.0`) | ✅ `PRIMARY_MODELS` | Text-to-video, **image-to-video with first/last-frame control**, multi-modal reference (text + image + audio + video), 4–15s clips, 480p / 720p / 1080p |
| **Alibaba WAN 2.7** (`alibaba/wan-2.7`) | ✅ `PRIMARY_MODELS` | First/last-frame control, up to 15s, **instruction-based video editing** (change BG / lighting / style via natural language), 1080p max |

> **Material correction to the prior report.** The earlier Items-8/9/10 deep-dive labelled these two keys as "LLM + vision analysis." That's wrong. Both are video-generative. We're already paying for (or have free credits on) two top-tier 2026 video-generation endpoints — they unlock several roadmap items at zero net new spend.

#### Free vision-capable text models (already on us)

`stepfun/step-3.5-flash:free`, `tencent/hy3-preview:free`, `nvidia/nemotron-3-super-120b-a12b:free`, `inclusionai/ling-2.6-flash:free`, **plus newly available** `google/gemma-4-26b-a4b-it:free` and `google/gemma-4-31b-it:free` (released April 2026, Apache 2.0, accept text + image + up to 60s video). These remain analysis-only — useful for classification, prompt construction, and as cheap describe-then-edit pre-processors.

### 1.2 NVIDIA NIM (build.nvidia.com) — 2026

NVIDIA's hosted Visual Generative AI catalog now exposes OpenAI-compatible image edit endpoints:

| Model | Capability | Pricing | Free tier |
|---|---|---|---|
| **FLUX.1-Kontext-dev** (Black Forest Labs) | In-context generate + **inpaint + character consistency + style transfer** | Pro: $0.04/img · Max: $0.08/img | ✅ Self-hostable; non-commercial pre-set; commercial via BFL contract |
| **FLUX.1-dev / Schnell** | Text-to-image | Token / credit billed | Self-host friendly |
| **Stable Diffusion 3.5 Large** | Text-to-image | NVIDIA credit billed | — |
| **Qwen-Image-Edit** | **Multilingual text editing in images, strong subject consistency** | NVIDIA credit billed | ✅ Available since 30 Apr 2026 |
| **TRELLIS** | Image-to-3D | Credit billed | — |

**Free-tier mechanics for build.nvidia.com:**
- 1,000 free API credits on signup
- Up to **5,000 cumulative free credits** by requesting more in profile
- **+4,000 bonus credits** if you attach a business email (also unlocks a 90-day NVIDIA AI Enterprise license)
- Self-hosting NIM containers is free under the NVIDIA Developer Program for research/testing

For our scale (~hundreds of edits per day during launch), the free credit pool is enough to validate a feature for ~2 weeks before paid scaling decisions are needed.

### 1.3 Fallback / pure-PaaS options

| Provider | Why we'd use it | Pricing |
|---|---|---|
| **Replicate** `allenhooo/lama` | Pure inpaint fallback (LaMa) when sidecar can't run | **$0.00047/run**, ~3s on T4 (~$0.50 buys 1,000 calls) |
| **Replicate** `tencentarc/photomaker` | Identity-preserving generative retouch / impressions | ~$0.003–0.01/img |
| **Replicate** `lucataco/sdxl-controlnet-lora` | Hair / pose / structural edits | ~$0.003–0.01/img |
| **Stability AI** Image Edit + Erase | Highest-quality inpaint, broad style coverage | $0.04/call |
| **Cleanup.pictures** | Brush+LaMa, simplest API | $0.25/call |
| **Picwish** | Auto watermark detection | Per-call, volume tiers |

**Replicate LaMa pricing has dropped ~5× since the prior report** ($0.00047 vs $0.002), making it materially more attractive as a fallback.

---

## 2. Gap Analysis — features × current capability

### 2.1 What our existing 15-key pool plus 1× Gemini key gives us today

| Capability class | Existing coverage | Notes |
|---|---|---|
| **Vision/image analysis** (describe, classify, recommend, damage probe) | ✅ Full | 6 free + 4 primary + 3 NVIDIA-direct + Gemini fallback |
| **Video generation** (text→vid, img→vid, video edit) | ✅ Underused — Seedance 2.0 + WAN 2.7 already keyed | We pay for them today and route them only to analysis |
| **Image generation** (text-to-image, fresh from prompt) | ❌ None on existing keys | Gap — closest is Gemini text → describe-only |
| **Image edit** (apply textual instruction to an existing image) | ❌ None | Gap — biggest blocker for FaceApp-style features |
| **Localized inpaint** (mask + fill) | ❌ None | Gap — required for watermark/scratch removal at scale |
| **Style transfer** | ❌ None | Gap — required for "Cinematic Edit"-class non-color creative looks |
| **Identity-preserving retouch** | Local only (GFPGAN/CodeFormer/Real-ESRGAN) | Adequate for restoration; insufficient for cosmetic/age/expression edits |
| **Face landmark / mask generation** | None — would need MediaPipe sidecar | Required for procedural makeup / hair |

### 2.2 Items-8/9/10 against the new catalog

| Item | Required capability | Best fit on **existing** keys | Best fit overall |
|---|---|---|---|
| **8. Admin AI panel** | Pure UI/config | n/a — no model needed | Local UI (no change in plan) |
| **9a. Procedural makeup (lipstick, eyeliner, blush)** | Face landmarks + alpha overlay | None | Local MediaPipe (free) |
| **9b. Generative makeup / retouch / impressions** | Image edit with subject preservation | None | **Nano Banana 2** ($0.005/img) — beats prior plan's Replicate ($0.003–0.01) |
| **9c. Hair volume / restyle** | Generative restyle with mask + ControlNet | None | **FLUX.1-Kontext** (NVIDIA NIM, edit) or `lucataco/sdxl-controlnet-lora` (Replicate) |
| **10a. Scratch removal** | Auto-mask + inpaint (small mask) | None | **Local LaMa** (free, 200MB) → Replicate LaMa fallback ($0.00047/run) |
| **10b. Watermark removal** | User mask + inpaint (large mask) | None | Same as 10a; for ambiguous masks, **FLUX.1-Kontext** as quality boost |
| **Future: video Auto-Face on motion** | Image-to-video / video edit | ✅ **Seedance 2.0** + **WAN 2.7** | Already keyed — zero new spend |
| **Future: "make this photo move"** | Image-to-video | ✅ Same | Already keyed |

### 2.3 Cost envelope for the gap-closing models

If we pick **Nano Banana 2 + Local LaMa + Replicate LaMa fallback** as the new image-edit stack:

| Volume scenario | Per-image cost | 1,000 edits/mo | 10,000 edits/mo |
|---|---|---|---|
| Image edit (Nano Banana 2) | $0.005 | $5 | $50 |
| Inpaint, sidecar success | $0.000 | — | — |
| Inpaint, fallback to Replicate (~5% failure rate) | $0.00047 | $0.024 | $0.24 |
| **Blended monthly cost** | — | **~$5** | **~$50** |

For a paid plan priced at ₹399 (≈ $4.80) per 100 edits, gross margin remains positive even with 100% fallback usage. Free tier gates these features off entirely; this is what makes the unit economics work.

---

## 3. Integration Plan

### 3.1 Architectural fit — extend `provider-key-manager`, don't fork

The existing `provider-key-manager.ts` already supports group-based routing (`primary` / `standard` / `gemini` / `nvidia`) with a priority cascade, health checks, and per-key error tracking. The cleanest expansion is **two new groups** that mirror the existing pattern:

```ts
// Add to provider-key-manager.ts
group: "primary" | "standard" | "gemini" | "nvidia"
       | "image_edit"         // ← NEW: Nano Banana 2, Seedream 4.5
       | "image_inpaint";     // ← NEW: FLUX.1-Kontext (NIM), Replicate LaMa
```

Each group is a thin REST adapter. The existing cascade (priority + last-error suppression) gives us automatic failover for free.

### 3.2 New abstractions to add

| File | Purpose |
|---|---|
| `artifacts/api-server/src/lib/image-edit-provider.ts` | Provider-agnostic `editImage({ image, instruction, mask?, mode })` returning a `Buffer`. Routes to first healthy key in `image_edit` then `image_inpaint`. |
| `artifacts/api-server/src/lib/inpaint-provider.ts` | Same shape, but inpaint-specific (mask required). Local LaMa preferred → falls through to Replicate. |
| `services/restoration/lama_inpaint.py` | Sidecar route in the existing Python service — `POST /inpaint` with `{ image, mask }`. |
| `artifacts/api-server/src/routes/media.ts` | New enhancement types: `watermark_remove`, `scratch_remove`, `creative_edit`, `face_makeup`, `hair_restyle`. Each maps to one of the providers above. |
| `artifacts/glimpse-ai/src/components/mask-brush.tsx` | Canvas brush UI for user-painted masks (watermark + creative edit). |

### 3.3 Routing decisions (where each enhancement goes)

| Enhancement | Primary route | Secondary route | Tertiary route |
|---|---|---|---|
| `auto_face`, `face_restore`, `codeformer`, `hybrid` | Local sidecar (existing) | — | — |
| `scratch_remove` | Local LaMa (sidecar) | Replicate `allenhooo/lama` | — |
| `watermark_remove` | Local LaMa (sidecar) | FLUX.1-Kontext (NVIDIA NIM) | Replicate LaMa |
| `creative_edit` (text-instructed edit) | Nano Banana 2 (OpenRouter) | Seedream 4.5 (OpenRouter) | FLUX.1-Kontext (NIM) |
| `face_makeup` (procedural) | MediaPipe sidecar | — | — |
| `face_makeup_pro` (generative) | Nano Banana 2 | Seedream 4.5 | — |
| `hair_restyle` | FLUX.1-Kontext (NIM) | Replicate `lucataco/sdxl-controlnet-lora` | — |
| `colorize` (heritage photos) | Nano Banana 2 with templated prompt | Seedream 4.5 | Local sidecar (heuristic) |
| `image_to_video` (future) | Seedance 2.0 (already keyed) | WAN 2.7 (already keyed) | — |
| `video_text_edit` (future) | WAN 2.7 (already keyed) | — | — |

### 3.4 API key acquisition checklist

| Provider | Key format | Where to add |
|---|---|---|
| OpenRouter (already integrated) | `sk-or-v1-…` | Add `PROVIDER_KEYS_GOOGLE_GEMINI_3_1_FLASH_IMAGE`, `PROVIDER_KEYS_BYTEDANCE_SEEDREAM_4_5` to `.env`. The existing `loadFromEnv()` regex already handles this format. |
| NVIDIA NIM (already integrated) | `nvapi-…` | Reuse the existing nvapi key path. Add the FLUX.1-Kontext model id to `NVIDIA_DIRECT_MODELS`. |
| Replicate (new — fallback only) | `r8_…` | New `image_inpaint` group, gated behind `REPLICATE_API_KEY` env. |

### 3.5 Wire-up effort estimate

| Task | Effort |
|---|---|
| Extend `provider-key-manager` with `image_edit` + `image_inpaint` groups | 0.5 sess |
| `image-edit-provider.ts` (Nano Banana 2 + Seedream 4.5 adapters) | 0.5 sess |
| `inpaint-provider.ts` + Python `lama_inpaint.py` sidecar route | 1 sess |
| Editor UI: mask-brush component + new enhancement entries in `enhancement-labels.ts` | 1 sess |
| Tier gating + new enhancement types in `tier-config.ts` + entitlements | 0.25 sess |
| Smoke / matrix tests in `enhancement-chain-matrix.test.ts` style | 0.5 sess |
| **Total (Phase 1 + 2 below)** | **~3.75 sessions** |

---

## 4. Fallback Strategy

### 4.1 Hierarchy by criticality

| Feature | Why critical | Tier-1 (preferred) | Tier-2 (auto fallback) | Tier-3 (last resort) |
|---|---|---|---|---|
| **Watermark removal** | Paid feature; outage = direct revenue loss | Local LaMa (sidecar) | FLUX.1-Kontext (NIM) | Replicate LaMa |
| **Scratch removal** | Paid feature; less time-sensitive | Local LaMa (sidecar) | Replicate LaMa | — |
| **Creative edit (instruction)** | Paid feature, user-facing latency expectation 5–10s | Nano Banana 2 | Seedream 4.5 | FLUX.1-Kontext |
| **Auto Face / restore** | Core free + paid feature, **must never go down** | Local GFPGAN/CodeFormer/Real-ESRGAN sidecar (existing) | Gemini for prompt-only restore guidance | OpenRouter free vision for damage classification |
| **Image analysis / recommend** | Pre-edit step, low-criticality fallback chain | Existing `primary` group | `standard` group (free) | `gemini` group | 

### 4.2 Failure-mode handling

The existing `provider-key-manager` already implements:

- 5-minute health checks (`HEALTH_CHECK_INTERVAL_MS`)
- Disable-after-3-consecutive-errors (`MAX_CONSECUTIVE_ERRORS = 3`)
- Priority-based pickup with last-error suppression

We extend it with **one** new behavior for the image-edit groups:

> **Soft-degradation flag.** When a paid generative model fails twice in a row in the same minute, and the request includes a `softFallbackOk: true` hint, we serve the local sidecar's best-effort result **plus** a UI toast `"Premium edit temporarily degraded — applied a basic enhancement instead. Retry available."`. This keeps the user productive while we wait for the upstream provider to recover.

### 4.3 Where local-first wins

LaMa is the only critical path where we **start local and fall back to API**, not the other way around. Reasoning:

- Apache 2.0 license — commercially safe (Replicate hosts it, but redistributing is fine).
- 200 MB model, 1.5 GB peak RAM, CPU-runnable in 2–5s. Already fits the existing Python sidecar profile.
- Per-call cost is **$0** at the local layer — only the (rare) fallback path costs $0.00047. At 1,000 fallbacks/month that's $0.47.
- Quality matches LaMa-on-Replicate by definition (same weights).

For the other categories — generative edit, hair restyle, colorize — the local equivalents (InstructPix2Pix, ControlNet, SD-based colorization) require GPU. **Until we have a GPU node, those are API-first by necessity.**

---

## 5. Iterative Rollout

### 5.1 Phasing — strictly free / existing first

Phase progression honors the meta-prompt's "no-cost APIs first, validate, then layer paid":

| Phase | Scope | New deps | Marginal cost | Validation gate |
|---|---|---|---|---|
| **Phase 0 — Activate underused capability** | Promote Seedance 2.0 + WAN 2.7 from `analysis-only` to also serve `image_to_video` and `video_text_edit` enhancement types. Update `enhancement-labels.ts` `appliesTo` for relevant items to `"both"`. | None (keys already present) | $0 | At least 50 image-to-video runs land successfully in dev/QA. |
| **Phase 1 — Local LaMa sidecar** | `services/restoration/lama_inpaint.py`; auto-mask scratch detection in `image-enhancer.ts`; `mask-brush.tsx` for watermark; gate as Premium in `tier-config.ts`. | LaMa weights (200 MB) | $0 | 95% of test images produce visually clean inpaint at <5s on a 4-core CPU. |
| **Phase 2 — Image-edit group on existing OpenRouter key** | Add `image_edit` group; wire Nano Banana 2 first (cheapest); `creative_edit` enhancement; tier-gate as Premium. Reuses existing `sk-or-v1-…` key — just adds a new model id under it. | Existing OpenRouter key (no new key) | ~$0.005/edit | 200 dogfood edits across portrait + landscape, manual quality grading ≥4/5. |
| **Phase 3 — NVIDIA NIM image-edit** | Add `image_inpaint` group with FLUX.1-Kontext via existing `nvapi-…` key. Use **only** the existing free credit pool initially. | Existing NIM key, free credits | $0 until 5,000 calls | Track `creditsUsed` in admin panel. Decide paid vs scale-down before exceeding free tier. |
| **Phase 4 — Procedural FaceApp (MediaPipe)** | MediaPipe FaceMesh in sidecar; procedural lipstick/eyeliner/blush + frequency-separation retouch. Hair restyle stub routes to FLUX.1-Kontext (Phase 3 dep). | MediaPipe (~250 MB) | $0 | Lip/eye/blush look natural across 5 skin tones × 3 lighting conditions. |
| **Phase 5 — Generative FaceApp + Replicate fallback** | Replicate API key for `image_inpaint` and `image_edit` fallbacks; opt-in generative makeup at Premium-only. | Replicate API key (new) | ~$0.0005–0.01/call (only on fallback or premium) | Replicate failover tested with simulated NIM outage. |

**Stop-the-line rule:** at the end of each phase, re-evaluate. If a phase delivers <60% of expected user adoption (tracked via the `feedback` route + usage log) or upstream pricing changes, defer the next phase rather than push through.

### 5.2 Free credit harvesting timeline

To squeeze the maximum free runway out of existing accounts:

1. **Today (Phase 0/1).** No spend. Stand up local LaMa + activate Seedance/WAN for new enhancement types.
2. **Phase 2.** ~$5 buys ≈ 1,000 Nano Banana 2 edits — internal QA / dogfooding only, gated behind a `premium` flag.
3. **Phase 3.** Use the **5,000 free NVIDIA credits** (or 9,000 with business email upgrade) for the entire FLUX.1-Kontext rollout. This is a real, time-bounded subsidy — burn it into product first, switch to paid only after demonstrated demand.
4. **Phase 5.** Replicate's no-monthly-minimum + $0.00047 LaMa run is essentially a "graceful degradation insurance policy" — at 1,000 fallbacks/month the bill is $0.47.

### 5.3 Success metrics per phase

| Phase | Metric | Target |
|---|---|---|
| 0 | New image-to-video conversions on Seedance/WAN | ≥1 in dev, ≥10 in beta |
| 1 | Watermark/scratch removals/day at Premium | ≥10% of Premium daily edits |
| 2 | Creative edit median latency | ≤8 s end-to-end |
| 2 | Creative edit "looks right" score (manual QA) | ≥4/5 on 200-image bench |
| 3 | NVIDIA credit burn rate | <500 credits/day during validation |
| 4 | Procedural makeup success rate (no facial artifacts) | ≥95% |
| 5 | Tier-2 fallback engagement rate | <5% of edit requests |

### 5.4 Subscription alignment

Every new enhancement is mapped to the existing `tier-config.ts` matrix at the same time as the route is added — never after:

| Plan | Watermark/Scratch | Creative edit | Procedural makeup | Generative makeup / hair |
|---|---|---|---|---|
| Free | ❌ | ❌ | ❌ | ❌ |
| Basic | 5/mo | 5/mo | ✅ | ❌ |
| Premium | Daily quota | Daily quota | ✅ | Daily quota |
| Credit packs | ✅ per-credit | ✅ per-credit | ✅ free | ✅ per-credit |

Charity allocation (10% of revenue, already disclosed) applies to credit-pack and subscription revenue from these features without a code change — `payments.ts` already routes through the centralized splitter.

---

## 6. Cross-cutting risks & mitigations

| Risk | Mitigation |
|---|---|
| Free credits expire on NVIDIA / OpenRouter | Track `credits_remaining` per key in `provider-key-manager`. Alert at 25% / 10% remaining. Already partially scaffolded by `getKeyUsageReport()`. |
| Image-edit upstream changes a model id (Nano Banana → Nano Banana 3) | Keep model IDs in `MODEL_GROUP` config. Wire env vars `IMAGE_EDIT_PRIMARY_MODEL` / `_SECONDARY_MODEL` so we can shift without redeploy. |
| Local LaMa weights are slow on 1-core hosting | Document a `MODELS_DIR` env so deployers can mount a faster volume; add a `LAMA_THREADS` worker count knob. |
| Provider TOS changes (e.g., Replicate restricts watermark removal use case) | Maintain a TOS check log per provider; review quarterly. Fall back to Local LaMa-only if any provider goes restrictive. |
| Cost surprise from a runaway loop | Per-user, per-day cap on **paid generative calls** in `entitlements.ts` independent from credit counts. Hard 503 above the cap. |
| Sidecar disk growth (LaMa + MediaPipe + ESRGAN + GFPGAN + CodeFormer ≈ 2.5 GB) | Already mounted as a separate volume in dockerized deployments; document in `start.sh` and Dockerfile. |

---

## 7. Decisions needed from you

These are the only things gating implementation. Answers map directly to which phases ship first.

1. **Phase ordering.** The recommendation is `0 → 1 → 2 → 3 → 4 → 5`. Phases 0/1 are $0. Confirm or reorder.
2. **Phase 2 budget.** Are you OK with up to ~$10/month during the Phase-2 dogfood window? (1,000–2,000 edits at $0.005 each.) Approve / hold / decline.
3. **Phase 3 NVIDIA business-email.** If you can attach a business email to the build.nvidia.com account, we get +4,000 credits and a 90-day Enterprise license. Worth doing? Yes / No.
4. **Replicate dependency.** Comfortable adding Replicate as a fallback provider in Phase 5? It's the only fallback that gives us LaMa-as-a-service (so a sidecar outage doesn't kill watermark removal). Yes / No / "use Stability AI instead at $0.04/call."
5. **Mask UI scope.** For watermark removal, ship (a) brush mask only, (b) brush + auto-detect (OCR + heuristic), or (c) both with brush as default? Recommended: (c).

Once 1–5 are answered, Phase 0 can ship in the same day.

---

## 8. What changes vs the prior FaceApp/Watermark report

| Change | Why |
|---|---|
| Reclassified Seedance 2.0 + WAN 2.7 from "analysis" to "video generative" | Verified live. Unblocks free image-to-video / video-edit roadmap items at zero new spend. |
| Phase 2 (image edit) uses **Nano Banana 2 on the existing OpenRouter key** instead of Replicate's `tencentarc/photomaker` as primary | Cheaper ($0.005 vs $0.003–0.01 with worse subject preservation), no new API key, single integration covers more enhancement types. |
| Phase 3 added: **NVIDIA NIM FLUX.1-Kontext** as primary inpaint quality boost | Wasn't surveyed in the prior report. Free 5,000-credit pool + state-of-the-art inpaint quality + already have an `nvapi-…` key. |
| Replicate LaMa pricing updated $0.002 → **$0.00047** per call (~5× cheaper) | Live verification of `allenhooo/lama` listing on Replicate. Makes the fallback even cheaper than originally projected. |
| Local LaMa **stays Tier-1** for inpaint despite cheaper API option | API equivalence is fine, but local is $0/call and offline-capable. Cost per 10K inpaints: $0.00 local vs $4.70 Replicate-only. |
| Item 9 procedural makeup deferred to **Phase 4**, after image-edit API ships | Generative edit (Nano Banana 2) ships sooner and covers more demand. MediaPipe still queued for cost-sensitive bulk operations. |

---

## 9. Bottom line

- We have **more capability already paid-for than we are using**: Seedance 2.0 + WAN 2.7 are video-generative, not analysis.
- We have **two free-tier image-edit paths** that did not exist when the prior report was written: NVIDIA NIM FLUX.1-Kontext (5,000 free credits) and OpenRouter Nano Banana 2 ($0.005/img on a key we already hold).
- The watermark / scratch primitive — **inpainting** — is the rare case where local is *both* better economics *and* good-enough quality. We should ship local LaMa first regardless of API decisions.
- Net plan: **3 of 5 phases are $0 marginal.** Only Phases 2 and 5 add cost, and both are tightly tier-gated.

Recommended go: **Phase 0 today, Phase 1 immediately after, then re-gate.**
