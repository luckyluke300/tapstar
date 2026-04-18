"""
UK / IRELAND HORSE RACING DATA COLLECTOR v2
USAGE:  python racing_collector.py --date today
        python racing_collector.py --date 2026-03-01
SETUP:  python -m pip install requests beautifulsoup4 cloudscraper pandas lxml
"""

import requests
import cloudscraper
import pandas as pd
import time
import os
import re
import argparse
from datetime import datetime, timedelta
from bs4 import BeautifulSoup

# ── CONFIG ────────────────────────────────────────────────────
OUTPUT_DIR            = "data"
REQUEST_DELAY         = 2.5
PAST_RACES_TO_COLLECT = 10
BETFAIR_USERNAME      = None
BETFAIR_PASSWORD      = None
BETFAIR_APP_KEY       = None

# ── HEADERS ───────────────────────────────────────────────────
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Referer": "https://www.google.com/",
    "DNT": "1",
}

# ── COORDINATES ───────────────────────────────────────────────
COURSE_COORDINATES = {
    "ascot": (51.4082, -0.6677),
    "cheltenham": (51.9002, -2.0621),
    "newmarket": (52.2408, 0.4054),
    "goodwood": (50.8968, -0.7514),
    "haydock": (53.4630, -2.6247),
    "york": (53.9613, -1.0878),
    "sandown": (51.3681, -0.3482),
    "kempton": (51.4109, -0.3697),
    "lingfield": (51.1780, -0.0137),
    "wolverhampton": (52.5882, -2.1403),
    "chester": (53.1946, -2.8985),
    "epsom": (51.3361, -0.2420),
    "newbury": (51.3988, -1.3228),
    "leicester": (52.6316, -1.1006),
    "nottingham": (52.9483, -1.1290),
    "windsor": (51.4738, -0.6470),
    "brighton": (50.8282, -0.1339),
    "carlisle": (54.8827, -2.9311),
    "catterick": (54.3779, -1.6289),
    "chepstow": (51.6411, -2.6750),
    "doncaster": (53.5224, -1.0939),
    "exeter": (50.7266, -3.4897),
    "huntingdon": (52.3333, -0.1833),
    "musselburgh": (55.9367, -3.0447),
    "newcastle": (54.9867, -1.6167),
    "perth": (56.3950, -3.4317),
    "pontefract": (53.6826, -1.3124),
    "redcar": (54.6167, -1.0667),
    "ripon": (54.1333, -1.5167),
    "salisbury": (51.0833, -1.7833),
    "southwell": (53.0667, -0.9500),
    "thirsk": (54.2333, -1.3500),
    "uttoxeter": (52.9000, -1.8667),
    "warwick": (52.2833, -1.5833),
    "wincanton": (51.0500, -2.4000),
    "worcester": (52.1833, -2.2167),
    "ffos las": (51.7614, -4.2133),
    "leopardstown": (53.2884, -6.1726),
    "curragh": (53.1559, -6.8151),
    "punchestown": (53.1384, -6.6537),
    "galway": (53.2719, -8.9714),
    "cork": (51.8500, -8.5667),
    "naas": (53.2167, -6.6667),
    "navan": (53.6500, -6.7000),
    "tipperary": (52.4667, -8.1667),
    "dundalk": (54.0000, -6.4167),
}

# ── UTILITIES ─────────────────────────────────────────────────

def make_output_dir():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print("  Created output folder: data/")

def save_csv(df, filename):
    path = os.path.join(OUTPUT_DIR, filename)
    df.to_csv(path, index=False)
    print("  Saved " + str(len(df)) + " rows -> " + path)

def get_course_coords(name):
    n = name.lower().strip()
    if n in COURSE_COORDINATES:
        return COURSE_COORDINATES[n]
    for key, coords in COURSE_COORDINATES.items():
        if key in n or n in key:
            return coords
    return None

def polite_sleep():
    time.sleep(REQUEST_DELAY)

def make_scraper():
    s = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "mobile": False}
    )
    s.headers.update(HEADERS)
    return s

# ── MODULE 1: RACE CARDS ──────────────────────────────────────

