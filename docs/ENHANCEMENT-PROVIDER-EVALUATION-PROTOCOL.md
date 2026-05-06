# Enhancement Provider Evaluation Protocol

Last updated: 2026-05-06

Use this protocol before routing any new provider into a production enhancement path. The goal is to make every experiment comparable against the current GlimpseAI baselines: RunPod/local restoration sidecar when available, Sharp-native fallback, and exported production output.

## 1. Capability Focus

Pick exactly one capability per test run.

Recommended capability ids:

- `auto_face`: portrait-safe face restoration and mild facial detail recovery.
- `face_restore`: stronger GFPGAN-style restoration for degraded faces.
- `codeformer`: detail-preserving restoration for damaged or low-quality faces.
- `upscale_2x`: super-resolution with identity and texture preservation.
- `upscale_4x`: stronger super-resolution, higher artifact risk.
- `inpaint`: masked object/background replacement or repair.
- `relight`: lighting correction or video portrait relighting.
- `metadata_face_speaker`: non-pixel video analysis such as active speaker detection.

State the exact production feature this capability would support, for example:

```text
Capability: auto_face
Feature target: Photo Studio -> Face Restoration -> Auto
Provider candidate: NVIDIA Qwen-Image-Edit
Baseline: RunPod GFPGAN/CodeFormer sidecar, then Sharp fallback
```

## 2. Input And Expected Outcome

Define the fixture before running the provider.

Minimum required fields:

- Fixture id.
- Image or video type.
- Resolution and aspect ratio.
- Degradation class.
- Expected visible outcome.
- Failure conditions.

Example:

```text
Fixture id: portrait_lowres_warm_01
Input: low-resolution JPEG portrait, warm/pink background, 1920x1080
Degradation: soft facial detail, mild compression, skin highlights
Success: sharper eye/skin detail, preserved identity, no plastic skin, no blown shirt highlights
Failure: face shape drift, waxy skin, over-saturation, fake teeth/eyes, background hallucination
```

## 3. API Call Setup

Record the exact API contract before running.

Required:

- Provider name.
- Model id.
- Endpoint URL or SDK method name, without secrets.
- Environment variable used for the key.
- Request mode: image-to-image, text-and-image-to-image, mask-based inpaint, video, or metadata-only.
- Prompt or instruction text.
- Image size or output size.
- Strength / guidance / fidelity parameters.
- Timeout and retry policy.
- Safety or content moderation options.

Do not log raw API keys, signed URLs, private image payloads, or full user data.

Example:

```text
Provider: NVIDIA
Model id: qwen-image-edit
Key env: NVIDIA_QWEN_IMAGE_EDIT_API_KEY
Mode: text-and-image-to-image
Instruction: Restore natural facial detail and reduce compression artifacts. Preserve identity, pose, clothing, and background. Avoid stylization.
Output size: match input where supported
Timeout: 60s
Retries: 1 retry for 429/502/503 only
```

## 4. Run And Record

For each run, capture:

- Input artifact path.
- Provider output artifact path.
- RunPod/local sidecar baseline path, if available.
- Sharp fallback baseline path.
- Processing latency.
- Response status and provider request id, if available.
- Any fallback path used.
- Artifacts or distortions observed.

Suggested output structure:

```text
qa-report/provider-evals/<date>/<capability>/<provider>/<fixture-id>/
  input.jpg
  provider-output.jpg
  runpod-baseline.jpg
  sharp-baseline.jpg
  diff-provider-vs-runpod.png
  notes.md
```

## 5. Comparison And Decision

Compare against the intended baseline.

Auto Face / face restoration checks:

- Identity preservation.
- Eye, mouth, skin, and hair naturalness.
- No wax/plastic skin.
- No face geometry drift.
- No over-sharpening halos.
- No saturation or highlight blowout after filters.

Super-resolution checks:

- Detail recovery over Sharp resize.
- No fake texture or ringing.
- Text/logos do not become worse.
- Output dimensions match requested scale.

Inpainting checks:

- Mask boundary is clean.
- Replacement matches lighting and perspective.
- No unexpected edits outside mask.
- Prompt compliance without identity drift.

Relighting checks:

- Skin tones remain plausible.
- Shadows/highlights are coherent across frames.
- No flicker for video.
- No background collapse or posterization.

Decision labels:

- `production-ready`: can be routed for this capability after tests pass.
- `beta`: usable behind internal/beta flag only.
- `research-only`: keep for manual experiments, not product.
- `reject`: do not integrate for this capability.

## 6. Next Action

Choose exactly one follow-up:

- Integrate provider into the backend capability router.
- Re-test with revised parameters.
- Test a different model/provider.
- Keep provider for a different feature.
- Reject and keep current RunPod/Sharp path.

Production integration requires:

- Secret env vars configured in Render as `sync: false`.
- Provider call emits usage, latency, and fallback logs.
- Preview/export parity is preserved.
- Matrix fixtures pass for all affected capabilities.
- UI copy identifies beta or experimental providers honestly.

## Results Log Template

Copy this template into a new file under `qa-report/provider-evals/` for each test run.

```md
# Provider Evaluation Result

Date:
Evaluator:

## Capability Focus

- Capability:
- Product feature:
- Provider:
- Model:
- Key env var:
- Baseline:

## Input And Expected Outcome

- Fixture id:
- Input path:
- Input type:
- Resolution:
- Degradation:
- Expected success:
- Failure conditions:

## API Call Setup

- Endpoint or SDK:
- Request mode:
- Prompt/instruction:
- Output size:
- Parameters:
- Timeout:
- Retry policy:

## Run And Record

- Provider output path:
- Baseline output path:
- Sharp fallback path:
- Latency:
- Status:
- Provider request id:
- Fallback used:
- Unexpected artifacts:

## Comparison

- Identity preservation:
- Detail quality:
- Color/skin tone:
- Background stability:
- Filter compatibility:
- Export parity:
- Notes:

## Decision

- Decision: production-ready | beta | research-only | reject
- Reason:
- Next action:
```

