# Provider Evaluation Result

Date: 2026-05-06T01:13:19.005Z
Evaluator: Codex

## Capability Focus

- Capability: auto_face
- Product feature: Photo Studio -> Face Restoration -> Auto
- Provider: NVIDIA
- Model: qwen-image-edit
- Key env var: NVIDIA_API_KEY
- Baseline: Sharp-native auto_face fallback

## Input And Expected Outcome

- Fixture id: portrait_warm_closeup_01
- Input path: /Users/bipbabu/Library/CloudStorage/OneDrive-Cisco/Personal/05-Education & Learning/Future Tech Vision AI/GitHub/GlimpseAI.v1.1/qa-report/provider-evals/2026-05-06/auto_face/nvidia-qwen-image-edit/portrait_warm_closeup_01/input-degraded.jpg
- Input type: degraded JPEG portrait
- Resolution: 768x512
- Degradation: downsampled and JPEG-compressed portrait to simulate softness/compression
- Expected success: sharper facial detail, preserved identity, no face geometry drift, no waxy skin, no clothing/background changes
- Failure conditions: API unavailable, identity drift, stylization, background hallucination, output not decodable

## API Call Setup

- Endpoint or SDK: NVIDIA hosted API candidates discovered from Build/NIM docs
- Request mode: attempted text-and-image-to-image JSON plus OpenAI-compatible multipart image edit
- Prompt/instruction: Restore natural facial detail and reduce JPEG/compression softness. Preserve the person identity, pose, clothing, hands, hair, pink background, and camera framing. Do not stylize, beautify, change age, change expression, or alter facial geometry. Keep skin natural and avoid waxy texture.
- Output size: 1024x1024 where supported
- Parameters: seed=0, response_format=b64_json where supported
- Timeout: default fetch timeout
- Retry policy: no retries for this first smoke; endpoint discovery only

## Run And Record

- Provider output path: none
- Baseline output path: none
- Sharp fallback path: /Users/bipbabu/Library/CloudStorage/OneDrive-Cisco/Personal/05-Education & Learning/Future Tech Vision AI/GitHub/GlimpseAI.v1.1/qa-report/provider-evals/2026-05-06/auto_face/nvidia-qwen-image-edit/portrait_warm_closeup_01/sharp-baseline-auto_face.jpg
- Latency: see result.json attempts
- Status: api-unreachable-or-unsupported
- Provider request id: not returned
- Fallback used: Sharp baseline generated locally
- Unexpected artifacts: No provider image returned; NVIDIA hosted Qwen endpoint was not reachable with tested routes.

## Comparison

- Identity preservation: not testable because no provider image returned
- Detail quality: not testable because no provider image returned
- Color/skin tone: not testable because no provider image returned
- Background stability: not testable because no provider image returned
- Filter compatibility: not tested in this run
- Export parity: not tested in this run
- Notes: See result.json for endpoint attempt details.

## Decision

- Decision: reject-for-auto_face-until-hosted-image-edit-endpoint-is-available
- Reason: Qwen-Image-Edit appears downloadable/self-hosted in NVIDIA Build docs and did not expose a working hosted image-edit endpoint for this smoke test.
- Next action: Do not integrate Qwen-Image-Edit as production Auto Face. Either self-host the Qwen NIM, use RunPod restoration, or test a dedicated hosted restoration API such as GFPGAN/CodeFormer.
