# API Enhancement Provider Assessment

Last updated: 2026-05-06

## Executive Summary

GlimpseAI currently has two distinct AI enhancement classes:

- Pixel-producing image enhancement: face restoration, CodeFormer, GFPGAN-style auto face, Real-ESRGAN upscaling, hybrid restore, and old-photo restore.
- AI analysis and recommendations: image classification, enhancement suggestions, confidence badges, and user-facing guidance.

The existing OpenRouter, Gemini, and NVIDIA keys are suitable for analysis, recommendations, prompt guidance, and possibly future generative editing workflows. They are not a drop-in replacement for the current GFPGAN / CodeFormer / Real-ESRGAN sidecar because the production enhancement path needs an API that returns a transformed image, not only text analysis about an image.

RunPod should not be deprecated until a dedicated image-restoration API path has passed the same output-quality and preview/export validation gates as the sidecar.

## Current Pipeline Assessment

### Frontend request path

- Photo Studio sends chained enhancement requests to `POST /api/media/enhance-chain`.
- Auto Face is represented as `enhance: "auto_face"`.
- Filters are sent separately as canonical `filterId` values, for example `filterId: "vibrant"`.
- This request path is correct and should remain stable.

### Backend render path

The production image renderer is in:

- `artifacts/api-server/src/lib/image-enhancer.ts`
- `artifacts/api-server/src/lib/enhancement-pipeline.ts`
- `artifacts/api-server/src/routes/media.ts`

Restoration-capable enhancement types currently include:

- `auto_face`
- `face_restore`
- `face_restore_hd`
- `codeformer`
- `hybrid`
- `esrgan_upscale_2x`
- `esrgan_upscale_4x`
- `old_photo_restore`

When `RESTORATION_SERVICE_URL` is reachable, these types call the Python restoration service through `artifacts/api-server/src/lib/restoration-client.ts`. When it is not reachable, the backend falls back to Sharp-native processing and logs:

```text
Restoration service unreachable - falling back to local sharp processing
```

### Current RunPod state

The RunPod-ready container image exists and is public:

```text
ghcr.io/futuretechvision-in/glimpse-restoration:0.1.2
```

The endpoint is not active yet. Endpoint creation was blocked by the RunPod account balance requirement, so production correctly remains in `Native fallback` mode until a live endpoint exists and Render receives `RESTORATION_SERVICE_URL`.

## Available API Key Inventory

The local environment contains provider key variables for:

- `GEMINI_API_KEYS`
- `NVIDIA_API_KEY`
- `NVIDIA_QWEN_IMAGE_EDIT_API_KEY`
- `NVIDIA_FLUX_2_KLEIN_4B_API_KEY`
- `NVIDIA_FLUX_1_DEV_API_KEY`
- `NVIDIA_RELIGHTING_API_KEY`
- `NVIDIA_ACTIVE_SPEAKER_API_KEY`
- Optional `PROVIDER_KEYS_*` OpenRouter-style keys, depending on deployment environment

Do not print or commit the key values. Keep them in local `.env`, Render environment variables, or another secret manager only. If any raw key value has appeared in terminal logs, chat logs, screenshots, or copied diagnostics, rotate it before production reliance.

Render declares provider key variables as `sync: false` in `render.yaml`, including Gemini, generic NVIDIA, and model-specific NVIDIA image/video keys. Values must be entered manually in the Render dashboard or through a secure Render API workflow.

## Provider Capability Mapping

| Requirement | Existing implementation | OpenRouter keys | Gemini keys | NVIDIA key | Recommended production path |
| --- | --- | --- | --- | --- | --- |
| Auto Face / GFPGAN-like restoration | RunPod/local restoration sidecar, fallback to Sharp | Not equivalent unless routed to a model that returns restored image output | Can generate/edit images, but not a deterministic GFPGAN/CodeFormer replacement by default | VLM/chat endpoints are analysis-oriented, not the current restoration API | Keep RunPod or integrate a dedicated restoration API such as GFPGAN/CodeFormer on Replicate/fal |
| CodeFormer detail restoration | RunPod/local sidecar | Not equivalent by current code | Not equivalent by current code | Not equivalent by current code | Dedicated CodeFormer API or sidecar |
| Real-ESRGAN 2x/4x upscale | RunPod/local sidecar, Sharp fallback | Not equivalent by current code | Possible generative upscaling is provider/model-specific, not current parity | Not equivalent by current code | Dedicated Real-ESRGAN/upscale API or sidecar |
| Inpainting / object editing | Not currently part of the production enhancement route | Possible with image-capable models, but no current backend contract | Gemini image editing can support text-and-image-to-image workflows | Qwen-Image-Edit and FLUX image models are candidates, but not current code | Add as a new capability with masks, prompts, safety, and output validation |
| Relighting | Not currently part of the production enhancement route | Not applicable | Not applicable | NVIDIA AI for Media Relighting is a candidate for Video Studio | Add a dedicated video relighting feature, not Auto Face |
| Face / speaker metadata | Not currently used for enhancement | Not applicable | Not applicable | Active Speaker Detection can support video analysis metadata only | Use for Video Studio analysis, not pixel restoration |
| AI recommendations | `ai-provider.ts` plus local analysis | Supported for multimodal analysis on compatible models | Supported as fallback analysis | Supported for compatible VLM/chat models | Keep and improve current provider router |
| Cost-aware guidance | Provider key manager and admin stats partially support this | Possible | Possible | Possible | Add structured usage logging and budget alerts |