def get_race_cards(date_str):
    print("\n[1/6] Fetching race cards for " + date_str + "...")

    races = _try_racing_post(date_str)
    if races:
        print("  Found " + str(len(races)) + " races via Racing Post")
        return races

    print("  Racing Post unavailable, trying Sporting Life...")
    polite_sleep()
    races = _try_sporting_life(date_str)
    if races:
        print("  Found " + str(len(races)) + " races via Sporting Life")
        return races

    print("  Sporting Life unavailable, trying BBC Sport...")
    polite_sleep()
    races = _try_bbc_sport(date_str)
    if races:
        print("  Found " + str(len(races)) + " meetings via BBC Sport")
        return races

    print("\n  Could not fetch races from any source.")
    print("  Try: python racing_collector.py --date 2026-03-01")
    return []


def _try_racing_post(date_str):
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        rp_date = dt.strftime("%d-%m-%Y")
    except Exception:
        rp_date = date_str

    url = "https://www.racingpost.com/results/" + rp_date
    scraper = make_scraper()
    try:
        resp = scraper.get(url, timeout=20)
        if resp.status_code != 200:
            return []
    except Exception:
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    races = []

    for meeting in soup.find_all(["section", "div"], class_=re.compile(r"meeting|venue", re.I)):
        heading = meeting.find(["h2", "h3", "h4"])
        course = heading.get_text(strip=True) if heading else ""
        if not course:
            continue
        for row in meeting.find_all(["div", "li"], class_=re.compile(r"race|result", re.I)):
            try:
                time_el = row.find(class_=re.compile(r"time", re.I))
                name_el = row.find(class_=re.compile(r"title|name", re.I))
                dist_el = row.find(class_=re.compile(r"dist", re.I))
                going_el = row.find(class_=re.compile(r"going|ground", re.I))
                link_el = row.find("a", href=True)
                race_url = ""
                if link_el:
                    href = link_el["href"]
                    race_url = ("https://www.racingpost.com" + href if href.startswith("/") else href)
                races.append({
                    "date": date_str,
                    "course": course,
                    "race_time": time_el.get_text(strip=True) if time_el else "",
                    "race_name": name_el.get_text(strip=True) if name_el else "",
                    "distance": dist_el.get_text(strip=True) if dist_el else "",
                    "going": going_el.get_text(strip=True) if going_el else "",
                    "race_class": "",
                    "race_url": race_url,
                    "source": "Racing Post",
                })
            except Exception:
                continue
    return races


def _extract_time_from_sl_url(sl_url):
    m = re.search(r"/(\d{2})-(\d{2})-", sl_url)
    if m:
        return m.group(1) + ":" + m.group(2)
    return ""


def _sl_url_to_rp_url(sl_url, date_str):
    try:
        parts = sl_url.rstrip("/").split("/")
        date_idx = next((i for i, p in enumerate(parts) if re.match(r"\d{4}-\d{2}-\d{2}", p)), None)
        if date_idx is not None and date_idx + 1 < len(parts):
            course_slug = parts[date_idx + 1]
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            rp_date = dt.strftime("%d-%m-%Y")
            return "https://www.racingpost.com/results/" + rp_date + "/" + course_slug
    except Exception:
        pass
    return sl_url


def _try_sporting_life(date_str):
    url = "https://www.sportinglife.com/racing/results/" + date_str
    scraper = make_scraper()
    try:
        resp = scraper.get(url, timeout=20)
        if resp.status_code != 200:
            return []
    except Exception:
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    races = []
    current_course = ""

    for tag in soup.find_all(["h2", "h3", "h4", "a"]):
        text = tag.get_text(strip=True)
        if tag.name in ["h2", "h3", "h4"] and len(text) < 40:
            current_course = text
            continue
        if tag.name == "a":
            href = tag.get("href", "")
            if re.search(r"racing/results/\d{4}-\d{2}-\d{2}/", href):
                sl_url = ("https://www.sportinglife.com" + href if href.startswith("/") else href)
                rp_url = _sl_url_to_rp_url(sl_url, date_str)
                races.append({
                    "date": date_str,
                    "course": current_course,
                    "race_time": _extract_time_from_sl_url(sl_url),
                    "race_name": text,
                    "distance": "",
                    "going": "",
                    "race_class": "",
                    "race_url": rp_url,
                    "sl_url": sl_url,
                    "source": "Sporting Life",
                })

    seen, unique = set(), []
    for r in races:
        if r["race_url"] not in seen:
            seen.add(r["race_url"])
            unique.append(r)
    return unique


