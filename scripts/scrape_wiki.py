"""
Scrapes equipment, enchant and perk data from the Voxlpedia wiki
(https://voxlpedia.miraheze.org) and writes it to data/data.js for the builder.

Usage:  python scripts/scrape_wiki.py [--no-images] [--refresh]
  --no-images  skip downloading item / enchant images
  --refresh    ignore the local page cache and re-download every page
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", ".cache")
ASSETS = os.path.join(ROOT, "assets", "img")
API = "https://voxlpedia.miraheze.org/w/api.php"
UA = "VoxlbuilderDataScraper/1.0 (fan build planner)"

STAT_KEYS = [
    "Air Boost", "Dexterity Boost", "Earth Boost", "Fire Boost", "Hex Boost", "Holy Boost",
    "Magic Boost", "Physical Boost", "Summon Boost", "Water Boost", "Speed Boost", "Jump Boost",
    "Attack Speed", "Air Defense", "Earth Defense", "Fire Defense", "Hex Defense", "Holy Defense",
    "Magic Defense", "Physical Defense", "Water Defense", "Protection", "Warding", "Tenacity",
    "Cold Resistance", "Heat Resistance", "Armor Penetration",
]

REFRESH = "--refresh" in sys.argv
NO_IMAGES = "--no-images" in sys.argv


def http_json(params):
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - retry any network error
            print("  retry", attempt + 1, e)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("request failed: " + url)


def fetch_pages(titles):
    """Return {requested title: wikitext}, following redirects, 50 titles per request, cached."""
    os.makedirs(CACHE, exist_ok=True)
    cache_file = os.path.join(CACHE, "pages.json")
    cache = {}
    if os.path.exists(cache_file) and not REFRESH:
        cache = json.load(open(cache_file, encoding="utf8"))
    missing = [t for t in titles if t not in cache]
    for i in range(0, len(missing), 50):
        chunk = missing[i:i + 50]
        print(f"  fetching pages {i + 1}-{i + len(chunk)} of {len(missing)}")
        r = http_json({
            "action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
            "titles": "|".join(chunk), "redirects": 1, "format": "json", "formatversion": 2,
        })
        q = r["query"]
        alias = {}
        for n in q.get("normalized", []):
            alias[n["to"]] = n["from"]
        for rd in q.get("redirects", []):
            alias[rd["to"]] = alias.get(rd["from"], rd["from"])
        for p in q["pages"]:
            text = ""
            if "revisions" in p:
                text = p["revisions"][0]["slots"]["main"]["content"]
            req_title = alias.get(p["title"], p["title"])
            cache[req_title] = text
            cache[p["title"]] = text
        for t in chunk:
            cache.setdefault(t, "")
        time.sleep(0.5)
    json.dump(cache, open(cache_file, "w", encoding="utf8"))
    return {t: cache.get(t, "") for t in titles}


def raw(title):
    return fetch_pages([title])[title]


def list_from_template(template, wrapper):
    text = raw(template)
    return re.findall(r"\{\{" + wrapper + r"\|([^}]+)\}\}", text)


# ---------------------------------------------------------------- wikitext helpers

def strip_markup(s):
    s = s or ""
    s = re.sub(r"<nowiki>|</nowiki>", "", s)
    s = re.sub(r"\{\{StatusEffects\|([^}|]+)[^}]*\}\}", r"\1", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[https?://\S+ ([^\]]+)\]", r"\1", s)
    s = re.sub(r"<br\s*/?>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    s = s.replace("&nbsp;", " ").replace("&#32;", " ")
    return re.sub(r"\s+", " ", s).strip()


def split_template_params(body):
    """Split the inside of a {{Template|a=b|c=d}} call on top-level pipes."""
    parts, depth, cur, i = [], 0, "", 0
    while i < len(body):
        two = body[i:i + 2]
        if two in ("{{", "[["):
            depth += 1
            cur += two
            i += 2
            continue
        if two in ("}}", "]]"):
            depth -= 1
            cur += two
            i += 2
            continue
        ch = body[i]
        if ch == "|" and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
        i += 1
    parts.append(cur)
    params = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.strip()] = v.strip()
    return params


def find_templates(text, name):
    """Yield (start, params) for every {{name ...}} call, handling nesting."""
    for m in re.finditer(r"\{\{\s*" + re.escape(name) + r"\s*[|\n}]", text):
        start = m.start()
        depth, i = 0, start
        while i < len(text):
            if text.startswith("{{", i):
                depth += 1
                i += 2
            elif text.startswith("}}", i):
                depth -= 1
                i += 2
                if depth == 0:
                    break
            else:
                i += 1
        body = text[start + 2:i - 2]
        yield start, split_template_params(body.replace("{{!}}", "|"))


def parse_number(v):
    m = re.search(r"[-+]?\d+(?:[.,]\d+)?", v or "")
    return float(m.group(0).replace(",", ".")) if m else None


def parse_stats(params):
    stats = {}
    for k in STAT_KEYS:
        if k in params and params[k].strip():
            n = parse_number(params[k])
            if n is not None and n != 0:
                stats[k] = n
    return stats


def parse_perks(params):
    perks = []
    for idx in ["", " 1", " 2", " 3"]:
        name = params.get("Perk" + idx, "").strip()
        if not name:
            continue
        name = re.sub(r"\[\[|\]\]", "", name).split("|")[0].strip()
        amount = parse_number(params.get("Perk" + idx + " Amount", "+1")) or 1
        desc = strip_markup(params.get("Perk" + idx + " Description", ""))
        if not any(p["page"] == name for p in perks):
            perks.append({"page": name, "amount": amount, "desc": desc})
    return perks


def tab_label_before(text, pos):
    labels = list(re.finditer(r"\|-\|\s*([^=\n]+?)\s*=", text[:pos]))
    return labels[-1].group(1).strip() if labels else ""


def obtainment(text):
    for _, p in find_templates(text, "Armor"):
        o = p.get("obtainment", "")
        items = [strip_markup(x) for x in o.split("•")]
        return [x for x in items if x]
    return []


def infobox_image(text, title):
    for _, p in find_templates(text, "Armor"):
        img = p.get("image", "").strip()
        if img:
            return re.sub(r"\.png$", "", img, flags=re.I)
    return title


def intro_line(text):
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("'''") and "''' is" in line:
            return strip_markup(line)
    return ""


def display_name(title):
    return re.sub(r"\s*\((Armor|armor|Rune|Ring)\)$", "", title)


SLOT_BY_LABEL = {
    "helmet": "head", "head": "head", "hat": "head", "mask": "head", "crown": "head", "hood": "head",
    "chestplate": "chest", "chest": "chest", "shirt": "chest", "robe": "chest", "body": "chest",
    "leggings": "legs", "legs": "legs", "pants": "legs", "boots": "legs",
}


def guess_slot(label, piece_name):
    l = label.lower()
    for k, v in SLOT_BY_LABEL.items():
        if l == k or l.startswith(k):
            return v
    n = piece_name.lower()
    for words, slot in [
        (["helmet", "hat", "hood", "mask", "crown", "cap", "head", "laurel", "antennae", "blindfold",
          "noggin", "circlet", "helm", "goggles", "visor", "piercing", "lift"], "head"),
        (["chestplate", "chest", "shirt", "robe", "armor", "torso", "coat", "cloak", "vest", "jacket",
          "body", "tunic", "plate", "mail", "scarf", "prosthesis", "muscles"], "chest"),
        (["leggings", "pants", "boots", "legs", "greaves", "shoes", "skirt"], "legs"),
    ]:
        if any(w in n for w in words):
            return slot
    return None


# ---------------------------------------------------------------- scrapers

def scrape_armors():
    names = list_from_template("Template:Armors/All", "Armors")
    pages = fetch_pages(names)
    sets, items, unknown = [], [], []
    for title in names:
        text = pages[title]
        if not text:
            print("  !! missing armor page", title)
            continue
        set_name = display_name(title)
        set_id = slugify(set_name)
        set_items = []
        for pos, params in find_templates(text, "ArmorStats"):
            piece = strip_markup(params.get("Name", "")) or set_name
            label = tab_label_before(text, pos)
            slot = guess_slot(label, piece)
            if not slot:
                unknown.append((title, label, piece))
                continue
            item_id = slugify(piece)
            if any(i["id"] == item_id for i in items):
                continue
            item = {
                "id": item_id, "name": piece, "slot": slot, "set": set_name, "page": title,
                "desc": strip_markup(params.get("Description", "")),
                "stats": parse_stats(params), "perks": parse_perks(params),
                "image": title,
            }
            items.append(item)
            set_items.append(item_id)
        if set_items:
            sets.append({"id": set_id, "name": set_name, "page": title, "items": set_items,
                         "obtain": obtainment(text)})
    if unknown:
        print("  pieces with unknown slot:")
        for u in unknown:
            print("   ", u)
    return sets, items


def scrape_simple(template, wrapper, slot):
    names = list_from_template(template, wrapper)
    pages = fetch_pages(names)
    items = []
    for title in names:
        text = pages[title]
        if not text:
            print("  !! missing page", title)
            continue
        for _, params in find_templates(text, "ArmorStats"):
            name = strip_markup(params.get("Name", "")) or display_name(title)
            item = {
                "id": slugify(name), "name": name, "slot": slot, "page": title,
                "desc": strip_markup(params.get("Description", "")),
                "stats": parse_stats(params), "perks": parse_perks(params),
                "obtain": obtainment(text), "image": infobox_image(text, title),
            }
            cd = parse_number(params.get("Cooldown", ""))
            if cd:
                item["cooldown"] = cd
            if slot == "rune":
                m = re.search(r"==\s*'*Rune Details'*\s*==(.*?)(?:\n==|$)", text, re.S)
                if m:
                    details = [strip_markup(li) for li in re.findall(r"<li>(.*?)(?=<li>|</ul>|</li>)", m.group(1), re.S)]
                    item["details"] = [d for d in details if d]
            items.append(item)
            break
    return items


DMG_TYPES = ["Air", "Earth", "Fire", "Hex", "Holy", "Magic", "Physical", "Water", "True"]
SCALINGS = ["Air", "Dexterity", "Earth", "Fire", "Hex", "Holy", "Magic", "Physical", "Summon", "Water"]


def parse_type_list(text, suffix):
    """'0.7 Fire Damage Type, 0.3 Magic ...' -> {'Fire': 0.7, 'Magic': 0.3}"""
    out = {}
    for num, name in re.findall(r"([\d.]+)\s+'*\s*(\w+)\s*'*\s*" + suffix, text):
        try:
            out[name] = out.get(name, 0) + float(num)
        except ValueError:
            pass
    return out


def parse_named(text, names):
    """'0.5 Physical 0.5 True' / '1.0 Magic 1.0 Dex' -> {'Physical': 0.5, ...} for names in `names`."""
    text = strip_markup(text)
    if re.search(r"highest", text, re.I):
        return {"__highest__": parse_number(text) or 1}
    out = {}
    for num, word in re.findall(r"([\d.]+)\s+([A-Za-z]+)", text):
        name = next((n for n in names if n.lower().startswith(word.lower()) and len(word) >= 3), None)
        if name:
            out[name] = out.get(name, 0) + float(num)
    return out


def parse_hits(expr):
    """'3.5 * 5 Hits + 17.5' -> [[3.5, 5], [17.5, 1]]; None if not a plain number expression."""
    expr = strip_markup(expr).replace("x", "*").replace("×", "*")
    terms = []
    for part in expr.split("+"):
        part = part.strip()
        m = re.fullmatch(r"([\d.]+)\s*(?:\*\s*([\d.]+)\s*(?:Hits?|hits?)?)?(?:\s*\(.*\))?", part)
        if not m:
            return None
        terms.append([float(m.group(1)), float(m.group(2) or 1)])
    return terms or None


def rune_attack(details):
    """Build an attack description from a rune's 'Rune Details' lines."""
    text = " // ".join(details)
    attack = {}
    m = re.search(r"Base Damage of ([\d.]+)(?:\s*\*\s*([\d.]+)\s*Hits)?", text)
    if m:
        attack["hits"] = [[float(m.group(1)), float(m.group(2) or 1)]]
        for line in details:
            if "Damage Type" in line and "types" not in attack:
                attack["types"] = parse_type_list(line, "Damage Type")
            if "Scaling" in line and "scalings" not in attack:
                attack["scalings"] = parse_type_list(line, "Scaling")
    applies = []
    for m in re.finditer(r"(?:[Aa]pplies|[Gg]rants) (?:([\d.]+) potency )?([A-Z][\w ]*?)(?: at ([\d.]+) potency)? for ([\d.]+) seconds", text):
        potency = m.group(1) or m.group(3)
        applies.append({"status": m.group(2).strip(), "potency": float(potency) if potency else None, "duration": float(m.group(4))})
    if applies:
        attack["applies"] = applies
    return attack or None


