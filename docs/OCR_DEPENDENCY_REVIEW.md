# OCR cross-check: dependency review

Owner decision (Phase 4b): a local OCR engine is allowed only as an **optional cross-check**, never as the source of truth, never sending data to any network service. This documents what was checked. Everything here was run on 2026-10-07 on the development machine.

## What it is
- Optional dependency group `ocr` in `worker/pyproject.toml` (`rapidocr-onnxruntime>=1.4,<1.5`).
- Installed only by `make setup-ocr` from `worker/requirements-ocr.txt` (every version pinned, every file hash-checked). The default `make setup` installs `requirements.txt` and has no OCR code or model on the machine.
- Disabled unless `OCR_CROSSCHECK_ENABLED=true`. If enabled without the package, the job fails with a clear message instead of silently skipping.
- Engine: PaddleOCR PP-OCRv4 detection and recognition plus the v2.0 mobile angle classifier, run on CPU through ONNX Runtime. Models ship **inside** the pip package (3 files, 15.8 MB).

## Pinned versions
`rapidocr-onnxruntime 1.4.4`, `onnxruntime 1.30.0`, `opencv-python 5.0.0.93`, `numpy 2.5.3`, `pillow 12.3.0`, `pyyaml 6.0.3`, `shapely 2.1.2`, `pyclipper 1.4.0`, `six 1.17.0`, `tqdm 4.70.1`, `flatbuffers 25.12.19`, `protobuf 7.36.2`. (numpy and the core stack are also in the default `requirements.txt`; numpy is a core dependency of the reader, not an OCR one.)

## Licences (package metadata, and files shipped in the wheels)
| Package | Licence | Note |
|---|---|---|
| rapidocr-onnxruntime | Apache-2.0 (metadata and source headers) | **The wheel ships no LICENSE file.** |
| Model files (3 `.onnx`) | **Not stated in the package.** The source headers credit PaddleOCR (Apache-2.0 upstream), but no model licence file is shipped | **Unverified from shipped files.** Needs your decision (see below). |
| onnxruntime | MIT; `LICENSE` and `ThirdPartyNotices.txt` shipped | |
| opencv-python | Apache-2.0 / MIT; its third-party notice **lists FFmpeg and Qt, which are LGPL** | The standard wheel bundles those libraries. We call neither directly. `opencv-python-headless` avoids Qt but rapidocr pins the non-headless name; not changed. |
| tqdm | MPL-2.0 and MIT | File-level copyleft; unmodified use. |
| numpy, pillow, pyyaml, shapely, pyclipper, six, flatbuffers, protobuf | BSD / MIT / HPND / Apache-2.0 family | |

All are permissive or weak-copyleft for internal use. Nothing is AGPL or GPL. (PyMuPDF, already used, is AGPL-3.0; accepted for internal use in Phase 2.)

**Open licence point:** the models are the part with no shipped licence text. Before the tool is distributed or used outside the company, confirm the model licence upstream (the PaddleOCR project) and keep a copy of it in the repository. For internal use I consider the risk low but I could not confirm it from the files.

## Network
- **Static check:** the `rapidocr_onnxruntime` package (20 Python files) contains no `urlopen`, `requests`, `httpx`, `socket` or download calls. The only matches are licence-header URLs and comments in the source. Models load from the installed package directory.
- **Runtime check (a test, run):** `tests/test_text_ocr.py::test_the_real_engine_reads_text_and_makes_no_network_connection` constructs the engine and reads a crop with `socket.connect` and `socket.create_connection` replaced by functions that raise. It passes, so a connection attempt would have failed the test. It is skipped automatically when the optional group is not installed.
- Not checked: ONNX Runtime internals beyond that test (no network activity was observed in it); behaviour on Windows (not used here).

## Vulnerability audit
`pip-audit --requirement requirements.txt --no-deps --disable-pip` and the same for `requirements-ocr.txt`: **"No known vulnerabilities found"** for both. (The audit queries the public vulnerability database with package names and versions only; no drawing data is involved.) `npm audit` re-run for the Node side on the same day: 0 vulnerabilities in the root, `api` and `web` packages (the Node dependencies did not change in Phase 4b).

## Governance
- OCR output is stored in `text_items.ocr_text` beside the glyph text, never in `text`.
- OCR can (i) propose glyph labels by majority vote (`glyph_library.proposed_label`, `votes`), never `label` or `status`; and (ii) set `agree` and a confidence on a decoded line. Only a person confirms labels.
- Lines in `fixtures/private/ground_truth_text.csv` are excluded from voting.
