#!/usr/bin/env bash
# =============================================================================
# GlimpseAI — Unified Startup Script
# Supports: --docker | --native | --hybrid | auto-detect
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${ROOT_DIR}/.glimpse"
PID_FILE="${STATE_DIR}/pids"
MODE_FILE="${STATE_DIR}/mode"
MODE=""
BUILD=0
SKIP_RESTORATION=0
RESTORATION_PORT="${RESTORATION_PORT:-7860}"

# ---------------------------------------------------------------------------
# Source .env (if present) so all vars are available before defaults kick in
# ---------------------------------------------------------------------------
load_env() {
  local env_file="${ROOT_DIR}/.env"
  if [ ! -f "${env_file}" ]; then
    return
  fi

  while IFS= read -r line || [ -n "${line}" ]; do
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// /}" ]] && continue
    local key val
    key="${line%%=*}"
    val="${line#*=}"
    val="${val#\'}" ; val="${val%\'}"
    val="${val#\"}" ; val="${val%\"}"
    export "${key}=${val}"
  done < "${env_file}"
}

load_env

# ---------------------------------------------------------------------------
# Defaults — only apply when the variable was NOT already set (incl. from .env)
# ---------------------------------------------------------------------------
WEB_PORT="${WEB_PORT:-5173}"
API_PORT="${API_PORT:-3001}"
DB_PORT="${DB_PORT:-5432}"
BASE_PATH="${BASE_PATH:-/}"
POSTGRES_DB="${POSTGRES_DB:-glimpseai}"
POSTGRES_USER="${POSTGRES_USER:-bipbabu}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
SESSION_SECRET="${SESSION_SECRET:-glimpse-ai-local-dev-secret}"
RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID:-rzp_test_placeholder}"
RAZORPAY_KEY_SECRET="${RAZORPAY_KEY_SECRET:-placeholder_secret}"

usage() {
  cat <<EOF
Usage:
  ./start.sh                           Auto-detect and start
  ./start.sh --docker                  Full Docker mode (all services in containers)
  ./start.sh --native                  No Docker, native Node.js (uses local postgres)
  ./start.sh --hybrid                  Docker DB + native API/web/restoration
  ./start.sh --docker --build          Rebuild images and start Docker
  ./start.sh --native --no-restoration Skip restoration service

Flags:
  --docker           Run everything in Docker containers
  --native           Run everything natively (requires local PostgreSQL)
  --hybrid           Docker database + native application services
  --build            Force rebuild of Docker images
  --no-restoration   Skip starting the Python restoration service
  -h, --help         Show this help message

Environment overrides (or set in .env):
  WEB_PORT, API_PORT, DB_PORT, RESTORATION_PORT, BASE_PATH
  DATABASE_URL
  POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
  SESSION_SECRET, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
  RESTORATION_SERVICE_URL
EOF
}

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
log() {
  printf '\033[1;36m[start]\033[0m %s\n' "$*"
}

log_ok() {
  printf '\033[1;32m[start] ✓\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[start] ⚠\033[0m %s\n' "$*"
}

