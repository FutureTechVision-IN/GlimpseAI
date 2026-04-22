#!/usr/bin/env bash
# =============================================================================
# GlimpseAI — Unified Shutdown Script
# Reads the mode from .glimpse/mode (written by start.sh) and shuts down
# the appropriate services. Falls back to stopping everything it can find.
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${ROOT_DIR}/.glimpse"
PID_FILE="${STATE_DIR}/pids"
MODE_FILE="${STATE_DIR}/mode"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() {
  printf '\033[1;35m[stop]\033[0m %s\n' "$*"
}

log_ok() {
  printf '\033[1;32m[stop] ✓\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[stop] ⚠\033[0m %s\n' "$*"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Docker compose helper
# ---------------------------------------------------------------------------
docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif has_cmd docker-compose; then
    docker-compose "$@"
  else
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Stop processes by port
# ---------------------------------------------------------------------------
stop_port() {
  local port="$1" label="${2:-}"

  if ! has_cmd lsof; then
    return
  fi

  local pids
  pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "${pids}" ]; then
    return
  fi

  [ -n "${label}" ] && log "Stopping ${label} (port ${port})"
  while IFS= read -r pid; do
    [ -n "${pid}" ] || continue
    kill "${pid}" 2>/dev/null || true
  done <<< "${pids}"

  # Wait briefly for graceful shutdown, then force-kill if needed
  sleep 1
  for pid in ${pids}; do
    if kill -0 "${pid}" 2>/dev/null; then
      kill -9 "${pid}" 2>/dev/null || true
    fi
  done
}

# ---------------------------------------------------------------------------
# Stop recorded PIDs from the state file
# ---------------------------------------------------------------------------
stop_recorded_pids() {
  if [ ! -f "${PID_FILE}" ]; then
    return
  fi

  log "Stopping recorded processes..."
  while IFS='=' read -r label pid; do
    [ -n "${pid}" ] || continue
    if kill -0 "${pid}" 2>/dev/null; then
      log "  Stopping ${label} (PID ${pid})"
      kill "${pid}" 2>/dev/null || true
    fi
  done < "${PID_FILE}"

  # Grace period
  sleep 2

  # Force-kill any survivors
  while IFS='=' read -r label pid; do
    [ -n "${pid}" ] || continue
    if kill -0 "${pid}" 2>/dev/null; then
      warn "Force-killing ${label} (PID ${pid})"
      kill -9 "${pid}" 2>/dev/null || true
    fi
  done < "${PID_FILE}"
}

# ---------------------------------------------------------------------------
# Stop native services by known ports
# ---------------------------------------------------------------------------
stop_native_services() {
  stop_port 3001 "API server"
  stop_port 7860 "Restoration service"

  # Stop Vite dev servers (ports 5173-5180)
  local port
  for port in 5173 5174 5175 5176 5177 5178 5179 5180; do
    stop_port "${port}" ""
  done
}

# ---------------------------------------------------------------------------
# Stop Docker services
# ---------------------------------------------------------------------------
stop_docker_services() {
  if ! has_cmd docker; then
    return
  fi

  if ! docker info >/dev/null 2>&1; then
    return
  fi

  if ! docker_compose -f "${ROOT_DIR}/docker-compose.yml" ps >/dev/null 2>&1; then
    return
  fi

  local running_services
  running_services="$(docker_compose -f "${ROOT_DIR}/docker-compose.yml" ps --services --status running 2>/dev/null || true)"

  if [ -z "${running_services}" ]; then
    return
  fi

  log "Stopping Docker services: ${running_services//$'\n'/, }"
  docker_compose -f "${ROOT_DIR}/docker-compose.yml" stop >/dev/null
  log_ok "Docker services stopped"
}

# ---------------------------------------------------------------------------
# Cleanup state files
# ---------------------------------------------------------------------------
cleanup_state() {
  if [ -f "${PID_FILE}" ]; then
    rm -f "${PID_FILE}"
  fi
  if [ -f "${MODE_FILE}" ]; then
    rm -f "${MODE_FILE}"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  local mode=""

  # Read the mode that was used during startup
  if [ -f "${MODE_FILE}" ]; then
    mode="$(cat "${MODE_FILE}")"
    log "Last startup mode: ${mode}"
  else
    log "No startup mode recorded — stopping all known services"
    mode="all"
  fi

  case "${mode}" in
    docker)
      stop_docker_services
      ;;
    native)
      stop_recorded_pids
      stop_native_services
      ;;
    hybrid)
      stop_recorded_pids
      stop_native_services
      stop_docker_services
      ;;
    all|*)
      stop_recorded_pids
      stop_native_services
      stop_docker_services
      ;;
  esac

  cleanup_state
  log_ok "All GlimpseAI services stopped"
}

main "$@"