def _try_bbc_sport(date_str):
    url = "https://www.bbc.co.uk/sport/horse-racing"
    scraper = make_scraper()
    try:
        resp = scraper.get(url, timeout=20)
        if resp.status_code != 200:
            return []
    except Exception:
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    races = []
    seen = set()

    for link in soup.find_all("a", href=re.compile(r"horse-racing", re.I)):
        course = link.get_text(strip=True)
        href = link.get("href", "")
        if not course or course in seen or len(course) > 50:
            continue
        seen.add(course)
        race_url = ("https://www.bbc.co.uk" + href if href.startswith("/") else href)
        races.append({
            "date": date_str,
            "course": course,
            "race_time": "",
            "race_name": course + " meeting",
            "distance": "",
            "going": "",
            "race_class": "",
            "race_url": race_url,
            "source": "BBC Sport",
        })
    return races

# ── MODULE 2: RUNNERS & HORSE FORM ────────────────────────────

def _parse_runner_row(row):
    try:
        horse_link = row.find("a", href=re.compile(r"/profile/horse/|/horses?/\d+", re.I))
        if not horse_link:
            return None
        horse_name = horse_link.get_text(strip=True)
        if not horse_name:
            return None
        href = horse_link.get("href", "")
        horse_url = ("https://www.racingpost.com" + href if href.startswith("/") else href)
        jockey_el = row.find(class_=re.compile(r"jockey", re.I))
        trainer_el = row.find(class_=re.compile(r"trainer", re.I))
        draw_el = row.find(class_=re.compile(r"draw|stall", re.I))
        weight_el = row.find(class_=re.compile(r"weight|wgt", re.I))
        equip_el = row.find(class_=re.compile(r"headgear|equipment", re.I))
        or_el = row.find(class_=re.compile(r"official.rating|rating", re.I))
        return {
            "horse_name": horse_name,
            "horse_url": horse_url,
            "jockey": jockey_el.get_text(strip=True) if jockey_el else "",
            "trainer": trainer_el.get_text(strip=True) if trainer_el else "",
            "draw": draw_el.get_text(strip=True) if draw_el else "",
            "weight": weight_el.get_text(strip=True) if weight_el else "",
            "equipment": equip_el.get_text(strip=True) if equip_el else "",
            "official_rating": or_el.get_text(strip=True) if or_el else "",
        }
    except Exception:
        return None


def get_runners_in_race(race_url):
    if not race_url:
        return []
    scraper = make_scraper()
    polite_sleep()
    try:
        resp = scraper.get(race_url, timeout=20)
        if resp.status_code != 200:
            return []
        soup = BeautifulSoup(resp.text, "html.parser")
    except Exception:
        return []

    runners = []

    # Strategy 1: table rows with runner class
    for row in soup.find_all("tr", class_=re.compile(r"runner|horse|entry", re.I)):
        r = _parse_runner_row(row)
        if r:
            runners.append(r)
    if runners:
        return runners

    # Strategy 2: any horse profile links on the page
    for link in soup.find_all("a", href=re.compile(r"/profile/horse/|/horses?/\d+", re.I)):
        horse_name = link.get_text(strip=True)
        if not horse_name or len(horse_name) < 2:
            continue
        href = link.get("href", "")
        horse_url = ("https://www.racingpost.com" + href if href.startswith("/") else href)
        parent = link.find_parent("tr") or link.find_parent("li") or link.find_parent("div")
        jockey = trainer = draw = weight = ""
        if parent:
            j = parent.find(class_=re.compile(r"jockey", re.I))
            t = parent.find(class_=re.compile(r"trainer", re.I))
            d = parent.find(class_=re.compile(r"draw|stall", re.I))
            w = parent.find(class_=re.compile(r"weight|wgt", re.I))
            jockey = j.get_text(strip=True) if j else ""
            trainer = t.get_text(strip=True) if t else ""
            draw = d.get_text(strip=True) if d else ""
            weight = w.get_text(strip=True) if w else ""
        runners.append({
            "horse_name": horse_name,
            "horse_url": horse_url,
            "jockey": jockey,
            "trainer": trainer,
            "draw": draw,
            "weight": weight,
            "equipment": "",
            "official_rating": "",
        })

    seen, unique = set(), []
    for r in runners:
        if r["horse_name"] not in seen:
            seen.add(r["horse_name"])
            unique.append(r)
    return unique