def scrape_weapon_parts():
    lists = [("Template:Handles/All", "handle"), ("Template:Blades/All", "blade"),
             ("Template:Essences/All", "essence"), ("Template:Gloves/All", "gloves")]
    parts = []
    for template, kind in lists:
        names = list_from_template(template, "Blades")
        pages = fetch_pages(names)
        for title in names:
            text = pages[title]
            params = next((p for _, p in find_templates(text, "WeaponPartDetails")), None)
            if params is None:
                print("  !! no part details", title)
                continue
            ptype = strip_markup(params.get("Part Type", ""))
            # Monk shields live in the gloves list
            part_kind = kind
            types = {t: parse_number(params[t + " Type"]) for t in DMG_TYPES if params.get(t + " Type", "").strip()}
            scal = {s: parse_number(params[s + " Scaling"]) for s in SCALINGS if params.get(s + " Scaling", "").strip()}
            perks = []
            for i in range(1, 11):
                name = params.get(f"Perk {i}", "").strip()
                if name:
                    name = re.sub(r"\[\[|\]\]", "", name).split("|")[0].strip()
                    perks.append({"page": name, "amount": parse_number(params.get(f"Perk {i} Amount", "+1")) or 1, "desc": ""})
            parts.append({
                "id": slugify(title), "name": title, "kind": part_kind, "partType": ptype,
                "tier": int(parse_number(params.get("Tier", "1")) or 1),
                "attackSpeed": parse_number(params.get("Attack Speed", "1")) or 1,
                "types": {k: v for k, v in types.items() if v}, "scalings": {k: v for k, v in scal.items() if v},
                # "Attack Speed" on a part is the weapon's swing speed, not the Attack Speed stat
                "stats": {k: v for k, v in parse_stats(params).items() if k != "Attack Speed"}, "perks": perks,
                "obtain": [strip_markup(params.get("Obtained", ""))] if params.get("Obtained") else [],
                "page": title, "image": title,
            })
    return parts


