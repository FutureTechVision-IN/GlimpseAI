#!/usr/bin/env bash
# =============================================================================
# qa-runner.sh — End-to-end media pipeline validation loop.
#
# What it does:
#   1. Runs the api-server vitest suite (image matrix + smoke).
#   2. If the restoration sidecar /health is reachable AND advertises
#      "video_restore", runs the video matrix as well.
#   3. After each iteration scans qa-report/*-failures.ndjson for new entries
#      and either declares success or loops up to MAX_ITERATIONS times.
#   4. Writes qa-report/summary.txt with the final state.
#
# Environment overrides:
#   MAX_ITERATIONS  (default 3)
#   SKIP_VIDEO      (default 0)            — 1 to skip the video matrix
#   RESTORATION_SERVICE_URL                — sidecar URL for health check
#   RESTORATION_PORT (default 7860)        — used if RESTORATION_SERVICE_URL unset
#
# Notes:
#   - This script never modifies source files. It only invokes tests and
#     reports results. The agent (or human) is expected to apply fixes
#     between iterations.
#   - Failure log entries include `userSymptom` strings written by the test
#     suites to make triage actionable.
# =============================================================================

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QA_DIR="${ROOT_DIR}/qa-report"
IMG_LOG="${QA_DIR}/enhancement-matrix-failures.ndjson"
VID_LOG="${QA_DIR}/video-matrix-failures.ndjson"
CHAIN_LOG="${QA_DIR}/chain-matrix-failures.ndjson"
SMOKE_LOG="${QA_DIR}/enhancement-smoke-failures.ndjson"
SUMMARY="${QA_DIR}/summary.txt"
# Bumped from 3 to 5 to give the QA loop more chances to reach a clean
# state when the sidecar warm-up is slow on first run.
MAX_ITERATIONS="${MAX_ITERATIONS:-5}"
SKIP_VIDEO="${SKIP_VIDEO:-0}"
RESTORATION_PORT="${RESTORATION_PORT:-7860}"
RESTORATION_SERVICE_URL="${RESTORATION_SERVICE_URL:-http://127.0.0.1:${RESTORATION_PORT}}"

mkdir -p "${QA_DIR}"

log()  { printf '\033[1;36m[qa]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[qa] ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[qa] ⚠\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[qa] ✗\033[0m %s\n' "$*" >&2; }

# Capture initial sizes so we only count NEW failures per iteration.
file_size() {
  if [ -f "$1" ]; then
    if stat -f '%z' "$1" >/dev/null 2>&1; then
      stat -f '%z' "$1"
    else
      stat -c '%s' "$1"
    fi
  else
    echo 0
  fi
}

count_new_lines() {
  # count lines added since size $2
  local file="$1" prev_size="$2"
  if [ ! -f "${file}" ]; then echo 0; return; fi
  local cur_size
  cur_size="$(file_size "${file}")"
  if [ "${cur_size}" -le "${prev_size}" ]; then echo 0; return; fi
  tail -c "+$((prev_size + 1))" "${file}" | wc -l | tr -d ' '
}

print_new_failures() {
  local file="$1" prev_size="$2" label="$3"
  if [ ! -f "${file}" ]; then return; fi
  local cur_size
  cur_size="$(file_size "${file}")"
  if [ "${cur_size}" -le "${prev_size}" ]; then return; fi
  warn "New ${label} failures this iteration:"
  tail -c "+$((prev_size + 1))" "${file}" | while IFS= read -r line; do
    printf '   - %s\n' "${line}"
  done
}

sidecar_supports_video() {
  if [ "${SKIP_VIDEO}" = "1" ]; then return 1; fi
  local body
  body="$(curl -fsS --max-time 4 "${RESTORATION_SERVICE_URL}/health" 2>/dev/null || true)"
  if [ -z "${body}" ]; then return 1; fi
  echo "${body}" | grep -q '"video_restore"'
}

run_image_suite() {
  log "Running api-server vitest (image + chain + video matrices)…"
  # The default pnpm test script excludes enhancement-smoke.test.ts; the
  # remaining suites — including enhancement-chain-matrix.test.ts and
  # video-pipeline-matrix.test.ts — share this single invocation so we don't
  # double-pay for video sidecar work.
  ( cd "${ROOT_DIR}" && pnpm --filter @workspace/api-server run test -- --reporter=verbose )
  return $?
}

run_video_suite() {
  log "Re-running video matrix in isolation (sidecar advertises video_restore)…"
  ( cd "${ROOT_DIR}" && SKIP_VIDEO_MATRIX=0 pnpm --filter @workspace/api-server exec vitest run src/lib/video-pipeline-matrix.test.ts --reporter=verbose )
  return $?
}

run_smoke_suite() {
  log "Running enhancement smoke suite…"
  ( cd "${ROOT_DIR}" && pnpm --filter @workspace/api-server run test:smoke -- --reporter=verbose )
  return $?
}