def get_horse_form(horse_name, horse_url):
    if not horse_url:
        return []
    scraper = make_scraper()
    polite_sleep()
    try:
        resp = scraper.get(horse_url, timeout=20)
        soup = BeautifulSoup(resp.text, "html.parser")
    except Exception:
        return []

    past_races = []
    for row in soup.find_all("tr", class_=re.compile(r"form|past|result", re.I))[:PAST_RACES_TO_COLLECT]:
        try:
            cells = row.find_all("td")
            if len(cells) < 5:
                continue
            past_races.append({
                "horse_name": horse_name,
                "race_date": cells[0].get_text(strip=True) if len(cells) > 0 else "",
                "course": cells[1].get_text(strip=True) if len(cells) > 1 else "",
                "distance": cells[2].get_text(strip=True) if len(cells) > 2 else "",
                "going": cells[3].get_text(strip=True) if len(cells) > 3 else "",
                "race_class": cells[4].get_text(strip=True) if len(cells) > 4 else "",
                "finishing_position": cells[5].get_text(strip=True) if len(cells) > 5 else "",
                "beaten_lengths": cells[6].get_text(strip=True) if len(cells) > 6 else "",
                "weight_carried": cells[7].get_text(strip=True) if len(cells) > 7 else "",
                "jockey": cells[8].get_text(strip=True) if len(cells) > 8 else "",
                "sp_odds": cells[9].get_text(strip=True) if len(cells) > 9 else "",
                "race_comment": cells[10].get_text(strip=True) if len(cells) > 10 else "",
                "field_size": cells[11].get_text(strip=True) if len(cells) > 11 else "",
                "prize_money": cells[12].get_text(strip=True) if len(cells) > 12 else "",
            })
        except Exception:
            continue
    return past_races


def collect_all_horse_form(races):
    print("\n[2/6] Collecting horse past performance...")
    all_form = []

    for race in races:
        course = race.get("course", "")
        race_time = race.get("race_time", "")
        race_url = race.get("race_url", "")
        if not race_url:
            continue
        runners = get_runners_in_race(race_url)
        print("  " + course + " " + race_time + ": " + str(len(runners)) + " runners found")
        for runner in runners:
            form = get_horse_form(runner["horse_name"], runner["horse_url"])
            for record in form:
                record["today_course"] = course
                record["today_race_time"] = race_time
                record["today_race_name"] = race.get("race_name", "")
                record["today_jockey"] = runner.get("jockey", "")
                record["today_trainer"] = runner.get("trainer", "")
                record["today_draw"] = runner.get("draw", "")
                record["today_weight"] = runner.get("weight", "")
                record["today_equipment"] = runner.get("equipment", "")
                record["today_or"] = runner.get("official_rating", "")
            all_form.extend(form)

    df = pd.DataFrame(all_form)
    if not df.empty and "race_date" in df.columns:
        df["race_date_parsed"] = pd.to_datetime(df["race_date"], errors="coerce", dayfirst=True)
        df = df.sort_values(["horse_name", "race_date_parsed"])
        df["days_since_last_run"] = df.groupby("horse_name")["race_date_parsed"].diff().dt.days
        df["position_numeric"] = pd.to_numeric(
            df["finishing_position"].str.extract(r"(\d+)")[0], errors="coerce"
        )
        df["won"] = (df["position_numeric"] == 1).astype(int)
        df["placed"] = (df["position_numeric"] <= 3).astype(int)

    print("  Collected " + str(len(df)) + " past race records")
    return df

# ── MODULE 3: JOCKEY STATS ────────────────────────────────────