def scrape_weapon_arts():
    text = raw("Template:WeaponArtInfoboxs")
    arts = []
    for _, p in find_templates(text, "WeaponArtInfobox"):
        name = strip_markup(p.get("Name", ""))
        stats = p.get("Stats", "")
        if not name:
            continue

        def field(label):
            m = re.search(r"'''" + label + r":?'''\s*:?\s*(.*)", stats)
            return strip_markup(m.group(1)) if m else ""

        req = re.search(r"====\s*Requirements\s*====(.*?)(?:====|$)", stats, re.S)
        notes = re.search(r"====\s*Additional Notes\s*====(.*?)(?:====|$)", stats, re.S)
        type_text, scal_text = field("Damage Type\\(s\\)"), field("Scaling")
        arts.append({
            "id": slugify(name), "name": name, "desc": strip_markup(p.get("Description", "")),
            "cooldown": parse_number(field("Cooldown")),
            "baseText": field("Base Damage"),
            "hits": parse_hits(field("Base Damage")) if field("Base Damage") else None,
            "types": None if not type_text or "same" in type_text.lower() else (parse_named(type_text, DMG_TYPES) or None),
            "typesText": type_text,
            "scalings": None if not scal_text or "same" in scal_text.lower() else (parse_named(scal_text, SCALINGS) or None),
            "scalingText": scal_text,
            # requirement lines are usually bullets, but some (Warrior Stomp) are plain lines
            "requirements": [strip_markup(x) for x in re.findall(r"^\*?[ \t]*([^=\s].*)$", req.group(1).split("\n==")[0], re.M)] if req else [],
            "notes": [strip_markup(x) for x in re.findall(r"^\*(.+)$", notes.group(1), re.M)] if notes else [],
            "image": name,  # Template:WeaponArtNavbox shows File:<Name>.png
        })
    return arts


