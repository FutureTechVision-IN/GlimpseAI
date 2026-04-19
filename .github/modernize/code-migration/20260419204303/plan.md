# TypeScript Package Upgrade Plan

**Migration Session ID:** 304887c3-9def-4cac-b01e-215a4167013a  
**Created:** 2026-04-19 20:43:03  
**Uncommitted Changes Policy:** Always Stash  
**Target Branch:** `appmod/typescript-upgrade-20260419204303`

---

## Project Details

- **Language:** TypeScript
- **Package Manager:** pnpm
- **Is Monorepo:** Yes
- **Angular:** No
- **TypeScript Migration Needed:** No

---

## Feature Flags

| Flag | Value |
|------|-------|
| enableTestValidation | true |
| validateRuntime | true |
| validateBundlerChanges | false |
| runNpmAudit | false |
| disableKnowledgeBase | false |

---

## Upgrade Groups by Package

### 1. `artifacts/api-server`

| Group | Packages |
|-------|---------|
| 1 | `pino-http` |
| 2 | `sharp` |
| 3 | `pino`, `esbuild`, `thread-stream` |

### 2. `artifacts/mockup-sandbox`

| Group | Packages |
|-------|---------|
| 1 | `@hookform/resolvers`, `@radix-ui/react-toast`, `react-day-picker`, `react-hook-form`, `react-resizable-panels`, `recharts` |
| 2 | `chokidar` |
| 3 | `date-fns` |

### 3. `artifacts/glimpse-ai`

| Group | Packages |
|-------|---------|
| 1 | `@hookform/resolvers`, `@radix-ui/react-accordion`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-aspect-ratio`, `@radix-ui/react-avatar`, `@radix-ui/react-checkbox`, `@radix-ui/react-collapsible`, `@radix-ui/react-context-menu`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-hover-card`, `@radix-ui/react-label`, `@radix-ui/react-menubar`, `@radix-ui/react-navigation-menu`, `@radix-ui/react-popover`, `@radix-ui/react-progress`, `@radix-ui/react-radio-group`, `@radix-ui/react-scroll-area`, `@radix-ui/react-select`, `@radix-ui/react-separator`, `@radix-ui/react-slider`, `@radix-ui/react-slot`, `@radix-ui/react-switch`, `@radix-ui/react-tabs`, `@radix-ui/react-toast`, `@radix-ui/react-toggle`, `@radix-ui/react-toggle-group`, `@radix-ui/react-tooltip`, `react-day-picker`, `react-hook-form`, `react-icons`, `react-resizable-panels`, `recharts`, `wouter` |
| 2 | `@tailwindcss/typography` |
| 3 | `date-fns` |

### 4. `lib/db`

| Group | Packages |
|-------|---------|
| 1 | `@types/pg` |
| 2 | `drizzle-kit` |

### 5. `lib/api-spec`

| Group | Packages |
|-------|---------|
| 1 | `orval` |

### No-change packages

- `scripts` — no upgradeable dependencies
- `lib/api-zod` — no upgradeable dependencies
- `lib/api-client-react` — no upgradeable dependencies

---

## Progress File

See [progress.md](./progress.md)