def calculate_jockey_stats(df):
    print("\n[3/6] Calculating jockey statistics...")
    if df.empty or "jockey" not in df.columns:
        print("  No form data — skipping")
        return pd.DataFrame()
    stats = df.groupby("jockey").agg(
        total_rides=("won", "count"),
        total_wins=("won", "sum"),
        total_placed=("placed", "sum"),
    ).reset_index()
    stats["win_pct"] = (stats["total_wins"] / stats["total_rides"] * 100).round(1)
    stats["place_pct"] = (stats["total_placed"] / stats["total_rides"] * 100).round(1)
    print("  Stats for " + str(len(stats)) + " jockeys")
    return stats

# ── MODULE 4: TRAINER STATS ───────────────────────────────────

def calculate_trainer_stats(df):
    print("\n[4/6] Calculating trainer statistics...")
    if df.empty:
        print("  No form data — skipping")
        return pd.DataFrame()
    col = "today_trainer" if "today_trainer" in df.columns else "trainer"
    if col not in df.columns:
        print("  No trainer column — skipping")
        return pd.DataFrame()
    df2 = df.rename(columns={col: "trainer_name"}).copy()
    df2 = df2[df2["trainer_name"].str.strip() != ""]
    stats = df2.groupby("trainer_name").agg(
        total_runners=("won", "count"),
        total_wins=("won", "sum"),
        total_placed=("placed", "sum"),
    ).reset_index()
    stats["win_pct"] = (stats["total_wins"] / stats["total_runners"] * 100).round(1)
    stats["place_pct"] = (stats["total_placed"] / stats["total_runners"] * 100).round(1)
    if "days_since_last_run" in df2.columns:
        layoff = df2[df2["days_since_last_run"] >= 60].groupby("trainer_name").agg(
            layoff_runners=("won", "count"),
            layoff_wins=("won", "sum"),
        ).reset_index()
        layoff["win_pct_after_layoff"] = (layoff["layoff_wins"] / layoff["layoff_runners"] * 100).round(1)
        stats = stats.merge(layoff, on="trainer_name", how="left")
    print("  Stats for " + str(len(stats)) + " trainers")
    return stats

# ── MODULE 5: GOING + WEATHER ─────────────────────────────────

def get_going_data(date_str, courses):
    print("\n[5/6] Fetching going conditions & weather...")
    scraper = make_scraper()
    page_html = ""
    try:
        resp = scraper.get("https://www.sportinglife.com/racing/results/" + date_str, timeout=20)
        page_html = resp.text
    except Exception:
        pass

    soup = BeautifulSoup(page_html, "html.parser")
    records = []
    for course in courses:
        going = ""
        if page_html:
            for section in soup.find_all(["section", "div"]):
                heading = section.find(["h2", "h3", "h4"])
                if heading and course.lower() in heading.get_text(strip=True).lower():
                    m = section.find(string=re.compile(r"going|ground", re.I))
                    if m:
                        going = m.strip()
                    break
        records.append({"date": date_str, "course": course, "official_going": going, "goingstick_reading": ""})
        polite_sleep()
    df = pd.DataFrame(records)
    print("  Going data for " + str(len(df)) + " courses")
    return df


def get_weather_data(date_str, courses):
    print("       Fetching weather from Open-Meteo (free)...")
    records = []
    for course in courses:
        coords = get_course_coords(course)
        if not coords:
            print("    No coordinates for '" + course + "' — skipping")
            records.append({"date": date_str, "course": course, "coords_found": False})
            continue
        lat, lon = coords
        url = (
            "https://api.open-meteo.com/v1/forecast"
            "?latitude=" + str(lat) + "&longitude=" + str(lon) +
            "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,"
            "wind_speed_10m_max,wind_direction_10m_dominant,weathercode"
            "&hourly=relative_humidity_2m"
            "&start_date=" + date_str + "&end_date=" + date_str +
            "&timezone=Europe%2FLondon"
        )
        try:
            resp = requests.get(url, timeout=15)
            data = resp.json()
            daily = data.get("daily", {})
            hourly = data.get("hourly", {})
            hum = hourly.get("relative_humidity_2m", [])
            avg_hum = round(sum(hum) / len(hum), 1) if hum else None
            records.append({
                "date": date_str,
                "course": course,
                "latitude": lat,
                "longitude": lon,
                "temperature_max_c": daily.get("temperature_2m_max", [None])[0],
                "temperature_min_c": daily.get("temperature_2m_min", [None])[0],
                "rainfall_mm": daily.get("precipitation_sum", [None])[0],
                "wind_speed_max_kmh": daily.get("wind_speed_10m_max", [None])[0],
                "wind_direction_deg": daily.get("wind_direction_10m_dominant", [None])[0],
                "avg_humidity_pct": avg_hum,
                "weather_code": daily.get("weathercode", [None])[0],
                "coords_found": True,
            })
        except Exception as e:
            print("    Weather error for " + course + ": " + str(e))
            records.append({"date": date_str, "course": course, "coords_found": False})
        time.sleep(0.5)

    df = pd.DataFrame(records)
    df = _add_7day_rainfall(df, date_str)
    return df