def category_members(cat):
    titles, cont = [], {}
    while True:
        r = http_json({"action": "query", "list": "categorymembers", "cmtitle": "Category:" + cat, "cmlimit": 500,
                       "cmnamespace": 0, "format": "json", "formatversion": 2, **cont})
        titles += [m["title"] for m in r["query"]["categorymembers"]]
        if "continue" not in r:
            return titles
        cont = {"cmcontinue": r["continue"]["cmcontinue"]}


ENEMY_TYPES = ["Physical", "Magic", "Fire", "Water", "Earth", "Air", "Hex", "Holy", "True"]


def parse_enemy_damage(v):
    """': 6 × 2 + 9' / '&nbsp;Damage (Bite): 2.5' -> (sub-label, total, hits); total None when unknown."""
    v = strip_markup(v).replace("×", "x")
    m = re.match(r"^\s*(?:Damage)?\s*(?:\(([^)]*)\))?\s*:?\s*(.*)$", v)
    label, expr = (m.group(1) or "").strip(), m.group(2)
    expr = re.split(r"\bOR\b", expr, flags=re.I)[0]
    total, hits = 0.0, 0
    for term in expr.split("+"):
        nums = re.findall(r"\d+(?:\.\d+)?|\?", term)
        if not nums or "?" in nums:
            return label, None, 0
        a = float(nums[0])
        n = int(float(nums[1])) if len(nums) > 1 and "x" in term else 1
        total += a * n
        hits += n
    return label, round(total, 3), hits


