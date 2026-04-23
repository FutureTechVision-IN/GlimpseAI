<p align="center">
  <img src="artifacts/glimpse-ai/public/favicon.svg" width="64" height="64" alt="GlimpseAI" />
</p>

<h1 align="center">GlimpseAI</h1>

<p align="center">
  <strong>Cinematic edits. Zero effort.</strong><br />
  An AI-powered media enhancement platform that transforms ordinary photos and videos into professional-grade content.
</p>

<p align="center">
  <a href="https://futuretechvision-in.github.io/GlimpseAI/">Live Demo</a>&ensp;·&ensp;
  <a href="#architecture">Architecture</a>&ensp;·&ensp;
  <a href="#getting-started">Getting Started</a>&ensp;·&ensp;
  <a href="#license">License</a>
</p>

---

## Overview

GlimpseAI delivers the capabilities of a high-end creative studio directly through the browser. Built on state-of-the-art generative AI models, the platform provides instant image upscaling, automated video enhancement, and intelligent retouching — reducing workflows that traditionally require hours of manual editing to a single click.

The system is designed for photographers, content creators, marketing teams, and film editors who demand professional output quality without the overhead of complex toolchains.

### Core Capabilities

| Feature | Description |
|---|---|
| **AI Upscaling** | Transforms low-resolution images into high-definition output while preserving fine detail and minimizing artifacts. |
| **Video Enhancement** | Stabilizes footage, corrects lighting, and applies cinematic color grading automatically. |
| **Magic Retouch** | Removes blemishes, smooths skin, and perfects portraits while maintaining a natural appearance. |
| **Multi-Provider Intelligence** | Routes enhancement requests across multiple AI providers (OpenRouter, Google Gemini) with automatic key rotation and load balancing. |
| **Usage Analytics** | Comprehensive admin dashboard with per-key usage tracking, cost monitoring, and rate limit management. |

---

## Architecture

GlimpseAI is structured as a **pnpm monorepo** with clear separation between shared libraries, backend services, and frontend applications.

```
┌─────────────────────────────────────────────────────────┐
│                      Monorepo Root                      │
├──────────────┬──────────────────┬───────────────────────┤
│  lib/        │  artifacts/      │  scripts/             │
│  ├─ api-spec │  ├─ api-server   │  └─ build utilities   │
│  ├─ api-zod  │  ├─ glimpse-ai   │                       │
│  ├─ api-client│ └─ mockup-sandbox│                      │
│  └─ db       │                  │                       │
└──────────────┴──────────────────┴───────────────────────┘
```

### Related Design Docs

- [`docs/ARCHITECTURE-AI-BACKEND.md`](docs/ARCHITECTURE-AI-BACKEND.md) — AI backend architecture proposal
- [`docs/FILTER-PIPELINE-MODERNIZATION.md`](docs/FILTER-PIPELINE-MODERNIZATION.md) — canonical filter registry, preview/save consistency, and validation specification

### Technology Stack

**Frontend** — `artifacts/glimpse-ai/`
- React 19 with TypeScript
- Vite build system
- Tailwind CSS v4 + shadcn/ui component library
- TanStack Query with auto-generated hooks (via Orval)
- Wouter for client-side routing
- Framer Motion for animations
- Recharts for analytics visualizations

**Backend** — `artifacts/api-server/`
- Express 5 with TypeScript
- Drizzle ORM with PostgreSQL 16
- Pino structured logging
- JWT-based authentication with bcrypt password hashing
- Sharp for server-side image processing
- esbuild for production bundling

**Shared Libraries** — `lib/`
- `api-spec` — OpenAPI 3.1 specification (single source of truth)
- `api-zod` — Auto-generated Zod validation schemas
- `api-client-react` — Auto-generated React Query hooks and fetch client
- `db` — Drizzle schema definitions and migration configuration

**Infrastructure**
- Docker Compose orchestration (PostgreSQL, API server, web frontend)
- GitHub Pages for static demo deployment

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+
- [Docker](https://www.docker.com/) and Docker Compose

### Quick Start

```bash
# Clone the repository
git clone https://github.com/FutureTechVision-IN/GlimpseAI.git
cd GlimpseAI

# Install dependencies
pnpm install

# Copy environment configuration
cp .env.example .env
# Edit .env with your API keys and configuration

# Start all services
docker compose up -d

# The application will be available at:
#   Frontend  → http://localhost:5173
#   API       → http://localhost:3001/api/healthz
#   Database  → localhost:5432
```

### Development

```bash
# Run type checking across the monorepo
pnpm run typecheck

# Build all packages
pnpm run build

# Regenerate API client from OpenAPI spec
cd lib/api-spec && pnpm run generate
```

---

## Project Structure

| Path | Purpose |
|---|---|
| `artifacts/api-server/` | Express REST API — authentication, media processing, payments, admin |
| `artifacts/glimpse-ai/` | React SPA — landing page, editor, dashboard, billing, admin panel |
| `artifacts/mockup-sandbox/` | Isolated UI prototyping environment |
| `lib/api-spec/` | OpenAPI 3.1 specification |
| `lib/api-zod/` | Generated Zod schemas for runtime validation |
| `lib/api-client-react/` | Generated TanStack Query hooks |
| `lib/db/` | Drizzle ORM schema and database configuration |
| `scripts/` | Build and deployment utilities |

---

## API

The API is defined by a single OpenAPI 3.1 specification at [`lib/api-spec/openapi.yaml`](lib/api-spec/openapi.yaml). All client code and validation schemas are auto-generated from this spec, ensuring type safety across the full stack.

**Domains covered:** Authentication, User Management, Media Processing, Subscription Plans, Payments, Admin Operations, AI Provider Management.

---

## Contributing

GlimpseAI is currently developed under a **closed contribution model**. External pull requests and issues are not accepted at this time.

### Internal Collaboration

For authorized contributors within the FutureTechVision organization:

1. **Branch strategy** — Work on feature branches prefixed with your scope (e.g., `feat/upscaling-v2`, `fix/auth-token-refresh`). Target `dev` for integration; `main` is the release branch.
2. **Code generation** — After modifying `openapi.yaml`, regenerate client and validation code before committing. Do not manually edit files under `generated/` directories.
3. **Type safety** — Run `pnpm run typecheck` before pushing. The monorepo enforces strict TypeScript across all packages.
4. **Commit messages** — Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`.
5. **Environment variables** — Never commit `.env` files or API keys. Use `.env.example` as the template.

---

## Security

If you discover a security vulnerability, **do not** open a public issue. Instead, contact the team directly at **futuretechvision.global@gmail.com** with a detailed description. We take all reports seriously and will respond promptly.

---

## License

This project is released under a **proprietary license**. You may view the source code for evaluation purposes, but copying, modification, and distribution are prohibited without explicit written authorization from FutureTechVision.

See [LICENSE](LICENSE) for the full terms.

---

<p align="center">
  <sub>Built by <a href="https://github.com/FutureTechVision-IN">FutureTechVision</a> · © 2026 All rights reserved.</sub>
</p>