def _add_7day_rainfall(weather_df, date_str):
    week_ago = (datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")
    yesterday = (datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    rainfall_7day = []
    for _, row in weather_df.iterrows():
        if not row.get("coords_found"):
            rainfall_7day.append(None)
            continue
        lat = row.get("latitude")
        lon = row.get("longitude")
        if not lat or not lon:
            rainfall_7day.append(None)
            continue
        url = (
            "https://api.open-meteo.com/v1/forecast"
            "?latitude=" + str(lat) + "&longitude=" + str(lon) +
            "&daily=precipitation_sum"
            "&start_date=" + week_ago + "&end_date=" + yesterday +
            "&timezone=Europe%2FLondon"
        )
        try:
            resp = requests.get(url, timeout=10)
            data = resp.json()
            daily = data.get("daily", {}).get("precipitation_sum", [])
            total = round(sum(v for v in daily if v is not None), 1)
            rainfall_7day.append(total)
        except Exception:
            rainfall_7day.append(None)
        time.sleep(0.5)
    weather_df["rainfall_last_7days_mm"] = rainfall_7day
    return weather_df

# ── MODULE 6: BETFAIR ─────────────────────────────────────────

def get_betfair_odds(date_str):
    print("\n[6/6] Fetching Betfair odds...")
    if not BETFAIR_USERNAME:
        print("  Betfair credentials not set — skipping.")
        print("  To enable: fill in BETFAIR_USERNAME / PASSWORD / APP_KEY at top of file.")
        return pd.DataFrame()
    try:
        import betfairlightweight
    except ImportError:
        print("  Run: python -m pip install betfairlightweight")
        return pd.DataFrame()
    try:
        trading = betfairlightweight.APIClient(
            username=BETFAIR_USERNAME, password=BETFAIR_PASSWORD, app_key=BETFAIR_APP_KEY
        )
        trading.login()
        mf = betfairlightweight.filters.market_filter(
            event_type_ids=["7"],
            market_countries=["GB", "IE"],
            market_start_time={"from": date_str + "T00:00:00Z", "to": date_str + "T23:59:59Z"},
            market_type_codes=["WIN"],
        )
        markets = trading.betting.list_market_catalogue(
            filter=mf,
            market_projection=["MARKET_START_TIME", "RUNNER_DESCRIPTION", "EVENT"],
            max_results=200,
        )
        records = []
        for market in markets:
            books = trading.betting.list_market_book(
                market_ids=[market.market_id],
                price_projection=betfairlightweight.filters.price_projection(price_data=["EX_BEST_OFFERS"]),
            )
            if not books:
                continue
            book = books[0]
            for runner in book.runners:
                name = next((r.runner_name for r in market.runners if r.selection_id == runner.selection_id), "")
                back = runner.ex.available_to_back[0].price if runner.ex and runner.ex.available_to_back else None
                lay = runner.ex.available_to_lay[0].price if runner.ex and runner.ex.available_to_lay else None
                records.append({
                    "date": date_str,
                    "course": getattr(market.event, "venue", ""),
                    "race_time": market.market_start_time.strftime("%H:%M"),
                    "horse_name": name,
                    "betfair_back_price": back,
                    "betfair_lay_price": lay,
                    "total_matched_horse": runner.total_matched,
                    "total_market_matched": book.total_matched,
                    "last_price_traded": runner.last_price_traded,
                })
        trading.logout()
        df = pd.DataFrame(records)
        print("  Got Betfair odds for " + str(len(df)) + " runners")
        return df
    except Exception as e:
        print("  Betfair error: " + str(e))
        return pd.DataFrame()

# ── MASTER DATASET ────────────────────────────────────────────

def build_master(race_cards, horse_form, jockey_stats, trainer_stats, going_data, weather_data, betfair_odds):
    print("\nBuilding master dataset...")
    if horse_form.empty:
        print("  No form data — cannot build master dataset")
        return pd.DataFrame()
    master = horse_form.copy()
    if not jockey_stats.empty and "jockey" in master.columns:
        master = master.merge(
            jockey_stats[["jockey", "win_pct", "place_pct"]].rename(
                columns={"win_pct": "jockey_win_pct", "place_pct": "jockey_place_pct"}
            ), on="jockey", how="left",
        )
    if not trainer_stats.empty and "today_trainer" in master.columns:
        master = master.merge(
            trainer_stats.rename(columns={"trainer_name": "today_trainer"}),
            on="today_trainer", how="left",
        )
    if not going_data.empty:
        master = master.merge(
            going_data[["course", "official_going"]],
            left_on="today_course", right_on="course", how="left",
        )
    if not weather_data.empty:
        wx_cols = [c for c in ["course", "temperature_max_c", "temperature_min_c",
                   "rainfall_mm", "wind_speed_max_kmh", "avg_humidity_pct",
                   "rainfall_last_7days_mm"] if c in weather_data.columns]
        master = master.merge(weather_data[wx_cols], left_on="today_course", right_on="course", how="left")
    if not betfair_odds.empty:
        master = master.merge(
            betfair_odds[["horse_name", "betfair_back_price", "total_matched_horse", "last_price_traded"]],
            on="horse_name", how="left",
        )
    print("  Master: " + str(len(master)) + " rows x " + str(len(master.columns)) + " columns")
    return master

# ── MAIN ──────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="UK/Ireland Horse Racing Data Collector")
    parser.add_argument("--date", default="today", help="Date: 'today' or YYYY-MM-DD")
    args = parser.parse_args()
    date_str = datetime.now().strftime("%Y-%m-%d") if args.date.lower() == "today" else args.date

    print("=" * 60)
    print("  UK / IRELAND RACING DATA COLLECTOR  v2")
    print("  Date: " + date_str)
    print("=" * 60)

    make_output_dir()

    races = get_race_cards(date_str)
    if not races:
        return
    save_csv(pd.DataFrame(races), "race_cards_" + date_str + ".csv")

    horse_form = collect_all_horse_form(races)
    if not horse_form.empty:
        save_csv(horse_form, "horse_form_" + date_str + ".csv")

    jockey_stats = calculate_jockey_stats(horse_form)
    if not jockey_stats.empty:
        save_csv(jockey_stats, "jockey_stats_" + date_str + ".csv")

    trainer_stats = calculate_trainer_stats(horse_form)
    if not trainer_stats.empty:
        save_csv(trainer_stats, "trainer_stats_" + date_str + ".csv")

    courses = list({r["course"] for r in races if r.get("course")})
    going_data = get_going_data(date_str, courses)
    weather_data = get_weather_data(date_str, courses)
    save_csv(going_data, "going_" + date_str + ".csv")
    save_csv(weather_data, "weather_" + date_str + ".csv")

    betfair_odds = get_betfair_odds(date_str)
    if not betfair_odds.empty:
        save_csv(betfair_odds, "betfair_odds_" + date_str + ".csv")

    master = build_master(races, horse_form, jockey_stats, trainer_stats, going_data, weather_data, betfair_odds)
    if not master.empty:
        save_csv(master, "MASTER_" + date_str + ".csv")

    print("\n" + "=" * 60)
    print("  DONE")
    print("  Races:  " + str(len(races)))
    print("  Horses: " + str(horse_form["horse_name"].nunique() if not horse_form.empty else 0))
    print("  Files:  " + os.path.abspath(OUTPUT_DIR))
    print("=" * 60)


if __name__ == "__main__":
    main()