def scrape_enemies():
    titles = [t for t in category_members("Mobs") if not t.endswith("Bestiary")]
    pages = fetch_pages(titles)
    enemies = []
    for title in titles:
        text = pages.get(title, "")
        heads = list(find_templates(text, "Enemies"))
        if not heads:
            continue
        info = heads[0][1]
        name = strip_markup(info.get("Enemy Name", "")) or re.sub(r"\s*\(Enemy\)$", "", title)
        defenses = {}
        for t in ENEMY_TYPES:
            n = parse_number(info.get(t + " Defense", ""))
            if n:
                defenses[t] = n
        attacks = []
        stats = list(find_templates(text, "EnemyStats"))
        for i, (pos, params) in enumerate(stats):
            tab = tab_label_before(text, pos) or "Attack"
            # notes: bullet lines after this template, up to the next tab / template
            end = min([x for x in [text.find("|-|", pos + 2), text.find("</tabber>", pos), stats[i + 1][0] if i + 1 < len(stats) else -1] if x > 0] or [len(text)])
            tail = text[pos:end]
            notes = [strip_markup(x) for x in re.findall(r"^\*+\s*(.+)$", tail, re.M)]
            groups = {}
            for k, v in params.items():
                t = k.replace(" Damage", "").strip()
                if t not in ENEMY_TYPES:
                    continue
                label, total, hits = parse_enemy_damage(v)
                g = groups.setdefault(label, {"parts": {}, "hits": 0, "unknown": False})
                if total is None:
                    g["unknown"] = True
                    continue
                g["parts"][t] = round(g["parts"].get(t, 0) + total, 3)
                g["hits"] = max(g["hits"], hits)
            for label, g in groups.items():
                if g["unknown"] or not g["parts"]:
                    continue
                attacks.append({
                    "name": tab + (" · " + label if label and len(groups) > 1 else (" (" + label + ")" if label else "")),
                    "parts": g["parts"], "hits": g["hits"] or 1,
                    "guardbreak": any(re.search(r"guard ?break", x, re.I) and not re.search(r"can(?:'|no)t|not", x, re.I) for x in notes),
                    "notes": notes[:4],
                })
        if not attacks:
            continue
        enemies.append({
            "id": slugify(name), "name": name, "page": title, "image": title,
            "hp": parse_number(info.get("HP", "")), "poise": parse_number(info.get("Poise", "")),
            "tenacity": parse_number(info.get("Tenacity", "")), "defenses": defenses, "attacks": attacks,
        })
    return sorted(enemies, key=lambda e: e["name"])


