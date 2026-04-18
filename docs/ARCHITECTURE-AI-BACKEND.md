# GlimpseAI — AI Media Processing Backend Architecture

> **Author**: Senior AI Research Engineer / ML Systems Architect / Backend Architect / OSS Evaluation Lead
> **Date**: July 2025
> **Status**: Approved Architecture Proposal
> **Audience**: Engineering team, product leadership, future contributors

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [OSS Model Comparison Matrix](#2-oss-model-comparison-matrix)
3. [Recommended Stack Strategy](#3-recommended-stack-strategy)
4. [Proposed System Architecture](#4-proposed-system-architecture)
5. [Data Flow & Pipeline Design](#5-data-flow--pipeline-design)
6. [Admin & Provider Management Design](#6-admin--provider-management-design)
7. [Scalability Plan](#7-scalability-plan)
8. [Security & Reliability](#8-security--reliability)
9. [Build Roadmap (MVP / V1 / V2)](#9-build-roadmap-mvp--v1--v2)
10. [Final Recommendation](#10-final-recommendation)

---

## 1. Executive Summary

GlimpseAI is a consumer-facing AI media enhancement platform that accepts user-uploaded photos and videos, applies intelligent enhancement (upscaling, face restoration, color correction, lighting, style transfer), and returns production-quality output. The current codebase has a working Express.js v5 + TypeScript API server, React + Vite frontend, PostgreSQL 16 via Drizzle ORM, and a provider key management system — but **zero real AI inference**. Media "processing" is a `setTimeout()` placeholder.

This document defines the concrete backend architecture to replace that placeholder with a production-grade AI inference pipeline. The architecture is:

- **Hybrid**: Express.js API gateway (TypeScript) + Python AI engine (PyTorch/CUDA)
- **Queue-driven**: BullMQ + Redis for async job orchestration with multi-stage pipelines
- **Storage-decoupled**: S3-compatible object storage (Cloudflare R2 / MinIO dev) replaces base64-in-PostgreSQL
- **GPU-aware**: Worker pool with model-specific routing, VRAM budgeting, and horizontal scaling
- **Provider-agnostic**: Unified abstraction over self-hosted OSS models AND cloud inference APIs (Replicate, fal.ai, RunPod)

**Key decisions made in this document:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Video generation | **LTX-Video (LTX-2)** | Apache 2.0, real-time on H100, 4K/50FPS, active Lightricks backing |
| Image upscaling | **Real-ESRGAN** | BSD-3, 35K+ stars, NCNN portable, tile-based for large images |
| Face restoration | **GFPGAN** | Apache 2.0, integrates with Real-ESRGAN, proven V1.3/V1.4 |
| Workflow engine | **ComfyUI** (V2 only) | 109K stars, visual pipelines, supports ALL models, GPL-3 (isolated) |
| ML containerization | **Cog by Replicate** | Apache 2.0, auto OpenAPI, HTTP prediction server, Docker-native |
| Job queue | **BullMQ** | TypeScript-native, Redis-backed, priorities, rate limiting, repeatable |
| Object storage | **Cloudflare R2** (prod) / **MinIO** (dev) | S3-compatible, zero egress fees, CDN-integrated |

**What this is NOT**: This is not a research paper. Every section maps to implementable code, infrastructure config, or operational runbook.

---

## 2. OSS Model Comparison Matrix

### 2.1 Video Generation Models

| Criteria | LTX-Video / LTX-2 | CogVideoX | VideoCrafter |
|----------|-------------------|------------|--------------|
| **GitHub Stars** | ~10,000 | ~12,600 | ~5,100 |
| **License** | Apache 2.0 (code), custom (weights) | Apache 2.0 (2B), Custom (5B+) | **Non-commercial** |
| **Architecture** | DiT (Diffusion Transformer) | Expert Transformer + 3D VAE | Stable Diffusion UNet |
| **Model Sizes** | 2B, 13B | 2B, 5B | Single (~1.5B) |
| **Max Resolution** | 4K (3840x2160) | 1360x768 | 576x1024 |
| **Max FPS** | 50 FPS | 8 FPS | 8 FPS |
| **Max Duration** | ~60s clips | ~6s clips | ~2s clips |
| **VRAM (min)** | ~8GB (2B FP8) | 3.6GB (2B, SAT) | ~12GB |
| **VRAM (recommended)** | 24GB+ (13B) | 30-76GB (5B) | ~16GB |
| **Precision** | FP8, FP16 | FP16, BF16 | FP16 |
| **Inference Speed** | Real-time on H100 (2B) | 5-10 min per clip | 2-5 min per clip |
| **Capabilities** | t2v, i2v, v2v, keyframe control | t2v, i2v (5B only) | t2v, i2v (via DynamiCrafter) |
| **Framework** | diffusers, custom | SAT, diffusers | PyTorch, custom |
| **Active Maintenance** | Very active (Lightricks) | Active (Tsinghua/ZhipuAI) | Stale (points to DynamiCrafter) |
| **Production Readiness** | 5/5 | 4/5 | 2/5 |
| **GlimpseAI Verdict** | **PRIMARY** | Fallback / research | **REJECTED** |

### 2.2 Image Enhancement Models

| Criteria | Real-ESRGAN | GFPGAN | CodeFormer |
|----------|-------------|--------|------------|
| **GitHub Stars** | ~35,100 | ~37,400 | ~17,900 |
| **License** | BSD-3-Clause | Apache 2.0 | NTU S-Lab (restrictive) |
| **Primary Task** | 4x upscaling (image + video) | Face restoration | Face restoration + colorization |
| **Architecture** | RRDBNet + U-Net discriminator | GFP-GAN (Generative Facial Prior) | Codebook Lookup Transformer |
| **VRAM** | ~1.5GB | ~2GB | ~3GB |
| **Speed** | ~200ms per 512x512 tile | ~100ms per face | ~300ms per face |
| **Video Support** | Frame-by-frame | No (need per-frame pipeline) | Native video mode |
| **Key Feature** | Tile-based (handles any size), anime models | Integrates with Real-ESRGAN | Fidelity-quality tradeoff slider |
| **NCNN Support** | Yes (portable, no CUDA needed) | No | No |
| **GlimpseAI Verdict** | **PRIMARY** | **PRIMARY** | Evaluate V2 (license risk) |

### 2.3 Orchestration and Infrastructure Tools

| Tool | Stars | License | Role | GlimpseAI Verdict |
|------|-------|---------|------|-------------------|
| **ComfyUI** | ~109,000 | GPL-3.0 | Visual workflow engine, supports ALL diffusion models | V2 (isolated service, GPL boundary) |
| **Cog (Replicate)** | ~9,400 | Apache 2.0 | ML containerization, auto OpenAPI, HTTP prediction | **PRIMARY** (model packaging) |
| **HF TGI** | ~10,800 | Apache 2.0 | Text generation inference server | **REJECTED** (archived, recommends vLLM) |

### 2.4 Decision Rationale

**Why LTX-Video over CogVideoX?**
- Apache 2.0 license for code (CogVideoX 5B has restrictive license)
- 4K/50FPS vs 768p/8FPS — order of magnitude better output quality
- Real-time inference on H100 (2B model) vs 5-10 min per clip
- Active Lightricks corporate backing with clear roadmap (LTX-2 released)
- FP8 support dramatically reduces VRAM requirements

**Why GFPGAN over CodeFormer for face restoration?**
- Apache 2.0 vs NTU S-Lab restrictive license
- Direct Real-ESRGAN integration (same author: Xintao Wang)
- Simpler pipeline, faster inference
- CodeFormer transformer architecture is overkill for enhancement use case

**Why Cog for model packaging?**
- `cog.yaml` defines environment — deterministic Docker images
- Auto-generates OpenAPI spec from `predict.py` — type-safe API clients
- HTTP prediction server with `/predictions` endpoint — standard interface
- Battle-tested at Replicate scale (millions of predictions/day)

---

## 3. Recommended Stack Strategy

### 3.1 Technology Stack (Final)

```
+------------------------------------------------------------------+
|                        FRONTEND LAYER                            |
|  React 19 + Vite 8 + TypeScript + Tailwind v4 + shadcn/ui       |
|  React Query (TanStack) for server state + polling               |
|  Orval-generated type-safe API client                            |
+-----------------------------+------------------------------------+
                              | HTTPS / WebSocket
+-----------------------------v------------------------------------+
|                      API GATEWAY LAYER                           |
|  Express.js v5 + TypeScript + esbuild                            |
|  JWT auth (30-day) + RBAC (user/admin)                           |
|  Rate limiting (express-rate-limit + Redis store)                |
|  Request validation (Zod schemas from OpenAPI)                   |
|  pino structured logging + request tracing                       |
+---------+--------------+---------------+-------------------------+
          |              |               |
   +------v------+ +----v-------+ +-----v-----------+
   | Drizzle ORM | | BullMQ     | | S3 Client       |
   |      |      | | Queues     | | (aws-sdk v3)    |
   |      v      | |      |     | |      |          |
   | PostgreSQL  | |      v     | |      v          |
   |    16       | |  Redis 7   | | R2 / MinIO      |
   +-------------+ +------+-----+ +-----------------+
                          |
          +---------------v-----------------+
          |      AI WORKER LAYER            |
          |  Python 3.11 + PyTorch 2.x      |
          |  CUDA 12.x + cuDNN 9            |
          |  Cog HTTP prediction server     |
          |                                 |
          |  Workers (BullMQ consumers):    |
          |  - image-upscale (ESRGAN)       |
          |  - face-restore (GFPGAN)        |
          |  - video-generate (LTX-2)       |
          |  - video-upscale (ESRGAN)       |
          +---------------------------------+
```

### 3.2 Package Additions (API Server)

```json
{
  "dependencies": {
    "bullmq": "^5.x",
    "ioredis": "^5.x",
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/s3-request-presigner": "^3.x",
    "sharp": "^0.33.x",
    "nanoid": "^5.x"
  }
}
```

### 3.3 Python AI Engine Structure

```
ai-engine/
  cog.yaml                    # Cog environment definition
  predict.py                  # Cog predictor (HTTP interface)
  requirements.txt            # Pinned Python deps
  models/
    esrgan_predictor.py       # Real-ESRGAN wrapper
    gfpgan_predictor.py       # GFPGAN wrapper
    ltx_predictor.py          # LTX-Video wrapper
  workers/
    base_worker.py            # BullMQ consumer base class
    image_worker.py           # Image enhancement pipeline
    video_worker.py           # Video generation/enhancement
  utils/
    gpu_manager.py            # VRAM tracking, model loading/unloading
    storage.py                # S3 upload/download helpers
    metrics.py                # Prometheus metrics export
  Dockerfile                  # NVIDIA CUDA base + Cog
```

### 3.4 Why This Stack?

| Layer | Choice | Alternative Considered | Why This Wins |
|-------|--------|----------------------|---------------|
| Job queue | BullMQ | Temporal, Celery | TypeScript-native, same Redis, no new infra, battle-tested |
| Object storage | R2/MinIO | Direct S3, GCS | Zero egress, S3-compatible, MinIO for local dev |
| AI runtime | Cog + PyTorch | ONNX Runtime, TensorRT | Cog gives HTTP + Docker for free; PyTorch for model compat |
| GPU mgmt | Custom VRAM tracker | Ray Serve, Triton | Triton is overkill for 3 models; Ray adds complexity |
| Image processing | sharp | ImageMagick, Pillow | C++ libvips binding, fastest Node.js option, for thumbnails |


---

## 4. Proposed System Architecture

### 4.1 Service Topology

```
                  +-------------------------------+
                  |       NGINX / CDN             |
                  |  (Cloudflare / Caddy dev)     |
                  +--------------+----------------+
                                 |
            +--------------------v---------------------+
            |         API Server (Node.js)              |
            |    Express v5 + TypeScript                |
            |                                           |
            |  +----------+  +--------------+           |
            |  | Auth MW   |  | Rate Limit  |           |
            |  +-----+----+  +------+------+           |
            |        |               |                  |
            |  +-----v---------------v-----------+      |
            |  |       Route Handlers             |      |
            |  | /media /auth /admin /plans       |      |
            |  +---+------------------+----------+      |
            |      |                  |                  |
            +------+------------------+------------------+
                   |                  |
        +----------v---+   +----------v--------------+
        | PostgreSQL 16 |   |       Redis 7            |
        |               |   |                          |
        | - users       |   | +---------------------+ |
        | - media_jobs  |   | | BullMQ Queues       | |
        | - plans       |   | | - media:image       | |
        | - payments    |   | | - media:video       | |
        | - presets     |   | | - media:face        | |
        | - providers   |   | +---------------------+ |
        +---------------+   | +---------------------+ |
                            | | Rate Limit + Cache   | |
                            | +---------------------+ |
                            +----------+--------------+
                                       |
                  +--------------------v---------------------+
                  |       AI Worker Pool (Python)             |
                  |                                           |
                  | +-------------+  +-------------------+   |
                  | | Worker 1    |  | Worker 2           |   |
                  | | GPU 0       |  | GPU 1              |   |
                  | |             |  |                    |   |
                  | | ESRGAN      |  | LTX-Video          |   |
                  | | GFPGAN      |  | (dedicated GPU)    |   |
                  | +-------------+  +-------------------+   |
                  |                                           |
                  | S3 Client <--> Cloudflare R2              |
                  +-------------------------------------------+
```

### 4.2 Service Boundaries

| Service | Runtime | Port | Scaling Unit | Stateless? |
|---------|---------|------|-------------|------------|
| API Server | Node.js 22 | 3000 | Horizontal (CPU) | Yes |
| PostgreSQL | Postgres 16 | 5432 | Vertical (read replicas later) | No |
| Redis | Redis 7 | 6379 | Vertical (cluster later) | No |
| AI Worker (image) | Python 3.11 | Internal | Horizontal (per GPU) | Yes |
| AI Worker (video) | Python 3.11 | Internal | Horizontal (per GPU) | Yes |
| Object Storage | R2 / MinIO | 9000 (dev) | Managed service | N/A |

### 4.3 Key Architectural Principles

1. **API server never touches GPU** — It only enqueues jobs and returns presigned URLs
2. **Workers are ephemeral** — They pull from Redis, process, upload to S3, update DB status
3. **No base64 in database** — Files go directly to S3; DB stores only metadata + S3 keys
4. **Presigned URLs for delivery** — Frontend gets time-limited download URLs, never raw S3 credentials
5. **Model isolation** — Each GPU worker loads one model set; no dynamic model swapping in MVP
6. **Circuit breaker per worker type** — If image workers fail 3x consecutively, mark queue degraded
7. **Idempotent jobs** — Job ID + S3 key are deterministic; reprocessing overwrites same object

---

## 5. Data Flow & Pipeline Design

### 5.1 Upload -> Enhance -> Deliver Flow

```
User                API Server            Redis/BullMQ         AI Worker           S3/R2
 |                      |                      |                   |                 |
 |-- POST /media/upload -->                    |                   |                 |
 |   (multipart file)  |                      |                   |                 |
 |                      |-- Upload raw to S3 (raw/) -------------------------------->|
 |                      |                      |                   |                 |
 |                      |-- INSERT media_jobs (DB)                 |                 |
 |                      |   status=uploaded    |                   |                 |
 |                      |                      |                   |                 |
 | <-- { jobId, status } --|                   |                   |                 |
 |                      |                      |                   |                 |
 |-- POST /media/enhance -->                   |                   |                 |
 |   { jobId, type }   |                      |                   |                 |
 |                      |-- UPDATE status=queued                   |                 |
 |                      |-- queue.add() ------>|                   |                 |
 |                      |                      |                   |                 |
 | <-- { jobId, status } --|                   |                   |                 |
 |                      |                      |                   |                 |
 |                      |                      |-- job dequeued -->|                 |
 |                      |                      |                   |                 |
 |                      |                      |  UPDATE status=processing           |
 |                      |                      |                   |                 |
 |                      |                      |                   |-- Download raw ->|
 |                      |                      |                   |<-- raw file -----|
 |                      |                      |                   |                 |
 |                      |                      |                   |-- AI inference   |
 |                      |                      |                   |   (GPU compute)  |
 |                      |                      |                   |                 |
 |                      |                      |                   |-- Upload result ->|
 |                      |                      |                   |   to S3 (out/)   |
 |                      |                      |                   |                 |
 |                      |                      |  UPDATE status=completed             |
 |                      |                      |  processedKey = "out/..."            |
 |                      |                      |                   |                 |
 |-- GET /media/jobs/:id -->                   |                   |                 |
 |   (polling / WS)    |                      |                   |                 |
 |                      |-- SELECT media_jobs  |                   |                 |
 |                      |-- Generate presigned URL --------------------------------->|
 | <-- { status, downloadUrl } |               |                   |                 |
 |                      |                      |                   |                 |
 |-- GET downloadUrl --------------------------------------------------------->      |
 | <-- Enhanced file <---------------------------------------------------------------|
```

### 5.2 Multi-Stage Pipeline (Auto Enhancement)

When `enhancementType === "auto"`, the system chains multiple models:

```
Stage 1: Analysis
  +-- Detect faces -> count, bounding boxes
  +-- Measure resolution -> current vs target
  +-- Assess quality -> noise level, blur score

Stage 2: Conditional Pipeline (based on analysis)
  +-- IF faces detected:
  |     GFPGAN face restoration (per face, parallel)
  +-- IF resolution < target:
  |     Real-ESRGAN 4x upscale (tile-based)
  +-- IF video:
        Frame extraction -> per-frame pipeline -> reassemble

Stage 3: Post-processing
  +-- sharp: format conversion (WebP/AVIF for web)
  +-- Metadata strip (EXIF privacy)
  +-- Thumbnail generation (3 sizes)
```

### 5.3 BullMQ Queue Configuration

```typescript
// Queue definitions
const QUEUES = {
  'media:image:upscale':  { concurrency: 4, limiter: { max: 10, duration: 60_000 } },
  'media:image:face':     { concurrency: 4, limiter: { max: 10, duration: 60_000 } },
  'media:image:auto':     { concurrency: 2, limiter: { max: 5,  duration: 60_000 } },
  'media:video:generate': { concurrency: 1, limiter: { max: 2,  duration: 300_000 } },
  'media:video:upscale':  { concurrency: 1, limiter: { max: 2,  duration: 300_000 } },
} as const;

// Job options
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400 },  // 24h
  removeOnFail: { age: 604_800 },     // 7d
};

// Priority levels
enum JobPriority {
  PREMIUM = 1,   // Paid users
  STANDARD = 5,  // Free users
  BATCH = 10,    // Background batch jobs
}
```

### 5.4 Database Schema Changes (media_jobs)

```sql
-- Migration: 0003_add_storage_columns.sql

ALTER TABLE media_jobs
  ADD COLUMN raw_storage_key    TEXT,
  ADD COLUMN output_storage_key TEXT,
  ADD COLUMN thumbnail_keys     JSONB,
  ADD COLUMN file_size_bytes    BIGINT,
  ADD COLUMN output_size_bytes  BIGINT,
  ADD COLUMN mime_type          VARCHAR(127),
  ADD COLUMN processing_ms      INTEGER,
  ADD COLUMN worker_id          VARCHAR(64),
  ADD COLUMN error_message      TEXT,
  ADD COLUMN metadata           JSONB;

-- Drop the base64 column (after data migration)
-- ALTER TABLE media_jobs DROP COLUMN base64_data;

-- Indexes for job polling and user queries
CREATE INDEX idx_media_jobs_status ON media_jobs (status) WHERE status IN ('queued', 'processing');
CREATE INDEX idx_media_jobs_user   ON media_jobs (user_id, created_at DESC);
```

### 5.5 S3 Key Schema

```
{bucket}/
  raw/{userId}/{jobId}/{original-filename}     # Original upload
  out/{userId}/{jobId}/{output-filename}       # Enhanced output
  thumb/{userId}/{jobId}/sm.webp               # 150px thumbnail
  thumb/{userId}/{jobId}/md.webp               # 400px thumbnail
  thumb/{userId}/{jobId}/lg.webp               # 800px thumbnail
  temp/{jobId}/                                # Ephemeral (TTL: 24h)
    frames/                                    # Video frame extraction
    intermediate/                              # Pipeline stage outputs
```

---

## 6. Admin & Provider Management Design

### 6.1 Current State (What Exists)

The existing `ProviderKeyManager` (singleton) handles OpenRouter API key pooling with:
- Fisher-Yates shuffle for random key selection
- Latency-weighted routing (prefer faster keys)
- 5-minute health check intervals
- Auto-degradation after 3 consecutive errors per key
- 8 admin REST endpoints for CRUD + rotation + stats

This pattern is **sound** and should be extended, not replaced.

### 6.2 Multi-Provider Abstraction

```typescript
// Provider interface — every AI backend implements this
interface AIProvider {
  readonly name: string;
  readonly type: 'self-hosted' | 'cloud-api';
  readonly capabilities: AICapability[];
  readonly status: ProviderStatus;

  // Core operations
  predict(input: PredictionInput): Promise<PredictionOutput>;
  healthCheck(): Promise<HealthCheckResult>;
  getMetrics(): ProviderMetrics;

  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

type AICapability =
  | 'image:upscale'
  | 'image:face-restore'
  | 'image:color-correct'
  | 'image:style-transfer'
  | 'video:generate'
  | 'video:upscale'
  | 'video:face-restore';

type ProviderStatus = 'healthy' | 'degraded' | 'down' | 'initializing';

// Concrete providers
class SelfHostedESRGAN implements AIProvider { /* Cog HTTP client */ }
class SelfHostedGFPGAN implements AIProvider { /* Cog HTTP client */ }
class SelfHostedLTXVideo implements AIProvider { /* Cog HTTP client */ }
class ReplicateProvider implements AIProvider { /* Replicate API */ }
class FalAIProvider implements AIProvider { /* fal.ai API */ }
class RunPodProvider implements AIProvider { /* RunPod serverless */ }
```

### 6.3 Provider Registry (Admin-Managed)

```typescript
class ProviderRegistry {
  private providers = new Map<string, AIProvider>();
  private routingTable = new Map<AICapability, AIProvider[]>();

  // Admin operations
  registerProvider(config: ProviderConfig): void;
  deregisterProvider(name: string): void;
  setProviderStatus(name: string, status: ProviderStatus): void;

  // Routing
  getProvider(capability: AICapability): AIProvider;  // Returns best available
  getProviders(capability: AICapability): AIProvider[];  // All available
  getFallbackChain(capability: AICapability): AIProvider[];  // Priority-ordered

  // Monitoring
  getHealthReport(): HealthReport;
  getUsageStats(timeRange: TimeRange): UsageStats;
}
```

### 6.4 Provider Routing Strategy

```
Request for image:upscale arrives
  |
  v
Check ProviderRegistry.routingTable['image:upscale']
  |
  v
Priority chain:
  1. SelfHostedESRGAN (if healthy, lowest cost)
  2. ReplicateProvider (if self-hosted degraded)
  3. FalAIProvider (if Replicate rate-limited)
  |
  v
Selected provider.predict(input)
  |
  v
On success: record latency, update stats
On failure: mark degraded, try next in chain, circuit breaker
```

### 6.5 Admin Dashboard Endpoints (New)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/ai/providers` | List all AI providers with status |
| POST | `/admin/ai/providers` | Register new provider |
| PATCH | `/admin/ai/providers/:id` | Update provider config |
| DELETE | `/admin/ai/providers/:id` | Deregister provider |
| POST | `/admin/ai/providers/:id/health-check` | Force health check |
| GET | `/admin/ai/queues` | BullMQ queue stats (depth, processing, failed) |
| POST | `/admin/ai/queues/:name/pause` | Pause a queue |
| POST | `/admin/ai/queues/:name/resume` | Resume a queue |
| POST | `/admin/ai/queues/:name/drain` | Drain failed jobs |
| GET | `/admin/ai/workers` | Active worker instances + GPU utilization |
| GET | `/admin/ai/metrics` | Prometheus-format metrics |
| GET | `/admin/ai/costs` | Cost tracking per provider per day |

### 6.6 Database Schema: AI Providers

```sql
CREATE TABLE ai_providers (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(64) UNIQUE NOT NULL,
  type          VARCHAR(32) NOT NULL,  -- 'self-hosted', 'replicate', 'fal', 'runpod'
  base_url      TEXT NOT NULL,
  api_key       TEXT,                  -- Encrypted at rest
  capabilities  JSONB NOT NULL,        -- ['image:upscale', 'image:face-restore']
  config        JSONB DEFAULT '{}',    -- Provider-specific config
  status        VARCHAR(32) DEFAULT 'initializing',
  priority      INTEGER DEFAULT 10,    -- Lower = higher priority
  max_concurrent INTEGER DEFAULT 4,
  cost_per_unit  NUMERIC(10, 6),       -- USD per prediction
  is_enabled    BOOLEAN DEFAULT true,
  health_checked_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ai_provider_usage (
  id            SERIAL PRIMARY KEY,
  provider_id   INTEGER REFERENCES ai_providers(id),
  job_id        INTEGER REFERENCES media_jobs(id),
  capability    VARCHAR(64) NOT NULL,
  input_size    BIGINT,
  output_size   BIGINT,
  processing_ms INTEGER,
  cost_usd      NUMERIC(10, 6),
  status        VARCHAR(32) NOT NULL,  -- 'success', 'failed', 'timeout'
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Scalability Plan

### 7.1 Scaling Dimensions

| Dimension | MVP (1-100 users) | V1 (100-10K users) | V2 (10K+ users) |
|-----------|-------------------|---------------------|-------------------|
| API Server | 1 instance | 2-4 instances (PM2/Docker) | K8s HPA, 4-16 pods |
| PostgreSQL | Single instance | Read replica | PgBouncer + read replicas |
| Redis | Single instance | Sentinel (HA) | Redis Cluster (6 nodes) |
| AI Workers (image) | 1 GPU (RTX 4090) | 2-4 GPUs | Auto-scaling GPU pool |
| AI Workers (video) | 1 GPU (A100/H100) | 2 dedicated GPUs | RunPod serverless burst |
| Object Storage | MinIO (local) | R2 (single bucket) | R2 + CDN + regional |
| Queue Depth | ~10 concurrent | ~100 concurrent | ~1000+ concurrent |

### 7.2 GPU Resource Planning

#### Image Enhancement Workload (ESRGAN + GFPGAN)

```
Per-image pipeline:
  ESRGAN 4x upscale:  ~200ms (512x512 tile), ~1.5GB VRAM
  GFPGAN face restore: ~100ms per face, ~2GB VRAM
  Total per image:     ~500ms average (including overhead)

Single RTX 4090 (24GB VRAM):
  Both models loaded:  ~4GB VRAM used
  Concurrency:         4 parallel jobs (16GB headroom for tiles)
  Throughput:          ~8 images/second
  Daily capacity:      ~690,000 images
```

#### Video Generation Workload (LTX-Video 2B)

```
Per-video pipeline:
  LTX-2 2B model:     ~8GB VRAM (FP8)
  Generation (5s clip): ~10-30s on H100, ~60-120s on A100
  Generation (30s clip): ~60-180s on H100

Single H100 (80GB VRAM):
  Model loaded:        ~8GB VRAM
  Concurrency:         1 (sequential, memory-safe)
  Throughput:          ~2-6 clips/minute (5s each)
  Daily capacity:      ~3,000-8,000 clips
```

### 7.3 Cost Estimates (Cloud GPU)

| Provider | GPU | $/hr | Image throughput | Video throughput |
|----------|-----|------|-----------------|-----------------|
| RunPod | RTX 4090 | $0.44/hr | ~8 img/s | N/A |
| RunPod | A100 80GB | $1.64/hr | ~12 img/s | ~2 clips/min |
| RunPod | H100 SXM | $3.89/hr | ~16 img/s | ~6 clips/min |
| Lambda | A100 80GB | $1.25/hr | ~12 img/s | ~2 clips/min |
| Replicate | Serverless | ~$0.002/img | On-demand | ~$0.05/clip |

**MVP Budget**: 1x RTX 4090 ($0.44/hr = ~$320/mo) for images + Replicate serverless for video bursts.

### 7.4 Scaling Triggers

| Metric | Threshold | Action |
|--------|-----------|--------|
| Queue depth (image) | > 50 jobs waiting | Scale up image workers |
| Queue depth (video) | > 10 jobs waiting | Activate RunPod serverless |
| P95 latency (image) | > 5 seconds | Add image worker instance |
| P95 latency (video) | > 3 minutes | Add video worker or upgrade GPU |
| Error rate | > 5% over 5 min | Alert + circuit breaker |
| GPU utilization | < 20% for 30 min | Scale down (save cost) |
| Storage usage | > 80% bucket quota | Alert + cleanup old temp files |

### 7.5 Horizontal Scaling Architecture

```
                    Load Balancer (nginx/Cloudflare)
                              |
          +-------------------+-------------------+
          |                   |                   |
     API Server 1        API Server 2        API Server N
          |                   |                   |
          +-------------------+-------------------+
                              |
                         Redis Cluster
                    (BullMQ queue broker)
                              |
          +-------------------+-------------------+
          |                   |                   |
    Image Worker 1      Image Worker 2      Video Worker 1
    (RTX 4090)          (RTX 4090)          (H100)
    ESRGAN + GFPGAN     ESRGAN + GFPGAN     LTX-Video
          |                   |                   |
          +-------------------+-------------------+
                              |
                    Cloudflare R2 (S3)
```

---

## 8. Security & Reliability

### 8.1 Security Architecture

#### Authentication & Authorization
- **JWT tokens** (30-day expiry, RS256 signing in V1)
- **RBAC**: `user` and `admin` roles (existing)
- **API key rotation**: Admin can rotate provider keys without downtime (existing ProviderKeyManager)
- **Presigned URLs**: Time-limited (15 min default), scoped to specific S3 objects
- **No raw credentials in frontend**: All S3 access via presigned URLs from API server

#### Input Validation & Sanitization
- **File type validation**: Magic bytes check (not just MIME type from header)
- **File size limits**: 50MB images, 500MB videos (configurable per plan)
- **Image dimension limits**: Max 8192x8192 (prevent VRAM OOM)
- **Rate limiting**: Per-user, per-endpoint, sliding window (Redis-backed)
  - Free tier: 10 enhancements/hour, 2 video generations/day
  - Pro tier: 100 enhancements/hour, 20 video generations/day
- **Request size limit**: 100MB max body (Express middleware)

#### Data Protection
- **API keys encrypted at rest**: AES-256-GCM in database, decrypted only in memory
- **EXIF stripping**: All uploaded images have metadata removed before storage
- **Content isolation**: S3 keys namespaced by userId (no cross-user access)
- **Temporary file cleanup**: TTL-based lifecycle rules on S3 temp/ prefix (24h)
- **No PII in logs**: pino serializers redact email, tokens, file contents

#### Infrastructure Security
- **Network isolation**: AI workers have no public endpoints (Redis-only communication)
- **Docker security**: Non-root containers, read-only filesystem, no privileged mode
- **Dependency scanning**: `pnpm audit` in CI, Dependabot alerts
- **CORS**: Strict origin allowlist (not wildcard in production)

### 8.2 Reliability Patterns

#### Circuit Breaker (per provider)

```typescript
interface CircuitBreakerConfig {
  failureThreshold: 3;      // Consecutive failures to trip
  resetTimeout: 60_000;     // Ms before half-open attempt
  halfOpenMax: 1;            // Requests allowed in half-open state
}

// States: CLOSED -> OPEN -> HALF_OPEN -> CLOSED
// On OPEN: all requests to this provider immediately fail
// On HALF_OPEN: allow 1 test request; success = CLOSED, failure = OPEN
```

#### Retry Strategy

```typescript
// BullMQ job retry config
{
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5_000,     // 5s, 10s, 20s
  },
}

// Provider-level retry (before marking job as failed)
// 1. Try primary provider (self-hosted)
// 2. Try fallback provider (Replicate)
// 3. Try second fallback (fal.ai)
// 4. Mark job failed, notify user
```

#### Health Monitoring

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| API response time (P95) | Express middleware | > 2s |
| Job queue depth | BullMQ metrics | > 100 (image), > 20 (video) |
| Job failure rate | BullMQ events | > 5% over 5 min |
| GPU utilization | nvidia-smi exporter | < 10% or > 95% sustained |
| GPU temperature | nvidia-smi exporter | > 85C |
| Worker heartbeat | BullMQ worker events | Missing for > 60s |
| S3 error rate | aws-sdk metrics | > 1% |
| Redis memory | Redis INFO | > 80% maxmemory |
| PostgreSQL connections | pg_stat_activity | > 80% max_connections |
| Disk usage (temp) | Node.js fs | > 90% |

#### Graceful Degradation

```
Normal mode:
  All providers healthy -> full feature set

Degraded mode (self-hosted GPU down):
  Cloud fallback active -> features work, higher latency + cost
  Admin notified via webhook

Limited mode (all providers down):
  Queue accepts jobs but doesn't process
  Frontend shows "Processing delayed" instead of error
  Jobs auto-retry when providers recover

Maintenance mode (admin-triggered):
  Queue paused, new uploads accepted but not processed
  Clear user messaging: "Enhancement temporarily unavailable"
```

### 8.3 Disaster Recovery

| Scenario | RTO | RPO | Recovery Action |
|----------|-----|-----|-----------------|
| API server crash | < 30s | 0 | Docker auto-restart / PM2 |
| Worker crash | < 60s | Per-job | BullMQ stalled job detection + re-queue |
| Redis failure | < 5 min | Queue state | Redis Sentinel failover |
| PostgreSQL failure | < 10 min | < 1 min | WAL-based replica promotion |
| S3/R2 outage | N/A | N/A | Cloudflare SLA (99.999% durability) |
| GPU hardware failure | < 30 min | Per-job | Cloud burst to RunPod serverless |

---

## 9. Build Roadmap (MVP / V1 / V2)

### 9.1 MVP — "Real Inference" (4-6 weeks)

**Goal**: Replace setTimeout() placeholder with actual AI processing for images.

#### Week 1-2: Infrastructure Foundation
- [ ] Add Redis to docker-compose.yml
- [ ] Add MinIO to docker-compose.yml (S3-compatible local storage)
- [ ] Install BullMQ + ioredis + @aws-sdk/client-s3 in api-server
- [ ] Create S3 storage service (`lib/storage.ts`)
  - uploadFile(), downloadFile(), getPresignedUrl(), deleteFile()
- [ ] Create BullMQ queue service (`lib/queue.ts`)
  - Queue definitions, job producers, event handlers
- [ ] Migrate /media/upload from base64-in-DB to S3 upload
- [ ] Add `raw_storage_key`, `output_storage_key` columns to media_jobs
- [ ] Fix broken build (create or remove gemini imports in bootstrap.ts + routes/index.ts)

#### Week 3-4: AI Engine (Python)
- [ ] Create `ai-engine/` directory with Cog structure
- [ ] Implement Real-ESRGAN predictor (image upscaling)
  - Download RealESRGAN_x4plus.pth model weights
  - Cog predict.py with tile-based processing
  - Docker build with CUDA 12 base
- [ ] Implement GFPGAN predictor (face restoration)
  - Download GFPGANv1.4.pth model weights
  - Integration with Real-ESRGAN for background enhancement
- [ ] Create BullMQ worker (Python side)
  - Redis connection, job consumer, S3 upload of results
  - Status updates back to PostgreSQL

#### Week 5-6: Integration & Testing
- [ ] Connect API server queue producers to Python workers
- [ ] Update /media/jobs/:id to return presigned download URLs
- [ ] Frontend: update editor.tsx to use download URLs instead of processedUrl
- [ ] End-to-end test: upload image -> queue -> process -> download
- [ ] Error handling: failed jobs, retries, timeout (5 min max)
- [ ] Admin: basic queue monitoring endpoint (GET /admin/ai/queues)
- [ ] Load test: 50 concurrent image jobs

**MVP Deliverable**: User uploads photo -> Real-ESRGAN upscales it -> user downloads enhanced photo. Face restoration available as enhancement type.

### 9.2 V1 — "Production Ready" (6-8 weeks after MVP)

**Goal**: Multi-provider support, video generation, monitoring, billing integration.

#### Provider System
- [ ] Implement AIProvider interface + ProviderRegistry
- [ ] Self-hosted providers (Cog HTTP clients)
- [ ] Cloud providers: Replicate adapter, fal.ai adapter
- [ ] Provider routing with fallback chains
- [ ] Circuit breaker per provider
- [ ] Admin AI provider management endpoints

#### Video Generation
- [ ] LTX-Video 2B predictor (Cog container)
- [ ] Video generation queue (media:video:generate)
- [ ] Video upscaling queue (ESRGAN frame-by-frame)
- [ ] Frontend: video upload and generation UI
- [ ] Progress reporting via WebSocket (for long video jobs)

#### Monitoring & Operations
- [ ] Prometheus metrics exporter (prom-client)
- [ ] Grafana dashboards (queue depth, latency, GPU utilization, costs)
- [ ] PagerDuty/Slack alerting for critical thresholds
- [ ] Structured logging with correlation IDs
- [ ] Admin dashboard: live queue view, worker status, cost tracking

#### Billing Integration
- [ ] Track cost_per_prediction per provider
- [ ] Usage metering per user (images processed, video seconds generated)
- [ ] Connect to plans table: enforce rate limits by plan tier
- [ ] Stripe webhook -> unlock higher limits on payment

#### Security Hardening
- [ ] Magic bytes file validation (not just MIME type)
- [ ] Content scanning (optional: NSFW detection)
- [ ] API key encryption at rest (AES-256-GCM)
- [ ] RS256 JWT signing (replace HS256)
- [ ] Presigned URL expiry and audit logging

### 9.3 V2 — "Scale & Differentiate" (8-12 weeks after V1)

**Goal**: ComfyUI workflows, auto-scaling GPU pool, advanced features.

#### ComfyUI Integration
- [ ] Deploy ComfyUI as isolated GPL-3 service (separate container)
- [ ] API bridge: translate GlimpseAI jobs to ComfyUI workflow JSON
- [ ] Custom workflow templates (admin-managed)
- [ ] Support for community model nodes (ControlNet, IP-Adapter, etc.)

#### Auto-Scaling GPU Pool
- [ ] Kubernetes with NVIDIA GPU Operator
- [ ] Horizontal Pod Autoscaler based on queue depth
- [ ] Spot instance support (RunPod, Lambda) for cost optimization
- [ ] GPU utilization-based scaling (scale down when idle)

#### Advanced Features
- [ ] Batch processing (upload ZIP, process all, download ZIP)
- [ ] Style transfer presets (linked to model + parameters)
- [ ] A/B comparison view (original vs enhanced side-by-side)
- [ ] History gallery with re-processing capability
- [ ] API access for developers (API keys, rate limits, documentation)
- [ ] Webhook notifications (job complete, job failed)

#### Data Pipeline
- [ ] Analytics: processing time distributions, model performance
- [ ] A/B testing framework for model versions
- [ ] Model version management (blue/green deployment)
- [ ] Automated quality scoring (PSNR, SSIM, LPIPS)

---

## 10. Final Recommendation

### What to Build Now (Immediate Actions)

1. **Fix the broken build** — Remove or stub the missing gemini-key-manager.ts and gemini.ts imports in bootstrap.ts and routes/index.ts. This is blocking all development.

2. **Add Redis + MinIO to docker-compose.yml** — Two services, ~10 lines of YAML. This unblocks queue and storage work.

3. **Create the S3 storage service** — A single `lib/storage.ts` file (~150 lines) that wraps @aws-sdk/client-s3 with uploadFile, downloadFile, getPresignedUrl. This eliminates the base64-in-PostgreSQL anti-pattern.

4. **Create the BullMQ queue service** — A single `lib/queue.ts` file (~200 lines) that defines queues, produces jobs, and handles events. This replaces the setTimeout() placeholder.

5. **Build the first Cog predictor** — Start with Real-ESRGAN (simplest model, most impact). One `cog.yaml` + one `predict.py` = working image upscaling in a Docker container.

### What NOT to Build Yet

- **ComfyUI integration** — GPL-3 licensing requires careful isolation. Defer to V2.
- **Video generation** — LTX-Video needs dedicated GPU (H100). Get image pipeline working first.
- **Kubernetes** — Docker Compose is sufficient until 10K+ users. Don't over-engineer infra.
- **Custom model training** — Use pre-trained weights. Fine-tuning is a V2+ concern.
- **Real-time streaming** — WebSocket progress updates are V1. Polling every 2s (existing) works for MVP.

### Architecture Confidence Level

| Component | Confidence | Risk |
|-----------|-----------|------|
| BullMQ + Redis for job queue | **Very High** | Low — battle-tested, TypeScript-native |
| S3/R2 for storage | **Very High** | Low — industry standard |
| Real-ESRGAN for upscaling | **Very High** | Low — 35K stars, BSD-3, proven |
| GFPGAN for face restore | **High** | Low — Apache 2.0, same author as ESRGAN |
| Cog for model packaging | **High** | Medium — learning curve, but great docs |
| LTX-Video for video gen | **High** | Medium — newer, needs dedicated GPU budget |
| Provider abstraction | **Medium-High** | Medium — design may evolve with real usage |
| ComfyUI for V2 workflows | **Medium** | Medium-High — GPL-3 isolation, complexity |

### Cost Summary

| Phase | Monthly Infrastructure | GPU Compute | Total |
|-------|----------------------|-------------|-------|
| MVP | ~$50 (VPS + DB + Redis) | ~$320 (1x RTX 4090) | **~$370/mo** |
| V1 | ~$150 (scaled VPS + monitoring) | ~$800 (2x 4090 + burst) | **~$950/mo** |
| V2 | ~$400 (K8s cluster + services) | ~$2,000 (GPU pool) | **~$2,400/mo** |

### The One-Sentence Summary

> **Build a BullMQ + Redis job queue that routes media jobs from the Express API to Cog-containerized Python workers running Real-ESRGAN and GFPGAN, with S3-compatible storage replacing base64, and a provider abstraction that lets you swap between self-hosted GPUs and cloud APIs (Replicate/fal.ai) without changing application code.**

---

*This document should be treated as a living architecture spec. Update it as decisions are validated or invalidated during implementation. Every code change to the AI pipeline should reference the relevant section of this document.*
