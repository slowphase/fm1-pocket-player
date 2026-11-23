#!/usr/bin/env python3
"""Mandatory delivery guard for completed ZIP/TAR files. Never publishes anything.

Original firmware requires an exact recorded hosting clearance; RFM1 uses the
unchanged production approval gate and the validated catalogue. Audit holds
override both. Built-in h1 is recognised by its exact repository fingerprint.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tarfile
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parent


class Rejected(ValueError): pass


def load(path): return json.loads(Path(path).read_text())
def sha(data): return hashlib.sha256(data).hexdigest()


def safe_name(name):
    p = PurePosixPath(name)
    if p.is_absolute() or ".." in p.parts or ".git" in p.parts or ".github" in p.parts or "\\" in name or "\x00" in name:
        raise Rejected("Unsafe archive path: " + name)
    return str(p)


def repo(url):
    u = urlsplit(url or "")
    parts=u.path.strip("/").split("/")[:2]
    if parts:parts[-1]=parts[-1].split("@",1)[0].removesuffix(".git")
    return "/".join(parts).lower() if u.hostname == "github.com" else ""


def hold_reason(ids, source, holds, platform="web"):
    identities = set(ids)
    for h in holds["holds"]:
        if platform in h["platforms"] and (identities.intersection(h["ids"]) or (repo(source) and repo(source) == h["repository"].lower())):
            return h["reason"]
    return None


def original_allowed(id, digest, source, approvals, holds):
    record = approvals.get(id) or {}
    return bool(record.get("sha256") == digest and not any(digest == h.get("sha256") for h in holds["holds"]) and not hold_reason([id], source, holds))


def selected_package(entry, package, previous, approvals, holds):
    """Keep an already accepted package when a new original lacks hosting clearance.
    A first-time original remains available for the existing maker-download rules,
    but receives no hosted file. Does not perform playback qualification.
    """
    id = entry["id"]
    if hold_reason([id], entry.get("source"), holds): return package
    if package and package.get("status") == "found" and original_allowed(id, package.get("sha256"), package.get("source"), approvals, holds):
        return package
    old = ((previous.get(id) or {}).get("emu") or {}).get("package") or {}
    if old.get("file") and original_allowed(id, old.get("sha256"), old.get("source"), approvals, holds):
        return {"hub": entry.get("provenance", {}).get("hub", {}).get("id") or id,
            "status": "found", "sha256": old["sha256"], "url": old["url"], "version": old.get("version"),
            "license": old.get("license"), "source": old.get("source"), "release": old.get("release"),
            "asset": old.get("asset"), "hubSize": old.get("size"), "hostingSelection": "last-accepted"}
    return package


def rfm_manifest(data):
    if not data.startswith(b"\0asm\x01\0\0\0"): return None
    def leb(pos):
        value = 0
        for shift in range(0, 35, 7):
            if pos >= len(data): raise Rejected("Truncated WebAssembly")
            b = data[pos]; pos += 1; value |= (b & 127) << shift
            if b < 128: return value, pos
        raise Rejected("Invalid WebAssembly length")
    pos = 8; found = None
    while pos < len(data):
        section = data[pos]; length, pos = leb(pos+1); end = pos+length
        if end > len(data): raise Rejected("Invalid WebAssembly section")
        if section == 0:
            n, start = leb(pos)
            if start+n > end: raise Rejected("Invalid custom section")
            if data[start:start+n] == b"rfm1":
                if found is not None: raise Rejected("Duplicate firmware identity")
                found = json.loads(data[start+n:end])
        pos = end
    return found


class Guard:
    def __init__(self, policy, holds, originals, catalogue, builtin, complete=False):
        self.policy, self.holds, self.originals = policy, holds, originals
        self.by_sha = {}
        for k,v in originals.items(): self.by_sha.setdefault(v["sha256"],[]).append((k,v))
        self.rfm = {f["id"]:f for f in catalogue.get("firmwares", [])}
        self.builtin = sha(builtin)
        self.files = 0; self.firmware = []
        self.total_bytes = 0
        self.complete = complete; self.scopes = []

    def blocked(self, id):
        return self.policy.get("excluded", {}).get(id) or self.policy.get("withdrawn", {}).get(id) or hold_reason([id], None, self.holds)

    def check_claim(self, id, digest, filename, kind, license=None, source=None):
        if any(digest == h.get("sha256") for h in self.holds["holds"]): raise Rejected("Held package fingerprint: " + str(id))
        if self.blocked(id) or hold_reason([id], source, self.holds): raise Rejected("Held firmware delivery: " + id)
        if kind == "fwsc":
            r = self.originals.get(id) or {}
            if not original_allowed(id, digest, source, self.originals, self.holds) or PurePosixPath(filename).name != PurePosixPath(r.get("file", "")).name:
                raise Rejected("Uncleared original package: " + id)
        else:
            r = self.rfm.get(id) or {}; approved = self.policy.get("approved", {}).get(id) or {}
            if hold_reason([id],r.get("source"),self.holds): raise Rejected("Held firmware source: " + str(id))
            if not approved or approved.get("license") != license or r.get("sha256") != digest or PurePosixPath(filename).name != PurePosixPath(r.get("file", "")).name:
                raise Rejected("RFM1 approval/fingerprint mismatch: " + id)

    def check_json(self, value, name):
        if not isinstance(value, dict) or value.get("schema") not in (1,2) or not isinstance(value.get("firmwares"), list): return
        for f in value["firmwares"]:
            if not f.get("id"): continue
            if f.get("file"):
                self.check_claim(f["id"], f.get("sha256"), f["file"], "rfm1", f.get("license"), f.get("source"))
                self.scopes[-1]["claims"].append((str(PurePosixPath(name).parent/f["file"]),f["sha256"]))
            em = f.get("emu") or {}; p = em.get("package") or {}
            if p.get("file"):
                self.check_claim(f["id"], p.get("sha256"), p["file"], "fwsc", source=p.get("source") or f.get("source"))
                self.scopes[-1]["claims"].append((str(PurePosixPath(name).parent/p["file"]),p["sha256"]))
            if hold_reason([f["id"]], f.get("source"), self.holds, "mac") and em.get("mac", {}).get("state") in ("playable", "experimental"):
                raise Rejected("Held maker download offered on Mac: " + f["id"])

    def check_file(self, name, data, depth):
        self.files += 1
        self.total_bytes += len(data)
        if self.total_bytes > 1024*1024*1024: raise Rejected("Archive expansion limit exceeded")
        if self.files > 20000 or len(data) > 300*1024*1024: raise Rejected("Archive size limit exceeded")
        leaf = PurePosixPath(name).name
        for h in self.holds["holds"]:
            if any(re.match(re.escape(id)+r"(?:[-.]|$)", leaf, re.I) for id in h["ids"]) and leaf.lower().endswith((".fwsc", ".rfm1", ".ufw")):
                raise Rejected("Held package filename: " + name)
        digest = sha(data)
        self.scopes[-1]["files"][name] = digest
        if any(digest == h.get("sha256") for h in self.holds["holds"]): raise Rejected("Held package fingerprint: " + name)
        if digest == self.builtin:
            if leaf != "h1.rfm1": raise Rejected("Renamed built-in firmware")
            self.firmware.append({"path":name,"id":"h1","sha256":digest}); return
        if digest in self.by_sha:
            matches = [(id,r) for id,r in self.by_sha[digest] if PurePosixPath(r["file"]).name == leaf]
            if not matches: raise Rejected("Renamed original package: " + name)
            id, record = matches[0]
            self.check_claim(id,digest,name,"fwsc")
            self.firmware.append({"path":name,"id":id,"sha256":digest}); return
        if data.startswith(b"PK\x03\x04") or leaf.endswith((".zip", ".tar", ".tar.gz", ".tgz")):
            self.check_archive(io.BytesIO(data),depth+1); return
        manifest = rfm_manifest(data)
        if manifest:
            id = manifest.get("id")
            self.check_claim(id,digest,name,"rfm1",manifest.get("license"),manifest.get("source_url"))
            self.firmware.append({"path":name,"id":id,"sha256":digest}); return
        if leaf.lower().endswith((".fwsc", ".rfm1", ".ufw")): raise Rejected("Unknown firmware bytes: " + name)
        if data.startswith(b"\0asm"):
            if not leaf.endswith(".wasm"): raise Rejected("Renamed WebAssembly runtime")
            return
        if leaf.lower().endswith(".png") and data.startswith(b"\x89PNG\r\n\x1a\n"): return
        # Everything else in this site/preview is text. Opaque renamed firmware
        # cannot bypass the guard merely by dropping its .fwsc extension.
        try: text = data.decode("utf8")
        except UnicodeError: raise Rejected("Unrecognised binary asset: " + name)
        if "\x00" in text: raise Rejected("Unrecognised binary asset: " + name)
        if leaf.endswith(".json"):
            try: self.check_json(json.loads(text),name)
            except json.JSONDecodeError: raise Rejected("Invalid JSON: " + name)

    def check_archive(self, path, depth=0):
        if depth > 3: raise Rejected("Nested archive depth exceeded")
        seen = set()
        self.scopes.append({"files":{},"claims":[]})
        if zipfile.is_zipfile(path):
            if hasattr(path,"seek"): path.seek(0)
            with zipfile.ZipFile(path) as z:
                for member in z.infolist():
                    n = safe_name(member.filename)
                    if n in seen: raise Rejected("Duplicate archive path: " + n)
                    seen.add(n)
                    if stat.S_ISLNK(member.external_attr >> 16): raise Rejected("Archive symlink: " + n)
                    if member.file_size > 300*1024*1024: raise Rejected("Oversized archive member: " + n)
                    if not member.is_dir(): self.check_file(n,z.read(member),depth)
        else:
            if hasattr(path,"seek"): path.seek(0)
            try:
                with tarfile.open(fileobj=path if hasattr(path,"read") else None,name=None if hasattr(path,"read") else path,mode="r:*") as t:
                    for member in t:
                        n = safe_name(member.name)
                        if n in seen: raise Rejected("Duplicate archive path: " + n)
                        seen.add(n)
                        if member.isdir(): continue
                        if not member.isfile(): raise Rejected("Archive link/special file: " + n)
                        if member.size > 300*1024*1024: raise Rejected("Oversized archive member: " + n)
                        self.check_file(n,t.extractfile(member).read(),depth)
            except tarfile.TarError as e: raise Rejected("Invalid archive: " + str(e))
        scope = self.scopes.pop()
        if self.complete:
            for filename,digest in scope["claims"]:
                if scope["files"].get(filename) != digest: raise Rejected("Missing/mismatched catalogue delivery: " + filename)


def make_archive(directory, out):
    root = Path(directory)
    with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
        for f in sorted(root.rglob("*")):
            if set(f.relative_to(root).parts).intersection({".git",".github"}): continue
            if f.is_symlink(): raise Rejected("Refuse to package symlink: " + str(f))
            if f.is_file(): z.write(f,f.relative_to(root).as_posix())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("archive"); p.add_argument("--rfm-catalogue", required=True)
    p.add_argument("--policy",default=str(ROOT/"policy.json"))
    p.add_argument("--holds",default=str(ROOT/"hosting-holds.json"))
    p.add_argument("--approved",default=str(ROOT/"hosting-approved.json"))
    p.add_argument("--builtin",default=str(ROOT.parent/"firmware/h1.rfm1"))
    p.add_argument("--extract-to"); p.add_argument("--report")
    p.add_argument("--complete-site",action="store_true")
    a = p.parse_args()
    guard = Guard(load(a.policy),load(a.holds),load(a.approved)["packages"],load(a.rfm_catalogue),Path(a.builtin).read_bytes(),a.complete_site)
    try: guard.check_archive(a.archive)
    except (Rejected,ValueError,KeyError) as e:
        print("REJECTED:",e); return 1
    if a.extract_to:
        out = Path(a.extract_to)
        if out.exists(): raise Rejected("Verified destination must not already exist")
        out.mkdir(parents=True)
        if not zipfile.is_zipfile(a.archive): raise Rejected("Only checked ZIPs can be extracted")
        with zipfile.ZipFile(a.archive) as z: z.extractall(out)
    result = {"archiveSHA256":sha(Path(a.archive).read_bytes()),"files":guard.files,"firmware":guard.firmware,"passed":True}
    if a.report: Path(a.report).write_text(json.dumps(result,indent=2)+"\n")
    print(f"PASSED: {guard.files} files; {len(guard.firmware)} approved firmware binaries")
    return 0


if __name__ == "__main__": raise SystemExit(main())
