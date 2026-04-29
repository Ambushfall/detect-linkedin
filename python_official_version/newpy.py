#!/usr/bin/env python3
"""
Extracts Chrome extension IDs from LinkedIn's detection JS bundle,
resolves their names from the Chrome Web Store, and outputs a CSV.

Usage:
    python3 enumerate_extensions.py <input.js> [output.csv]

Dependencies:
    pip install aiohttp
"""

import asyncio
import csv
import json
import re
import sys
import time
from pathlib import Path

import aiohttp

# Tune these to taste — CWS will start rate-limiting if you go too hard
CONCURRENCY = 10
REQUEST_TIMEOUT = 15
RETRY_COUNT = 3
RETRY_DELAY = 2.0

CWS_URL = "https://chromewebstore.google.com/detail/{id}"
# og:title on the CWS page is the cleanest source for the name
OG_TITLE_RE = re.compile(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\'](.*?)["\']', re.IGNORECASE)
# Fallback: page <title>
PAGE_TITLE_RE = re.compile(r'<title>(.*?)</title>', re.IGNORECASE)


def extract_ids(js_text: str) -> list[dict]:
    """
    Pull {id, file} pairs from the LinkedIn JS bundle.
    Returns a list of dicts sorted by id.
    """
    # Match the {id:"...",file:"..."} or {id:'...',file:'...'} pattern
    pattern = re.compile(
        r'\{[^}]*?id:\s*["\']([a-z]{32})["\'][^}]*?file:\s*["\']([^"\']+)["\'][^}]*?\}'
        r'|\{[^}]*?file:\s*["\']([^"\']+)["\'][^}]*?id:\s*["\']([a-z]{32})["\'][^}]*?\}',
        re.DOTALL
    )

    seen = {}
    for m in pattern.finditer(js_text):
        if m.group(1):
            ext_id, file_hint = m.group(1), m.group(2)
        else:
            ext_id, file_hint = m.group(4), m.group(3)

        if ext_id not in seen:
            seen[ext_id] = file_hint

    # Fallback: grab any quoted 32-char lowercase string not already found
    bare_pattern = re.compile(r'["\']([a-z]{32})["\']')
    for m in bare_pattern.finditer(js_text):
        ext_id = m.group(1)
        if ext_id not in seen:
            seen[ext_id] = ""

    return [{"id": k, "file_hint": v} for k, v in sorted(seen.items())]


def parse_name(html: str, ext_id: str) -> str:
    """Extract extension name from CWS HTML."""
    m = OG_TITLE_RE.search(html)
    if m:
        name = m.group(1).strip()
        # CWS og:title is usually just the extension name
        return name

    m = PAGE_TITLE_RE.search(html)
    if m:
        title = m.group(1).strip()
        # Page title format: "Name - Chrome Web Store"
        if " - " in title:
            return title.rsplit(" - ", 1)[0].strip()
        return title

    return ""


async def fetch_name(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    ext_id: str,
) -> tuple[str, str]:
    """
    Returns (ext_id, name_or_status).
    Possible statuses for unknown/gone extensions: "[not found]", "[error]", "[timeout]"
    """
    url = CWS_URL.format(id=ext_id)

    async with sem:
        for attempt in range(RETRY_COUNT):
            try:
                async with session.get(
                    url,
                    timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT),
                    allow_redirects=True,
                ) as resp:
                    if resp.status == 404:
                        return ext_id, "[not found]"
                    if resp.status == 429:
                        # Back off and retry
                        await asyncio.sleep(RETRY_DELAY * (attempt + 2))
                        continue
                    if resp.status != 200:
                        return ext_id, f"[http {resp.status}]"

                    html = await resp.text(errors="replace")
                    name = parse_name(html, ext_id)
                    return ext_id, name if name else "[parse failed]"

            except asyncio.TimeoutError:
                if attempt < RETRY_COUNT - 1:
                    await asyncio.sleep(RETRY_DELAY)
                else:
                    return ext_id, "[timeout]"
            except aiohttp.ClientError as e:
                if attempt < RETRY_COUNT - 1:
                    await asyncio.sleep(RETRY_DELAY)
                else:
                    return ext_id, f"[error: {type(e).__name__}]"

    return ext_id, "[failed]"


async def run(js_path: Path, out_path: Path):
    print(f"[*] Reading {js_path} ...", flush=True)
    js_text = js_path.read_text(errors="replace")

    print("[*] Extracting extension IDs ...", flush=True)
    extensions = extract_ids(js_text)
    print(f"[*] Found {len(extensions)} unique extension IDs", flush=True)

    # Build a lookup for file hints
    file_hints = {e["id"]: e["file_hint"] for e in extensions}
    ids = [e["id"] for e in extensions]

    sem = asyncio.Semaphore(CONCURRENCY)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }

    results = {}
    start = time.monotonic()

    async with aiohttp.ClientSession(headers=headers) as session:
        tasks = [fetch_name(session, sem, ext_id) for ext_id in ids]

        done = 0
        for coro in asyncio.as_completed(tasks):
            ext_id, name = await coro
            results[ext_id] = name
            done += 1

            if done % 50 == 0 or done == len(ids):
                elapsed = time.monotonic() - start
                rate = done / elapsed
                remaining = (len(ids) - done) / rate if rate > 0 else 0
                print(
                    f"  {done}/{len(ids)} ({done/len(ids)*100:.1f}%) "
                    f"— {rate:.1f} req/s — ~{remaining:.0f}s remaining",
                    flush=True,
                )

    print(f"\n[*] Writing {out_path} ...", flush=True)
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["extension_id", "name", "store_url", "detected_file"])
        for ext_id in ids:
            writer.writerow([
                ext_id,
                results.get(ext_id, "[unknown]"),
                CWS_URL.format(id=ext_id),
                file_hints.get(ext_id, ""),
            ])

    elapsed = time.monotonic() - start
    not_found = sum(1 for v in results.values() if v == "[not found]")
    errors = sum(1 for v in results.values() if v.startswith("[") and v != "[not found]")
    print(f"[*] Done in {elapsed:.1f}s")
    print(f"    {len(ids) - not_found - errors} named, {not_found} not found/removed, {errors} errors")
    print(f"    Output: {out_path}")


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <linkedin_bundle.js> [output.csv]")
        sys.exit(1)

    js_path = Path(sys.argv[1])
    if not js_path.exists():
        print(f"Error: {js_path} not found")
        sys.exit(1)

    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else js_path.with_suffix(".csv")

    asyncio.run(run(js_path, out_path))


if __name__ == "__main__":
    main()