die() {
  printf '\033[1;31m[start] ✗\033[0m %s\n' "$*" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

port_in_use() {
  local port="$1"
  if has_cmd lsof; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  (echo >"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1
}

find_free_port() {
  local base_port="$1"
  for offset in 0 1 2 3 4 5 6 7 8 9; do
    local candidate=$((base_port + offset))
    if ! port_in_use "${candidate}"; then
      echo "${candidate}"
      return
    fi
  done
  die "No free port found in range ${base_port}–$((base_port + 9))"
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif has_cmd docker-compose; then
    docker-compose "$@"
  else
    die "Docker Compose is required for this mode."
  fi
}

# ---------------------------------------------------------------------------
# State management — persists mode and PIDs for stop.sh
# ---------------------------------------------------------------------------
init_state() {
  mkdir -p "${STATE_DIR}"
  : > "${PID_FILE}"
}

save_mode() {
  echo "${MODE}" > "${MODE_FILE}"
}

record_pid() {
  local label="$1" pid="$2"
  echo "${label}=${pid}" >> "${PID_FILE}"
}

# ---------------------------------------------------------------------------
# Pre-start cleanup
# ---------------------------------------------------------------------------
cleanup_containers() {
  if ! has_cmd docker || ! docker info >/dev/null 2>&1; then
    return
  fi

  local running
  running="$(docker_compose -f "${ROOT_DIR}/docker-compose.yml" ps --services --status running 2>/dev/null || true)"
  if [ -n "${running}" ]; then
    log "Stopping existing GlimpseAI containers"
    docker_compose -f "${ROOT_DIR}/docker-compose.yml" stop >/dev/null 2>&1 || true
  fi
}

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------
ensure_pnpm() {
  if has_cmd pnpm; then
    return
  fi
  if has_cmd corepack; then
    log "Enabling pnpm via corepack"
    corepack enable >/dev/null 2>&1 || true
  fi
  has_cmd pnpm || die "pnpm is required but was not found."
}

ensure_native_deps() {
  ensure_pnpm
  if [ ! -d "${ROOT_DIR}/node_modules" ]; then
    log "Installing workspace dependencies with pnpm"
    (cd "${ROOT_DIR}" && pnpm install --frozen-lockfile)
  fi
}

require_docker() {
  has_cmd docker || die "Docker is required for this mode."
  docker info >/dev/null 2>&1 || die "Docker is installed but not running."
}

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
wait_for_db() {
  local port="${1:-${DB_PORT}}"
  local attempts=30
  log "Waiting for PostgreSQL on port ${port}..."

  for ((i = 1; i <= attempts; i++)); do
    if has_cmd pg_isready; then
      if pg_isready -h 127.0.0.1 -p "${port}" -q 2>/dev/null; then
        log_ok "PostgreSQL ready on port ${port}"
        return
      fi
    elif (echo >"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1; then
      log_ok "PostgreSQL ready on port ${port}"
      return
    fi
    sleep 2
  done

  die "PostgreSQL did not become ready on port ${port} after ${attempts} attempts."
}

ensure_database() {
  if ! has_cmd psql; then
    log "psql not found — skipping database existence check (drizzle-kit push will handle it)"
    return
  fi

  local db_name="${POSTGRES_DB}"
  local db_user="${POSTGRES_USER}"
  local db_port="${DB_PORT}"
  local exists
  exists="$(PGPASSWORD="${POSTGRES_PASSWORD}" psql -U "${db_user}" -h 127.0.0.1 -p "${db_port}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${db_name}'" 2>/dev/null || true)"
  if [ "${exists}" != "1" ]; then
    log "Creating database '${db_name}'"
    PGPASSWORD="${POSTGRES_PASSWORD}" psql -U "${db_user}" -h 127.0.0.1 -p "${db_port}" -d postgres -c "CREATE DATABASE \"${db_name}\"" 2>/dev/null \
      || warn "Could not create database '${db_name}' — it may already exist"
  else
    log_ok "Database '${db_name}' exists"
  fi
}

run_db_push() {
  log "Applying database schema (drizzle-kit push)..."
  (
    cd "${ROOT_DIR}/lib/db"
    # --force skips interactive confirmation prompts
    DATABASE_URL="${DATABASE_URL}" npx drizzle-kit push --force --config ./drizzle.config.ts 2>&1 \
      | while IFS= read -r line; do printf '  %s\n' "$line"; done
  ) && log_ok "Database schema applied" \
    || die "Database schema push failed. Check DATABASE_URL and DB connectivity."
}

# ---------------------------------------------------------------------------
# Health checks — validates services are responsive after startup
# ---------------------------------------------------------------------------
check_health() {
  local url="$1" label="$2" retries="${3:-10}" delay="${4:-2}"

  for ((i = 1; i <= retries; i++)); do
    if curl -sf --max-time 3 "${url}" >/dev/null 2>&1; then
      log_ok "${label} is healthy (${url})"
      return 0
    fi
    sleep "${delay}"
  done

  warn "${label} did not respond at ${url} after ${retries} attempts"
  return 1
}

run_health_checks() {
  log "Running health checks..."
  local all_ok=1

  # API server
  if ! check_health "http://127.0.0.1:${API_PORT}/api/healthz" "API Server" 15 2; then
    all_ok=0
  fi

  # Restoration service (if not skipped and not in Docker-only mode)
  if [ "${SKIP_RESTORATION}" -eq 0 ]; then
    if ! check_health "http://127.0.0.1:${RESTORATION_PORT}/health" "Restoration Service" 10 2; then
      all_ok=0
    fi
  fi

  # Web server (Vite dev server)
  if ! check_health "http://127.0.0.1:${WEB_PORT}/" "Web Dashboard" 10 2; then
    all_ok=0
  fi

  if [ "${all_ok}" -eq 1 ]; then
    log_ok "All services healthy"
  else
    warn "Some services may not be ready yet — check logs above"
  fi
}

# ---------------------------------------------------------------------------
# Restoration service (native mode)
# ---------------------------------------------------------------------------
start_restoration_native() {
  local venv_dir="${ROOT_DIR}/services/restoration/.venv"

  if [ ! -d "${venv_dir}" ]; then
    warn "Restoration service venv not found at ${venv_dir} — skipping"
    warn "To set up: cd services/restoration && python3.11 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
    SKIP_RESTORATION=1
    return
  fi

  if port_in_use "${RESTORATION_PORT}"; then
    local new_port
    new_port="$(find_free_port "${RESTORATION_PORT}")"
    warn "Port ${RESTORATION_PORT} in use, switching restoration to port ${new_port}"
    RESTORATION_PORT="${new_port}"
  fi

  export RESTORATION_SERVICE_URL="http://127.0.0.1:${RESTORATION_PORT}"

  log "Starting Restoration Service on port ${RESTORATION_PORT}"
  (
    cd "${ROOT_DIR}/services/restoration"
    source "${venv_dir}/bin/activate"
    RESTORATION_PORT="${RESTORATION_PORT}" python server.py
  ) &
  record_pid "restoration" "$!"
}

# ---------------------------------------------------------------------------
# Native stack (API + Web + Restoration)
# ---------------------------------------------------------------------------
run_native_stack() {
  local wait_for_local_db="${1:-0}"
  export BASE_PATH API_PORT WEB_PORT SESSION_SECRET RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET DATABASE_URL
  export API_PROXY_TARGET="http://127.0.0.1:${API_PORT}"
  export RESTORATION_SERVICE_URL="${RESTORATION_SERVICE_URL:-http://127.0.0.1:${RESTORATION_PORT}}"

  # Check for port conflicts early
  if port_in_use "${API_PORT}"; then
    local new_api_port
    new_api_port="$(find_free_port "${API_PORT}")"
    warn "Port ${API_PORT} in use, switching API to port ${new_api_port}"
    API_PORT="${new_api_port}"
    export API_PORT
    export API_PROXY_TARGET="http://127.0.0.1:${API_PORT}"
  fi

  if port_in_use "${WEB_PORT}"; then
    local new_web_port
    new_web_port="$(find_free_port "${WEB_PORT}")"
    warn "Port ${WEB_PORT} in use, switching web to port ${new_web_port}"
    WEB_PORT="${new_web_port}"
    export WEB_PORT
  fi

  if [ "${wait_for_local_db}" = "1" ]; then
    wait_for_db "${DB_PORT}"
  fi

  ensure_database
  run_db_push

  # Start restoration service (non-blocking)
  if [ "${SKIP_RESTORATION}" -eq 0 ]; then
    start_restoration_native
  fi

  # Build API server
  log "Building API server..."
  (cd "${ROOT_DIR}/artifacts/api-server" && node ./build.mjs) \
    || die "API server build failed"

  # Start API server
  log "Starting API on http://127.0.0.1:${API_PORT}"
  (
    cd "${ROOT_DIR}/artifacts/api-server"
    PORT="${API_PORT}" node --enable-source-maps ./dist/index.mjs
  ) &
  record_pid "api" "$!"

  # Start web dashboard
  log "Starting dashboard on http://127.0.0.1:${WEB_PORT}"
  (
    cd "${ROOT_DIR}/artifacts/glimpse-ai"
    PORT="${WEB_PORT}" npx vite --config vite.config.ts --host 0.0.0.0
  ) &
  record_pid "web" "$!"

  # Print startup summary
  echo ""
  log "┌─────────────────────────────────────────────────────┐"
  log "│         GlimpseAI — Starting Up                     │"
  log "├─────────────────────────────────────────────────────┤"
  log "│  Mode:        ${MODE}"
  log "│  Dashboard:   http://localhost:${WEB_PORT}"
  log "│  API:         http://localhost:${API_PORT}/api/healthz"
  if [ "${SKIP_RESTORATION}" -eq 0 ]; then
  log "│  Restoration: http://localhost:${RESTORATION_PORT}/health"
  fi
  log "│  Database:    localhost:${DB_PORT}/${POSTGRES_DB}"
  log "├─────────────────────────────────────────────────────┤"
  log "│  Stop:        ./stop.sh                             │"
  log "└─────────────────────────────────────────────────────┘"
  echo ""

  # Background health check (don't block startup)
  (sleep 5 && run_health_checks) &

  # Trap for graceful shutdown
  trap 'log "Shutting down..."; "${ROOT_DIR}/stop.sh" 2>/dev/null || true; exit 0' INT TERM

  # Wait for all background processes
  wait
}

# ---------------------------------------------------------------------------
# Mode: docker
# ---------------------------------------------------------------------------
start_docker() {
  require_docker
  cleanup_containers

  local args=(up -d)
  if [ "${BUILD}" -eq 1 ]; then
    args=(up -d --build)
  fi

  log "Starting all Docker services..."
  (cd "${ROOT_DIR}" && docker_compose "${args[@]}")
  log_ok "Docker services started"

  # Wait for health of Docker services
  log "Waiting for containers to be healthy..."
  sleep 3
  run_health_checks
}

# ---------------------------------------------------------------------------
# Mode: hybrid (Docker DB + native services)
# ---------------------------------------------------------------------------
start_hybrid() {
  require_docker
  ensure_native_deps
  cleanup_containers

  # Find a free port for the Docker postgres
  if port_in_use "${DB_PORT}"; then
    DB_PORT="$(find_free_port 5432)"
    export DB_PORT
    log "Using Docker PostgreSQL on port ${DB_PORT}"
  fi

  export DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${DB_PORT}/${POSTGRES_DB}}"

  log "Starting PostgreSQL container on port ${DB_PORT}"
  (cd "${ROOT_DIR}" && DB_PORT="${DB_PORT}" docker_compose up -d db)

  run_native_stack 1
}

# ---------------------------------------------------------------------------
# Mode: native
# ---------------------------------------------------------------------------
start_native() {
  ensure_native_deps

  # Build DATABASE_URL from parts if not explicitly set
  if [ -z "${DATABASE_URL:-}" ]; then
    if port_in_use 5432; then
      DB_PORT=5432
      if [ -n "${POSTGRES_PASSWORD}" ]; then
        DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${DB_PORT}/${POSTGRES_DB}"
      else
        DATABASE_URL="postgresql://${POSTGRES_USER}@localhost:${DB_PORT}/${POSTGRES_DB}"
      fi
      export DATABASE_URL
      log "Using local PostgreSQL: ${DATABASE_URL}"
    else
      die "Native mode requires a running PostgreSQL. Either:
  - Start local postgres, or
  - Set DATABASE_URL in .env, or
  - Use --hybrid for a Docker PostgreSQL."
    fi
  fi

  run_native_stack 0
}

# ---------------------------------------------------------------------------
# Auto-detection logic
# ---------------------------------------------------------------------------
auto_detect_mode() {
  if [ -n "${MODE}" ]; then
    return
  fi

  if [ -n "${DATABASE_URL:-}" ]; then
    MODE="native"
    log "Auto-detected mode: native (DATABASE_URL is set)"
    return
  fi

  if port_in_use 5432; then
    MODE="native"
    log "Auto-detected mode: native (local PostgreSQL on 5432)"
    return
  fi

  if has_cmd docker && docker info >/dev/null 2>&1; then
    MODE="hybrid"
    log "Auto-detected mode: hybrid (Docker available, no local PostgreSQL)"
    return
  fi

  die "Cannot auto-detect mode. No PostgreSQL running and Docker is unavailable.
  Use --native with DATABASE_URL or --hybrid with Docker."
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --docker)        MODE="docker" ;;
      --native)        MODE="native" ;;
      --hybrid)        MODE="hybrid" ;;
      --build)         BUILD=1 ;;
      --no-restoration) SKIP_RESTORATION=1 ;;
      -h|--help)       usage; exit 0 ;;
      *)               usage; die "Unknown argument: $1" ;;
    esac
    shift
  done
}

# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
main() {
  parse_args "$@"
  auto_detect_mode
  init_state
  save_mode

  case "${MODE}" in
    docker)  start_docker ;;
    native)  start_native ;;
    hybrid)  start_hybrid ;;
    *)       die "Unsupported mode: ${MODE}" ;;
  esac
}

main "$@"
