"""Download webfonts (latin + cyrillic) so the app works fully offline.

Run once:  python tools/fetch_fonts.py
"""
import os
import re
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "assets", "fonts"))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

FAMILIES = [
    ("Caveat", "https://fonts.googleapis.com/css2?family=Caveat:wght@400..700&display=swap"),
    ("Neucha", "https://fonts.googleapis.com/css2?family=Neucha&display=swap"),
    ("Manrope", "https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap"),
]

BLOCK_RE = re.compile(r"/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*\{[^}]*\})", re.S)
KEEP = {"latin", "latin-ext", "cyrillic", "cyrillic-ext"}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=60).read().decode("utf-8")


def main():
    os.makedirs(OUT, exist_ok=True)
    css_parts = []
    seen = set()
    for family, url in FAMILIES:
        css = fetch(url)
        for subset, block in BLOCK_RE.findall(css):
            if subset not in KEEP:
                continue
            m = re.search(r"url\((https://[^)]+\.woff2)\)", block)
            if not m:
                continue
            src = m.group(1)
            weight = re.search(r"font-weight:\s*([^;]+);", block)
            style = re.search(r"font-style:\s*([^;]+);", block)
            name = "%s-%s-%s-%s.woff2" % (
                family.lower().replace(" ", ""),
                (weight.group(1).strip() if weight else "400").replace(" ", "_"),
                (style.group(1).strip() if style else "normal"),
                subset,
            )
            key = (family, (weight.group(1) if weight else ""), subset, src)
            if key in seen:
                continue
            seen.add(key)
            path = os.path.join(OUT, name)
            if not os.path.exists(path):
                data = urllib.request.urlopen(
                    urllib.request.Request(src, headers={"User-Agent": UA}), timeout=60
                ).read()
                with open(path, "wb") as fh:
                    fh.write(data)
                print("saved", name, len(data) // 1024, "KB")
            local = block.replace(src, name)
            css_parts.append("/* %s / %s */\n%s" % (family, subset, local))

    header = "/* Local webfonts. Fonts are licensed under the SIL Open Font License. */\n"
    with open(os.path.join(OUT, "fonts.css"), "w", encoding="utf-8") as fh:
        fh.write(header + "\n".join(css_parts) + "\n")
    print("wrote", os.path.join(OUT, "fonts.css"), "faces:", len(css_parts))


if __name__ == "__main__":
    main()
