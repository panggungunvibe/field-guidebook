#!/usr/bin/env python3
"""Verify and copy the bundled guidebook baseline without replacing user files."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shlex
import shutil
import sys
import tempfile


def fail(message):
    raise ValueError(message)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def checked_manifest(root):
    template = root / "assets" / "site-template"
    manifest_path = root / "assets" / "template-manifest.json"
    if template.is_symlink() or manifest_path.is_symlink():
        fail("The template and manifest must not be symbolic links.")
    if not template.is_dir() or not manifest_path.is_file():
        fail("Missing assets/site-template or assets/template-manifest.json.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        fail("The template manifest must be an object.")
    files = manifest.get("files")
    if manifest.get("version") != 1 or not isinstance(files, dict) or not files:
        fail("Expected manifest version 1 with a nonempty files mapping.")
    actual = set()
    for path in template.rglob("*"):
        if path.is_symlink():
            fail(f"Symbolic links are not allowed in the template: {path}")
        if path.is_file():
            actual.add(path.relative_to(template).as_posix())
        elif not path.is_dir():
            fail(f"Unsupported template entry: {path}")
    for relative, expected in files.items():
        if not isinstance(relative, str) or not relative or "\\" in relative or "\x00" in relative:
            fail(f"Unsafe manifest path: {relative!r}")
        parsed = PurePosixPath(relative)
        if parsed.is_absolute() or any(part in ("", ".", "..") for part in relative.split("/")):
            fail(f"Unsafe manifest path: {relative!r}")
        if not isinstance(expected, str) or len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
            fail(f"Invalid SHA-256 for {relative}")
        path = template.joinpath(*parsed.parts)
        if not path.is_file() or path.is_symlink():
            fail(f"Missing or unsafe template file: {relative}")
        if digest(path) != expected:
            fail(f"Template integrity check failed: {relative}")
    if actual != set(files):
        fail("The template file list differs from its manifest. Reinstall the complete skill.")
    if ".guidebook-project.json" in files:
        fail("The project state marker must not be bundled in the template.")
    return template, files, digest(manifest_path)


def scaffold(destination):
    root = Path(__file__).resolve().parent.parent
    requested = Path(destination).expanduser()
    if requested.is_symlink():
        fail("The destination must not be a symbolic link.")
    target = requested.resolve()
    if target == root or root in target.parents:
        fail("Choose a project directory outside the installed skill.")
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        fail("The destination is not an empty directory. Choose a new directory; nothing was overwritten.")
    template, files, manifest_hash = checked_manifest(root)
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{target.name}-guidebook-", dir=target.parent))
    try:
        for relative in files:
            output = staging.joinpath(*PurePosixPath(relative).parts)
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(template / relative, output)
        marker = {
            "version": 1,
            "skill": "field-guidebook",
            "phase": "baseline",
            "templateManifestSHA256": manifest_hash,
        }
        (staging / ".guidebook-project.json").write_text(json.dumps(marker, indent=2) + "\n", encoding="utf-8")
        if target.exists():
            if target.is_symlink() or not target.is_dir() or any(target.iterdir()):
                fail("The destination changed during setup. Nothing was overwritten.")
            target.rmdir()  # Only an empty directory can be removed here.
        os.rename(staging, target)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    print(f"Created the complete baseline in {target}")
    print(f"Verified {len(files)} template files against SHA-256 manifest.")
    print("Next, run these commands (Node.js 20.19+ or 22.12+ required):")
    print(f"  cd {shlex.quote(str(target))}")
    print("  npm ci")
    print("  npm run dev -- --port 4174")
    print("Open the actual local URL printed by Vite. Preview the baseline before collecting replacement content.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", required=True, help="New or empty project directory outside this skill")
    args = parser.parse_args()
    try:
        scaffold(args.dest)
    except (OSError, ValueError, TypeError) as error:
        print(f"Cannot create guidebook: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