Official capability references:

- OpenRouter multimodal docs: https://openrouter.ai/docs/guides/overview/multimodal/overview
- OpenRouter image generation docs: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
- Gemini image generation and editing docs: https://ai.google.dev/gemini-api/docs/image-generation
- NVIDIA NIM VLM docs: https://docs.nvidia.com/nim/vision-language-models/latest/api-reference.html
- Replicate GFPGAN: https://replicate.com/tencentarc/gfpgan
- Replicate CodeFormer: https://replicate.com/sczhou/codeformer
- Replicate Real-ESRGAN: https://replicate.com/nightmareai/real-esrgan

## Gap Analysis

| Gap | Impact | Priority | Effort | Fix |
| --- | --- | --- | --- | --- |
| No active restoration endpoint in production | Auto Face remains Sharp-native and visibly milder than local sidecar quality | P0 | Small once RunPod billing or alternate provider is ready | Activate RunPod endpoint or configure dedicated restoration API |
| Chat/vision providers are being considered for pixel restoration | Risk of lower quality, hallucinated edits, nondeterministic output, and mismatched preview/export behavior | P0 | Medium | Introduce capability-specific provider routing, not generic chat routing |
| NVIDIA model-specific keys are not yet wired to pixel-output routes | Generated keys will sit unused unless a Visual GenAI provider client is added | P1 | Medium | Add a dedicated NVIDIA image provider for Qwen/FLUX/Relighting capabilities |
| No dedicated external image provider abstraction | Hard to swap RunPod for Replicate/fal cleanly | P1 | Medium | Add an `image-enhancement-provider` interface with capability descriptors |
| No cost ledger for image model calls | Budget risk once paid pixel APIs are enabled | P1 | Medium | Log provider, model, operation, latency, input/output bytes, estimated cost |
| Inpainting has no backend contract | Cannot safely route editing requests to Gemini/OpenRouter yet | P2 | Medium to large | Add prompt, mask, strength, safety, and output artifact contract |

## Backend Integration Plan

### 1. Keep restoration routing capability-based

Do not replace `callRestorationService()` with a generic LLM call. Instead, add a provider abstraction for APIs that return transformed image bytes:

```ts
export type ImageEnhancementCapability =
  | "face_restore"
  | "codeformer"
  | "auto_face"
  | "old_photo_restore"
  | "upscale_2x"
  | "upscale_4x"
  | "inpaint";

export interface ImageEnhancementProvider {
  id: "runpod" | "replicate" | "fal" | "gemini-image" | "nvidia-nim";
  supports(capability: ImageEnhancementCapability): boolean;
  health(): Promise<{ ok: boolean; capabilities: ImageEnhancementCapability[] }>;
  enhance(input: {
    capability: ImageEnhancementCapability;
    imageBase64: string;
    mimeType: string;
    params?: Record<string, unknown>;
  }): Promise<{
    imageBase64: string;
    mimeType: string;
    metadata: Record<string, unknown>;
  }>;
}
```

### 2. Preserve RunPod as primary until replacement parity is proven

Recommended provider order:

1. Dedicated restoration API provider for the exact requested capability.
2. RunPod sidecar.
3. Sharp-native fallback.

For launch safety, keep RunPod first for:

- `auto_face`
- `face_restore`
- `face_restore_hd`
- `codeformer`
- `hybrid`
- `old_photo_restore`
- `esrgan_upscale_2x`
- `esrgan_upscale_4x`

Only switch these to an external API after fixture-based visual validation passes.

### 3. Add provider-specific env vars

Use secret environment variables only:

```text
REPLICATE_API_TOKEN=<secret>
FAL_KEY=<secret>
GEMINI_API_KEYS=<secret-list>
NVIDIA_API_KEY=<secret>
NVIDIA_QWEN_IMAGE_EDIT_API_KEY=<secret>
NVIDIA_FLUX_2_KLEIN_4B_API_KEY=<secret>
NVIDIA_FLUX_1_DEV_API_KEY=<secret>
NVIDIA_RELIGHTING_API_KEY=<secret>
NVIDIA_ACTIVE_SPEAKER_API_KEY=<secret>
IMAGE_PROVIDER_ORDER=runpod,replicate,sharp
```

Keep all secret values out of source control and out of logs.

The model-specific NVIDIA keys should be treated as experimental provider inputs until a dedicated Visual GenAI client exists. The current backend does not automatically route Auto Face through Qwen-Image-Edit or FLUX just because these variables are present.

### 4. Add retries and circuit breaking

Provider calls should include:

- Short health-cache TTL, similar to the current restoration client.
- Per-call timeout by capability.
- Exponential backoff for transient `429`, `502`, `503`, and network failures.
- Circuit breaker after repeated provider failures.
- Structured fallback logging without exposing tokens or image payloads.

### 5. Keep recommendation providers separate

`ai-provider.ts` should continue to handle recommendations and analysis. Pixel-producing enhancement should live in a separate provider client so that text/vision model availability does not imply restoration availability.

## Validation Workflow

Before deprecating RunPod, validate each target API provider against the current sidecar:

1. Use representative fixtures: portraits, low light, high contrast, old photos, soft/blurry faces, landscapes, PNG/JPEG/WebP, and multiple aspect ratios.
2. For each capability, produce three outputs:
   - Current sidecar result.
   - Candidate API provider result.
   - Sharp fallback result.
3. Compare outputs with:
   - SSIM or perceptual image similarity.
   - Face-region crop inspection.
   - Histogram delta for blown highlights and over-saturation.
   - Human QA for skin texture, identity preservation, and artifact risk.
4. Record:
   - provider id
   - model id/version
   - operation
   - latency
   - output dimensions
   - cost estimate
   - fallback reason, if any

Acceptance threshold:

- Auto Face must be visibly better than Sharp fallback.
- Auto Face must preserve identity and skin texture.
- Auto Face plus creative filters must not blow highlights or over-saturate skin.
- Exported output must match the preview path within the existing validation tolerances.

For provider-by-provider experiments, use `docs/ENHANCEMENT-PROVIDER-EVALUATION-PROTOCOL.md` so every candidate records capability focus, input fixture, API setup, output artifacts, latency, comparison notes, and a production decision.

## Cost and Usage Monitoring

Add a usage event per external image API call:

```json
{
  "provider": "replicate",
  "model": "gfpgan",
  "capability": "auto_face",
  "status": "success",
  "latencyMs": 4200,
  "inputBytes": 734003,
  "outputBytes": 812339,
  "estimatedCostUsd": 0.012,
  "fallbackUsed": false
}
```

Operational controls:

- Daily spend cap per provider.
- Per-user enhancement quota.
- Admin dashboard rollup by provider and operation.
- Alert when fallback rate exceeds a threshold.
- Alert when median or p95 latency exceeds the UI budget.

## RunPod Deprecation Checklist

Only decommission RunPod after all of these are true:

- A replacement API returns processed image bytes for every restoration capability.
- Auto Face, CodeFormer, and ESRGAN-style upscale pass fixture validation.
- Production logs show the replacement provider serving real traffic without high fallback rates.
- Vercel browser smoke passes upload, Auto Face, filter, export, and download.
- Cost monitoring is live and shows acceptable usage.

Then:

1. Remove `RESTORATION_SERVICE_URL` and `RESTORATION_SERVICE_TOKEN` from Render.
2. Keep Sharp fallback in code for resilience.
3. Disable or delete the RunPod endpoint/template.
4. Rotate the RunPod API key.
5. Update runbooks and architecture docs.

## Recommended Next Step

Do not replace the sidecar with the existing OpenRouter, Gemini, or NVIDIA chat/vision keys for Auto Face. Pick one of these concrete paths:

1. Fund and activate the existing RunPod endpoint. This is the fastest path because the backend integration is already built.
2. Add a dedicated image restoration provider, starting with Replicate or fal for GFPGAN, CodeFormer, and Real-ESRGAN, then validate output against the sidecar.
3. Use Gemini/OpenRouter image generation only for new creative editing features, such as prompt-based inpainting, after adding a separate UI and backend contract for masked edits.
