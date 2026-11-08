"""Generate the bcrypt hash for APP_PASSWORD_HASH.

Usage (from backend/, venv active):
    python scripts/hash_password.py

The password is read without echoing and is never stored; only the hash is printed.
"""

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # make `app` importable

from app.core.security import BCRYPT_MAX_BYTES, hash_password  # noqa: E402

MIN_LENGTH = 12


def main() -> int:
    password = getpass.getpass("New password: ")
    if len(password) < MIN_LENGTH:
        print(f"Use at least {MIN_LENGTH} characters.", file=sys.stderr)
        return 1
    if len(password.encode("utf-8")) > BCRYPT_MAX_BYTES:
        print(f"Use at most {BCRYPT_MAX_BYTES} bytes (bcrypt limit).", file=sys.stderr)
        return 1
    if getpass.getpass("Repeat password: ") != password:
        print("Passwords do not match.", file=sys.stderr)
        return 1

    password_hash = hash_password(password)
    print("\nPut this line in backend/.env (single quotes stop '$' being interpreted):\n")
    print(f"APP_PASSWORD_HASH='{password_hash}'")
    print("\nOn Render, paste only the value between the quotes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
