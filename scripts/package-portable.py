"""Repackage a verified Windows installer payload without rebuilding it."""
from pathlib import Path
import hashlib
import shutil
import struct
import zipfile
import json
import os

version = os.environ.get("KAR_PACKAGE_VERSION") or json.loads(Path("package.json").read_text(encoding="utf-8"))["version"]

source = Path("extracted")
apps = list(source.rglob("kar-schedule.exe"))
assert len(apps) == 1, f"Expected one app executable: {apps}"
app = apps[0]
binary = app.read_bytes()
assert binary[:2] == b"MZ"
pe = struct.unpack_from("<I", binary, 0x3C)[0]
assert binary[pe:pe + 4] == b"PE\0\0"
assert struct.unpack_from("<H", binary, pe + 4)[0] == 0x8664, "Expected x64 app"
runtimes = [p for p in source.rglob("*.exe") if "webview2" in p.name.lower()]
assert len(runtimes) == 1, f"Expected one bundled WebView2 runtime installer: {runtimes}"

bundle = Path("portable/KAR Schedule")
bundle.mkdir(parents=True)
shutil.copy2(app, bundle / app.name)
for dll in app.parent.glob("*.dll"):
    shutil.copy2(dll, bundle / dll.name)
prerequisites = bundle / "prerequisites"
prerequisites.mkdir()
shutil.copy2(runtimes[0], prerequisites / "WebView2Runtime-x64.exe")
shutil.copy2("docs/NAS_START_HERE.txt", bundle / "START-HERE.txt")

manifest = {
    p.relative_to(bundle).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
    for p in sorted(bundle.rglob("*")) if p.is_file()
}
(bundle / "SHA256SUMS.txt").write_text(
    "".join(f"{digest}  {name}\n" for name, digest in manifest.items()), encoding="utf-8"
)
out = Path("portable-release")
out.mkdir()
archive = out / f"KAR-Schedule_{version}_windows-x64-portable.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for p in sorted(bundle.rglob("*")):
        if p.is_file():
            assert p.suffix.lower() not in {".db", ".sqlite", ".sqlite3", ".xlsx", ".xls"}
            z.write(p, p.relative_to(bundle.parent).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None, "ZIP validation failed"
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(out / "SHA256SUMS-Portable.txt").write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
print(f"Portable ZIP: {archive.name}, bytes: {archive.stat().st_size}, SHA256: {digest}")
for name, digest in manifest.items():
    print(f"Payload: {name}, SHA256: {digest}")