def scrape_guilds():
    text = raw("Guilds")
    titles = []
    for t in re.findall(r"link=([^\]|]+)\]\]", text):
        if t not in titles:
            titles.append(t)
    pages = fetch_pages(titles)
    guilds = []
    for title in titles:
        page = pages[title]
        ranks = []
        for pos, params in find_templates(page, "GuildStats"):
            ranks.append({"label": tab_label_before(page, pos), "stats": parse_stats(params), "perks": parse_perks(params)})
        m = re.search(r"\{\{#description2:(.*?)\n", page)
        desc = strip_markup(m.group(1)) if m else ""
        req = re.findall(r"^-\s*(.+)$", page, re.M)
        guilds.append({
            "id": slugify(display_name(title).replace(" (Guild)", "")), "name": re.sub(r"\s*\(Guild\)$", "", title),
            "page": title, "desc": desc, "requirements": [strip_markup(r) for r in req[:4]],
            "ranks": ranks, "image": title,
        })
    return guilds


def scrape_races():
    text = raw("Races")
    races = []
    blocks = re.split(r"\|-\|", text)
    for b in blocks[1:]:
        label = b.split("=", 1)[0].strip()
        params = next((p for _, p in find_templates(b, "Race")), {})
        det = re.search(r'<div class="raceDetails">(.*?)</div>\s*(?:==|\Z|\|)', b, re.S)
        details = []
        if det:
            details = [strip_markup(x) for x in re.findall(r"<(?:p|li|div)>(.*?)</(?:p|li|div)>", det.group(1), re.S)]
        image = ""
        imgs = params.get("Image", "")
        if imgs:
            image = imgs.split(",")[0].strip().replace(".png", "")
        races.append({
            "id": slugify(label), "name": label,
            "desc": strip_markup(params.get("Race Description", "")),
            "passive": strip_markup(params.get("Race Passive", "")),
            "details": [d for d in details if d],
            "image": image or None,
        })
    return races


def scrape_perk_descriptions(perk_pages):
    pages = fetch_pages(sorted(perk_pages))
    out = {}
    for title, text in pages.items():
        name = display_name(re.sub(r"\s*\(Perk\)$", "", title))
        desc = ""
        m = re.search(r"\|\s*Description\s*=\s*(.*?)\n\s*\|", text, re.S)
        if m:
            desc = strip_markup(m.group(1))
        if not desc:
            desc = intro_line(text)
        tags = []
        m = re.search(r"\|\s*Tags\s*=\s*(.*?)\n", text)
        if m:
            tags = [t.strip() for t in m.group(1).split(",") if t.strip()]
        out[title] = {"name": name, "desc": desc, "tags": tags}
    return out


# Perks granted by enchants (not listed on any item), so they get descriptions and tags too.
ENCHANT_PERKS = ["Perfection", "Brawny", "Wildfire", "Rainstorm", "Stone Weapon", "Magic Surge", "Dark One", "Tempest", "Heal Boost",
                 "Minion Absorption", "Wall", "Hex Shield", "Ferocity", "Contained", "Lifesteal", "Undead Might", "Turtle", "Frenzy",
                 "Life Drinker", "Melting Shred", "Sweet Tooth", "Perk Effectiveness"]


