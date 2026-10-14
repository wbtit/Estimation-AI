"""Preview (default) or apply the title-block sheet-number reading for one project.

  PYTHONPATH=. .venv/bin/python -m tools.reread_sheet_numbers <project-id> [--apply]
Prints counts only. Without --apply nothing is written.
"""

from __future__ import annotations

import json
import sys

from src.config import load_config
from src.db import connect
from src.pdf_scan.reread import reread_sheet_numbers


def main(argv: list[str]) -> None:
    if not argv:
        print(__doc__)
        return
    config = load_config()
    with connect(config.database_url) as conn:
        print(json.dumps(reread_sheet_numbers(conn, config, argv[0], apply="--apply" in argv[1:])))


if __name__ == "__main__":
    main(sys.argv[1:])
