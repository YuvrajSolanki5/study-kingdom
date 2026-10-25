#!/usr/bin/env python3
"""Downloads the public Supercell Clash of Clans fan kit.

Usage: fetch-fankit.py DEST [DOC_ID FOLDER]   (or set SK_ASSET_SOURCE). Without
a document, fetches Game assets (338), sorted by category; Logo is 337 and
Audio 652. The Font page (Clash Regular/Bold) is a separate attachment. The kit is ~26 GB, so
it lives outside the repo, e.g. /Volumes/SolankiNAS/Assets/supercell-coc-fankit.

Used with Supercell's permission for this non-profit project (see
docs/licensing.md). Resumable: finished files are skipped, partial files are
retried. Writes manifest.json with each file's categories and source.
"""
import json, os, re, sys, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

PORTAL = "vkEdmkUCngKw"
DEST = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SK_ASSET_SOURCE") or sys.exit(__doc__)
DOC = int(sys.argv[2]) if len(sys.argv) > 2 else 338
# Libraries other than Game assets have no categories; they go in one folder.
FOLDER = sys.argv[3] if len(sys.argv) > 3 else None
API = "https://fankit.supercell.com/api/assets/search/%d" % DOC
UA = {"User-Agent": "Mozilla/5.0 (study-kingdom asset sync)"}


def get(url, tries=4):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120)
        except Exception as e:  # noqa: BLE001 - network retry
            if i == tries - 1:
                raise
            time.sleep(2 ** i)


def page(n, extra=""):
    return json.load(get(f"{API}?limit=100&page={n}&order=NEWEST&portal_token={PORTAL}{extra}"))


def search(extra=""):
    """All results for a query; pages after the first are fetched in parallel."""
    first = page(1, extra)
    pages = -(-first["total"] // 100)
    with ThreadPoolExecutor(8) as pool:
        rest = list(pool.map(lambda n: page(n, extra)["data"], range(2, pages + 1)))
    return first["data"] + [a for r in rest for a in r], first


def safe(name):
    return re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip(" .") or "asset"


def main():
    os.makedirs(DEST, exist_ok=True)
    everything, first = search()
    facettes = first.get("facettes") or []
    cats = [] if FOLDER else [f["name"] for f in facettes[0]["items"]] if facettes else []
    member = {}
    with ThreadPoolExecutor(4) as pool:
        results = pool.map(lambda c: (c, search("&asset-type97=" + urllib.parse.quote(c))[0]), cats)
        for c, found in results:
            for a in found:
                member.setdefault(a["id"], []).append(c)
            print(f"category {c}: {len(found)}", flush=True)
    manifest = []
    for a in everything:
        c = [FOLDER] if FOLDER else member.get(a["id"], ["Other"])
        ext = a["ext"].lower()
        path = os.path.join(DEST, safe(c[0]), f"{safe(a['title'])}__{a['id']}.{ext}")
        url = a["generic_url"].split("?")[0]
        manifest.append({"id": a["id"], "title": a["title"], "categories": c, "ext": ext,
                         "width": a["width"], "height": a["height"], "kb": a["file_size"],
                         "path": os.path.relpath(path, DEST), "url": url})
    with open(os.path.join(DEST, "manifest.json" if DOC == 338 else f"manifest-{DOC}.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    total = len(manifest)
    done = [0]
    failed = []

    def fetch(m):
        path = os.path.join(DEST, m["path"])
        if os.path.exists(path) and os.path.getsize(path) > 0:
            done[0] += 1
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        part = path + ".part"
        try:
            with get(m["url"]) as r, open(part, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            os.replace(part, path)
        except Exception as e:  # noqa: BLE001
            failed.append((m["path"], str(e)))
            if os.path.exists(part):
                os.remove(part)
        done[0] += 1
        if done[0] % 100 == 0:
            print(f"progress {done[0]}/{total} failed {len(failed)}", flush=True)

    # Small files first so usable art lands early; huge renders and media last.
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(fetch, sorted(manifest, key=lambda m: m["kb"] or 0)))
    print(f"finished {total - len(failed)}/{total}; failed {len(failed)}", flush=True)
    for p, e in failed:
        print("FAILED", p, e, flush=True)


if __name__ == "__main__":
    main()