def parse_enchants():
    """Default/ascended enchant pairs, in the order of the wiki's enchant table."""
    text = raw("Template:EnchantTable")
    cells = re.findall(r"\{\{EnchantTableCell\s*\|Enchant Name=(.*?)\n\|Stats=(.*?)\|Notes=(.*?)\}\}", text, re.S)
    out = []
    for i, (name, stats, notes) in enumerate(cells):
        descs = re.findall(r'<div class="enchantPerkDescription">(.*?)</div>', stats, re.S)
        out.append({
            "name": name.strip(),
            "ascended": i % 2 == 1,
            "base": cells[i - 1][0].strip() if i % 2 == 1 else None,
            "perkDesc": strip_markup(descs[0]) if descs else "",
            "notes": strip_markup(notes),
        })
    return out


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# ---------------------------------------------------------------- images

def image_urls(filenames):
    urls = {}
    names = list(filenames)
    for i in range(0, len(names), 50):
        chunk = names[i:i + 50]
        r = http_json({
            "action": "query", "prop": "imageinfo", "iiprop": "url", "iiurlwidth": 320,
            "titles": "|".join("File:" + n for n in chunk), "format": "json", "formatversion": 2,
        })
        alias = {n["to"]: n["from"] for n in r["query"].get("normalized", [])}
        for p in r["query"]["pages"]:
            if "imageinfo" in p:
                info = p["imageinfo"][0]
                key = alias.get(p["title"], p["title"])[5:]
                urls[key] = info.get("thumburl") or info["url"]
        time.sleep(0.3)
    return urls


def trim_image(path, size=128, margin=0.06):
    """Crop transparent padding so small items (rings, runes) fill their tile; margin=None only downsizes.
    Needs Pillow; skipped without it."""
    try:
        from PIL import Image
    except ImportError:
        return
    im = Image.open(path).convert("RGBA")
    if margin is None:
        if im.width > size:
            im.resize((size, round(im.height * size / im.width)), Image.LANCZOS).save(path, optimize=True)
        return
    bbox = im.split()[-1].point(lambda a: 255 if a > 8 else 0).getbbox()
    if not bbox:
        return
    im = im.crop(bbox)
    side = int(max(im.size) * (1 + 2 * margin))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    if side > size:
        canvas = canvas.resize((size, size), Image.LANCZOS)
    canvas.save(path, optimize=True)


def download_images(wanted):
    """wanted: {local file name: wiki file name}. Returns set of local names that exist."""
    os.makedirs(ASSETS, exist_ok=True)
    have = set(f for f in os.listdir(ASSETS))
    todo = {k: v for k, v in wanted.items() if k not in have}
    if todo and not NO_IMAGES:
        urls = image_urls(set(todo.values()))
        for local, wiki in todo.items():
            url = urls.get(wiki)
            if not url:
                continue
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                data = urllib.request.urlopen(req, timeout=30).read()
                open(os.path.join(ASSETS, local), "wb").write(data)
                # Enchant images are slot frames: keep their full canvas so every frame lines up.
                trim_image(os.path.join(ASSETS, local), margin=0.06 if not local.startswith("ench-") else None)
                have.add(local)
                print("  img", local)
            except Exception as e:  # noqa: BLE001
                print("  !! image failed", wiki, e)
            time.sleep(0.15)
    return have


MULTI_FRAMES = {
    "de": {"border": "DE Redisign Border.png", "mask": "DE Redisign Mask.png"},
    "te": {"border": "Ascended TE.png", "mask": "Ascended TE Mask.png"},
}


def multi_frames():
    """Double/triple enchant frame art and masks, as data URIs (CSS masks can't load from file://)."""
    import base64
    import io
    urls = image_urls({f for d in MULTI_FRAMES.values() for f in d.values()})
    out = {}
    for kind, files in MULTI_FRAMES.items():
        out[kind] = {}
        for part, wiki in files.items():
            req = urllib.request.Request(urls[wiki], headers={"User-Agent": UA})
            data = urllib.request.urlopen(req, timeout=30).read()
            try:
                from PIL import Image
                im = Image.open(io.BytesIO(data)).convert("RGBA").resize((128, 128), Image.LANCZOS)
                buf = io.BytesIO()
                im.save(buf, "PNG", optimize=True)
                data = buf.getvalue()
            except ImportError:
                pass
            out[kind][part] = "data:image/png;base64," + base64.b64encode(data).decode()
    return out


