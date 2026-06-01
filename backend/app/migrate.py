"""One-shot production database bootstrap entrypoint."""
from __future__ import annotations

import logging
import sys

from .bootstrap import bootstrap_database


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    bootstrap_database(run_migrations=True)


if __name__ == "__main__":
    main()