main() {
  log "Starting QA loop (max ${MAX_ITERATIONS} iterations)"

  local iteration=1
  local final_image_status=1
  local final_video_status=1
  local final_smoke_status=1
  local final_video_skipped=0

  while [ "${iteration}" -le "${MAX_ITERATIONS}" ]; do
    log "──── Iteration ${iteration}/${MAX_ITERATIONS} ────"

    local img_size_before vid_size_before chain_size_before smoke_size_before
    img_size_before="$(file_size "${IMG_LOG}")"
    vid_size_before="$(file_size "${VID_LOG}")"
    chain_size_before="$(file_size "${CHAIN_LOG}")"
    smoke_size_before="$(file_size "${SMOKE_LOG}")"

    # Image suite covers image-matrix, chain-matrix, and (when sidecar is up)
    # video-matrix in a single pnpm test run. We only re-invoke the video
    # suite stand-alone if the test script itself fails — which wouldn't be
    # informative if the sidecar is offline.
    run_image_suite
    final_image_status=$?

    if [ "${final_image_status}" -ne 0 ] && sidecar_supports_video; then
      run_video_suite
      final_video_status=$?
      final_video_skipped=0
    else
      if sidecar_supports_video; then
        final_video_status=0
        final_video_skipped=0
      else
        warn "Sidecar /health unreachable or video_restore unavailable -- video matrix tests will be skipped by vitest"
        final_video_status=0
        final_video_skipped=1
      fi
    fi

    run_smoke_suite
    final_smoke_status=$?

    local new_img new_vid new_chain new_smoke
    new_img="$(count_new_lines "${IMG_LOG}" "${img_size_before}")"
    new_vid="$(count_new_lines "${VID_LOG}" "${vid_size_before}")"
    new_chain="$(count_new_lines "${CHAIN_LOG}" "${chain_size_before}")"
    new_smoke="$(count_new_lines "${SMOKE_LOG}" "${smoke_size_before}")"

    print_new_failures "${IMG_LOG}" "${img_size_before}" "image"
    print_new_failures "${VID_LOG}" "${vid_size_before}" "video"
    print_new_failures "${CHAIN_LOG}" "${chain_size_before}" "chain"
    print_new_failures "${SMOKE_LOG}" "${smoke_size_before}" "smoke"

    log "Iteration ${iteration} -- image=${final_image_status}, video=${final_video_status}, smoke=${final_smoke_status}, new img=${new_img} vid=${new_vid} chain=${new_chain} smoke=${new_smoke}"

    if [ "${final_image_status}" -eq 0 ] && [ "${final_video_status}" -eq 0 ] \
       && [ "${final_smoke_status}" -eq 0 ] \
       && [ "${new_img}" -eq 0 ] && [ "${new_vid}" -eq 0 ] \
       && [ "${new_chain}" -eq 0 ] && [ "${new_smoke}" -eq 0 ]; then
      ok "All four matrices (image, video, chain, smoke) clean on iteration ${iteration}"
      break
    fi

    if [ "${iteration}" -lt "${MAX_ITERATIONS}" ]; then
      warn "Failures detected -- apply fixes (see ${IMG_LOG} / ${VID_LOG}) and the loop will retry."
      sleep 2
    fi

    iteration=$((iteration + 1))
  done

  {
    echo "QA Runner summary"
    echo "================="
    echo "Timestamp:        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Iterations used:  ${iteration} / ${MAX_ITERATIONS}"
    echo "Image suite exit: ${final_image_status}"
    echo "Video suite exit: ${final_video_status} (skipped=${final_video_skipped})"
    echo "Smoke suite exit: ${final_smoke_status}"
    echo
    if [ -f "${IMG_LOG}" ]; then
      echo "Image failure log: ${IMG_LOG} ($(wc -l <"${IMG_LOG}" | tr -d ' ') lines)"
    else
      echo "Image failure log: (none)"
    fi
    if [ -f "${VID_LOG}" ]; then
      echo "Video failure log: ${VID_LOG} ($(wc -l <"${VID_LOG}" | tr -d ' ') lines)"
    else
      echo "Video failure log: (none)"
    fi
    if [ -f "${CHAIN_LOG}" ]; then
      echo "Chain failure log: ${CHAIN_LOG} ($(wc -l <"${CHAIN_LOG}" | tr -d ' ') lines)"
    else
      echo "Chain failure log: (none)"
    fi
    if [ -f "${SMOKE_LOG}" ]; then
      echo "Smoke failure log: ${SMOKE_LOG} ($(wc -l <"${SMOKE_LOG}" | tr -d ' ') lines)"
    else
      echo "Smoke failure log: (none)"
    fi
  } | tee "${SUMMARY}"

  if [ "${final_image_status}" -ne 0 ] || [ "${final_video_status}" -ne 0 ] \
     || [ "${final_smoke_status}" -ne 0 ]; then
    fail "QA loop finished with failing test runs"
    exit 1
  fi
  ok "QA loop finished cleanly"
}

main "$@"