# ---------------------------------------------------------------- main

def main():
    print("Armors…")
    sets, armor_items = scrape_armors()
    print("Rings…")
    rings = scrape_simple("Template:Rings/All", "Rings", "ring")
    print("Runes…")
    runes = scrape_simple("Template:Runes/All", "Runes", "rune")
    for s in sets:
        for it in armor_items:
            if it["set"] == s["name"]:
                it["obtain"] = s["obtain"]
    items = armor_items + rings + runes
    for r in runes:
        atk = rune_attack(r.get("details", []))
        if atk:
            r["attack"] = atk

    print("Weapon parts…")
    parts = scrape_weapon_parts()
    print("Weapon arts…")
    arts = scrape_weapon_arts()
    print("Guilds…")
    guilds = scrape_guilds()
    print("Races…")
    races = scrape_races()
    print("Enemies…")
    enemies = scrape_enemies()

    print("Perks…")
    holders = items + parts + [rank for g in guilds for rank in g["ranks"]]
    perk_pages = {p["page"] for it in holders for p in it["perks"]} | set(ENCHANT_PERKS)
    perk_info = scrape_perk_descriptions(perk_pages)
    perks = {}
    for title in ENCHANT_PERKS:
        info = perk_info[title]
        perks[slugify(info["name"])] = {"name": info["name"], "page": title, "desc": info["desc"], "tags": info["tags"]}
    for it in holders:
        for p in it["perks"]:
            info = perk_info.get(p["page"], {"name": display_name(p["page"]), "desc": ""})
            pid = slugify(info["name"])
            p["id"] = pid
            entry = perks.setdefault(pid, {"name": info["name"], "page": p["page"], "desc": info["desc"], "tags": info.get("tags", [])})
            if not entry["desc"] and p["desc"]:
                entry["desc"] = p["desc"]
            del p["page"]
            if p["desc"] == entry["desc"] or not p["desc"]:
                del p["desc"]

    print("Enchants…")
    enchants = parse_enchants()

    print("Images…")
    wanted = {}
    for it in items:
        local = slugify(it["image"]) + ".png"
        wanted[local] = it["image"] + ".png"
        it["image"] = local
    for e in enchants:
        wanted["ench-" + slugify(e["name"]) + ".png"] = e["name"] + " Enchantment.png"
    others = parts + guilds + [r for r in races if r["image"]] + arts + enemies
    for it in others:
        prefix = "guild-" if it in guilds else "race-" if it in races else "art-" if it in arts else "mob-" if it in enemies else "part-"
        local = prefix + slugify(it["image"]) + ".png"
        wanted[local] = it["image"] + ".png"
        it["image"] = local
    have = download_images(wanted)
    for it in items + others:
        if it["image"] not in have:
            it["image"] = None
    for e in enchants:
        local = "ench-" + slugify(e["name"]) + ".png"
        e["image"] = local if local in have else None

    data = {
        "source": "https://voxlpedia.miraheze.org/wiki/Voxlblade_Wiki",
        "scraped": time.strftime("%Y-%m-%d"),
        "items": items, "sets": sets, "perks": perks, "enchants": enchants,
        "parts": parts, "arts": arts, "guilds": guilds, "races": races, "enemies": enemies,
        "multiFrames": multi_frames(),
    }
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "data.js"), "w", encoding="utf8") as f:
        f.write("// Generated by scripts/scrape_wiki.py from the Voxlpedia wiki. Do not edit by hand.\n")
        f.write("window.VOXL_DATA = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    counts = {s: sum(1 for i in items if i["slot"] == s) for s in ["head", "chest", "legs", "ring", "rune"]}
    print("done:", counts, "perks", len(perks), "enchants", len(enchants), "parts", len(parts),
          "arts", len(arts), "guilds", len(guilds), "races", len(races), "enemies", len(enemies))


if __name__ == "__main__":
    main()
