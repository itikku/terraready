"""Reset approvals only in the disposable browser-test database, never the demo."""

from pathlib import Path

import lancedb

TEST_DATABASE = Path(__file__).resolve().parents[1] / ".data" / "e2e-lancedb"


def main() -> None:
    connection = lancedb.connect(str(TEST_DATABASE))
    if "approvals" in connection.list_tables().tables:
        connection.drop_table("approvals")


if __name__ == "__main__":
    main()
