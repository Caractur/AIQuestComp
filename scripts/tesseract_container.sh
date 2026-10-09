#!/usr/bin/env bash
# Drop-in replacement for the `tesseract` binary that runs it inside the icr-tesseract container.
# The current directory is mounted, so callers must pass paths relative to it (the OCR module does).
# Build the image once with: podman build -t localhost/icr-tesseract:latest -f docker/ocr.Containerfile docker
set -euo pipefail
ENGINE="${CONTAINER_ENGINE:-$(command -v podman || command -v docker)}"
exec "$ENGINE" run --rm --network=none --userns=keep-id -v "$PWD:/work:Z" -w /work \
  "${ICR_OCR_IMAGE:-localhost/icr-tesseract:latest}" "$@"
