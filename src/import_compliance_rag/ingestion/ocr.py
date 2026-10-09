"""Tesseract OCR adapter.

All images for a document are OCR'd in a single tesseract invocation (tesseract accepts a list file
of images), which matters when tesseract runs inside a container with a multi-second startup cost.
Commands are executed with paths relative to a private temporary directory so the same code works
with a native binary and with ``scripts/tesseract_container.sh``.
"""

from __future__ import annotations

import csv
import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import pymupdf

from import_compliance_rag.config.settings import OcrSettings

log = logging.getLogger(__name__)


class OcrUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True)
class OcrResult:
    text: str
    mean_confidence: float | None  # 0..100, mean of word confidences reported by tesseract
    word_count: int


class TesseractOcr:
    def __init__(
        self,
        command: str,
        languages: str = "ara+eng",
        dpi: int = 300,
        timeout: int = 300,
        page_segmentation_mode: int = 6,
        container_image: str | None = None,
        container_engine: str = "docker",
    ) -> None:
        self.command = command
        self.container_image = container_image
        self.container_engine = container_engine
        self.languages = languages
        self.dpi = dpi
        self.timeout = timeout
        # PSM 6 (single uniform block) is the default because PSM 3/4 silently dropped short
        # clause lines in single-column Jordanian legislation during evaluation (e.g. Article 6(a)
        # and the first line of Article 8 of Import and Export Law No. 21 of 2001).
        self.page_segmentation_mode = page_segmentation_mode

    @classmethod
    def from_settings(cls, settings: OcrSettings) -> TesseractOcr:
        return cls(
            settings.tesseract_cmd,
            languages=settings.languages,
            dpi=settings.dpi,
            timeout=settings.timeout_seconds,
            page_segmentation_mode=settings.page_segmentation_mode,
            container_image=settings.container_image,
            container_engine=settings.container_engine,
        )

    def resolved_command(self) -> str | None:
        if self.container_image:
            return shutil.which(self.container_engine)
        path = Path(self.command)
        if path.is_file():
            return str(path.resolve())
        return shutil.which(self.command)

    def available(self) -> bool:
        return self.resolved_command() is not None

    def render(
        self, page: pymupdf.Page, clip: pymupdf.Rect | None = None, dpi: int | None = None
    ) -> pymupdf.Pixmap:
        return page.get_pixmap(dpi=dpi or self.dpi, clip=clip)

    def recognize(
        self,
        images: list[pymupdf.Pixmap],
        languages: str | None = None,
        page_segmentation_mode: int | None = None,
    ) -> list[OcrResult]:
        """OCR images in one tesseract run; results are returned in input order."""
        if not images:
            return []
        command = self.resolved_command()
        if command is None:
            raise OcrUnavailableError(
                f"OCR command '{self.command}' not found. Install tesseract with Arabic data "
                "(e.g. `sudo dnf install tesseract tesseract-langpack-ara`) or build the OCR image "
                "and set ICR_OCR__CONTAINER_IMAGE=localhost/icr-tesseract:latest."
            )
        with tempfile.TemporaryDirectory(prefix="icr-ocr-") as tmp:
            work = Path(tmp)
            names = []
            for i, pix in enumerate(images):
                name = f"img-{i:05d}.png"
                pix.save(work / name)
                names.append(name)
            (work / "images.txt").write_text("\n".join(names) + "\n", encoding="utf-8")
            args = [
                *self._invocation(command, work), "images.txt", "out", "-l", languages or self.languages,
                "--psm", str(page_segmentation_mode or self.page_segmentation_mode),
                "--dpi", str(self.dpi), "txt", "tsv",
            ]  # fmt: skip
            log.info("ocr.start", extra={"images": len(images)})
            result = subprocess.run(
                args,
                cwd=work,
                capture_output=True,
                text=True,
                timeout=max(self.timeout, 15 * len(images)),
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(f"tesseract failed ({result.returncode}): {result.stderr[-500:]}")
            texts = (work / "out.txt").read_text(encoding="utf-8").split("\f")
            stats = _image_word_stats(work / "out.tsv")

        if len(texts) < len(images):
            raise RuntimeError(f"tesseract returned {len(texts)} results for {len(images)} images")
        results = []
        for i in range(len(images)):
            confs = stats.get(i + 1, [])
            mean = round(sum(confs) / len(confs), 2) if confs else None
            results.append(OcrResult(texts[i], mean, len(confs)))
        return results

    def _invocation(self, command: str, work: Path) -> list[str]:
        """The argv prefix that runs tesseract with ``work`` as its working directory."""
        if not self.container_image:
            return [command]
        args = [command, "run", "--rm", "--network=none", "-v", f"{work}:/work", "-w", "/work"]
        if hasattr(os, "getuid"):  # keep output files owned by the caller on Linux/macOS
            args += ["--user", f"{os.getuid()}:{os.getgid()}"]
        return [*args, self.container_image]


def _image_word_stats(tsv_path: Path) -> dict[int, list[float]]:
    """Word confidences per input image (tesseract numbers images from 1 in ``page_num``)."""
    confs: dict[int, list[float]] = {}
    with tsv_path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t", quoting=csv.QUOTE_NONE):
            if row.get("level") != "5" or not (row.get("text") or "").strip():
                continue
            conf = float(row["conf"])
            if conf >= 0:
                confs.setdefault(int(row["page_num"]), []).append(conf)
    return confs
