"""
UK / IRELAND HORSE RACE LOOKUP TOOL
USAGE:  python race_lookup.py
SETUP:  python -m pip install requests beautifulsoup4 cloudscraper pandas lxml
"""

import requests
import cloudscraper
import pandas as pd
import time
import re
from datetime import datetime, timedelta
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    "Referer": "https://www.google.com/",
    "DNT": "1",
}

COORDS = {
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

WEATHER_CODES = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Icy fog", 51: "Light drizzle", 53: "Drizzle",
    55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Rain showers",
    81: "Showers", 82: "Heavy showers", 95: "Thunderstorm", 99: "Thunderstorm with hail",
}

def make_scraper():
    s = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "mobile": False}
    )
    s.headers.update(HEADERS)
    return s

def pause():
    time.sleep(2)

def divider(char="=", width=70):
    print(char * width)

def subheader(text):
    print("\n  --- " + text + " ---")

def get_coords(course):
    n = course.lower().strip()
    if n in COORDS:
        return COORDS[n]
    for key, val in COORDS.items():
        if key in n or n in key:
            return val
    return None

# ── USER INPUT ────────────────────────────────────────────────────────────────

def get_user_input():
    print("")
    divider()
    print("  HORSE RACE LOOKUP TOOL")
    divider()
    print("")
    print("  Enter the race details below.")
    print("")

    while True:
        course = input("  Course name (e.g. Cheltenham): ").strip()
        if course:
            break
        print("  Please enter a course name.")

    while True:
        date_input = input("  Date (YYYY-MM-DD or 'today'): ").strip()
        if date_input.lower() == "today":
            date_str = datetime.now().strftime("%Y-%m-%d")
            break
        try:
            datetime.strptime(date_input, "%Y-%m-%d")
            date_str = date_input
            break
        except ValueError:
            print("  Invalid date. Use YYYY-MM-DD e.g. 2026-03-13")

    while True:
        time_input = input("  Race time (HH:MM e.g. 14:30): ").strip()
        if re.match(r"^\d{1,2}:\d{2}$", time_input):
            race_time = time_input.zfill(5)
            break
        print("  Invalid time. Use HH:MM e.g. 14:30")

    print("")
    print("  Looking up: " + course + "  " + date_str + "  " + race_time)
    print("")
    return course, date_str, race_time

# ── FIND RACE ─────────────────────────────────────────────────────────────────

def find_race(course, date_str, race_time):
    print("  [1/5] Finding race on Racing Post...")
    scraper = make_scraper()

    dt = datetime.strptime(date_str, "%Y-%m-%d")
    rp_date = dt.strftime("%d-%m-%Y")
    course_slug = course.lower().replace(" ", "-")
    url = "https://www.racingpost.com/results/" + rp_date + "/" + course_slug

    race_url = None
    race_name = None

    try:
        resp = scraper.get(url, timeout=20)
        soup = BeautifulSoup(resp.text, "html.parser")
        time_compact = race_time.replace(":", "")
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            if time_compact in href:
                race_url = "https://www.racingpost.com" + href if href.startswith("/") else href
                race_name = link.get_text(strip=True)
                break
    except Exception as e:
        print("  Could not reach Racing Post: " + str(e))

    if race_url:
        print("  Found: " + (race_name or race_url))
    else:
        print("  Could not find race automatically on Racing Post.")
        print("  Will try to get runners from the course results page directly.")
        race_url = "https://www.racingpost.com/results/" + rp_date + "/" + course_slug

    return race_url, race_name

# ── GET RUNNERS ───────────────────────────────────────────────────────────────

def get_runners(race_url, course, date_str, race_time):
    print("  [2/5] Getting runners...")
    scraper = make_scraper()
    runners = []
    page_going = ""
    page_distance = ""
    page_race_class = ""

    if race_url:
        pause()
        try:
            resp = scraper.get(race_url, timeout=20)
            soup = BeautifulSoup(resp.text, "html.parser")

            for el in soup.find_all(string=re.compile(r"going|ground", re.I)):
                t = el.strip()
                if len(t) < 60:
                    page_going = t
                    break

            for el in soup.find_all(string=re.compile(r"\df|\dm", re.I)):
                page_distance = el.strip()
                break

            for el in soup.find_all(string=re.compile(r"class \d|grade \d|listed|group", re.I)):
                page_race_class = el.strip()
                break

            for link in soup.find_all("a", href=re.compile(r"/profile/horse/|/horses?/\d+", re.I)):
                name = link.get_text(strip=True)
                if not name or len(name) < 2 or name.lower() in ["form", "horse", "name", "more"]:
                    continue
                href = link.get("href", "")
                horse_url = "https://www.racingpost.com" + href if href.startswith("/") else href

                parent = (link.find_parent("tr") or
                          link.find_parent("li") or
                          link.find_parent("div"))
                jockey = trainer = draw = weight = equipment = official_rating = ""
                if parent:
                    j = parent.find(class_=re.compile(r"jockey", re.I))
                    t = parent.find(class_=re.compile(r"trainer", re.I))
                    d = parent.find(class_=re.compile(r"draw|stall", re.I))
                    w = parent.find(class_=re.compile(r"weight|wgt", re.I))
                    eq = parent.find(class_=re.compile(r"headgear|equipment", re.I))
                    or_ = parent.find(class_=re.compile(r"rating", re.I))
                    if j:  jockey = j.get_text(strip=True)
                    if t:  trainer = t.get_text(strip=True)
                    if d:  draw = d.get_text(strip=True)
                    if w:  weight = w.get_text(strip=True)
                    if eq: equipment = eq.get_text(strip=True)
                    if or_: official_rating = or_.get_text(strip=True)

                runners.append({
                    "name": name,
                    "url": horse_url,
                    "jockey": jockey,
                    "trainer": trainer,
                    "draw": draw,
                    "weight": weight,
                    "equipment": equipment,
                    "official_rating": official_rating,
                })

        except Exception as e:
            print("  Warning: " + str(e))

    seen, unique = set(), []
    for r in runners:
        if r["name"] not in seen and len(r["name"]) > 1:
            seen.add(r["name"])
            unique.append(r)

    if unique:
        print("  Found " + str(len(unique)) + " runners")
    else:
        print("")
        print("  Racing Post blocked the request or no runners found.")
        print("  You can enter the horses manually instead.")
        print("")
        unique = manual_runner_entry()

    return unique, page_going, page_distance, page_race_class


def manual_runner_entry():
    print("  Enter horse names one by one. Press Enter with no name when done.")
    runners = []
    while True:
        name = input("  Horse name (or Enter to finish): ").strip()
        if not name:
            break
        jockey = input("  Jockey (optional, Enter to skip): ").strip()
        trainer = input("  Trainer (optional, Enter to skip): ").strip()
        runners.append({
            "name": name, "url": "",
            "jockey": jockey, "trainer": trainer,
            "draw": "", "weight": "", "equipment": "", "official_rating": "",
        })
    return runners

# ── HORSE FORM ────────────────────────────────────────────────────────────────

def get_horse_form(horse):
    if not horse["url"]:
        return []
    scraper = make_scraper()
    pause()
    try:
        resp = scraper.get(horse["url"], timeout=20)
        soup = BeautifulSoup(resp.text, "html.parser")
    except Exception:
        return []

    past_races = []
    for row in soup.find_all("tr", class_=re.compile(r"form|past|result|race", re.I))[:10]:
        try:
            cells = row.find_all("td")
            if len(cells) < 5:
                continue
            past_races.append({
                "date":    cells[0].get_text(strip=True) if len(cells) > 0 else "",
                "course":  cells[1].get_text(strip=True) if len(cells) > 1 else "",
                "dist":    cells[2].get_text(strip=True) if len(cells) > 2 else "",
                "going":   cells[3].get_text(strip=True) if len(cells) > 3 else "",
                "class":   cells[4].get_text(strip=True) if len(cells) > 4 else "",
                "pos":     cells[5].get_text(strip=True) if len(cells) > 5 else "",
                "beaten":  cells[6].get_text(strip=True) if len(cells) > 6 else "",
                "weight":  cells[7].get_text(strip=True) if len(cells) > 7 else "",
                "jockey":  cells[8].get_text(strip=True) if len(cells) > 8 else "",
                "odds":    cells[9].get_text(strip=True) if len(cells) > 9 else "",
                "comment": cells[10].get_text(strip=True) if len(cells) > 10 else "",
                "runners": cells[11].get_text(strip=True) if len(cells) > 11 else "",
                "prize":   cells[12].get_text(strip=True) if len(cells) > 12 else "",
            })
        except Exception:
            continue
    return past_races


def compute_stats(past_races):
    if not past_races:
        return {}
    positions = []
    for r in past_races:
        try:
            pos = int(re.search(r"\d+", r["pos"]).group())
            positions.append(pos)
        except Exception:
            pass
    if not positions:
        return {}

    wins   = sum(1 for p in positions if p == 1)
    places = sum(1 for p in positions if p <= 3)
    runs   = len(positions)

    days_since = None
    try:
        last_date = datetime.strptime(past_races[0]["date"], "%d %b %Y")
        days_since = (datetime.now() - last_date).days
    except Exception:
        pass

    going_wins = {}
    for r in past_races:
        try:
            pos = int(re.search(r"\d+", r["pos"]).group())
            g = r["going"].strip()
            if g:
                if g not in going_wins:
                    going_wins[g] = {"wins": 0, "runs": 0}
                going_wins[g]["runs"] += 1
                if pos == 1:
                    going_wins[g]["wins"] += 1
        except Exception:
            pass

    best_going = ""
    best_pct = 0
    for g, s in going_wins.items():
        if s["runs"] >= 2:
            pct = s["wins"] / s["runs"] * 100
            if pct > best_pct:
                best_pct = pct
                best_going = g

    return {
        "runs": runs,
        "wins": wins,
        "places": places,
        "win_pct": round(wins / runs * 100, 1) if runs > 0 else 0,
        "place_pct": round(places / runs * 100, 1) if runs > 0 else 0,
        "days_since_last_run": days_since,
        "best_going": best_going,
        "avg_position": round(sum(positions) / len(positions), 1),
        "last_3_positions": [r["pos"] for r in past_races[:3]],
    }

# ── WEATHER ───────────────────────────────────────────────────────────────────

def get_weather(course, date_str):
    print("  [4/5] Fetching weather from Open-Meteo...")
    coords = get_coords(course)
    if not coords:
        print("  No coordinates for " + course)
        return {}

    lat, lon = coords
    week_ago = (datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")
    yesterday = (datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    weather = {}

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
        weather["temp_max_c"] = daily.get("temperature_2m_max", [None])[0]
        weather["temp_min_c"] = daily.get("temperature_2m_min", [None])[0]
        weather["rainfall_mm"] = daily.get("precipitation_sum", [None])[0]
        weather["wind_speed_kmh"] = daily.get("wind_speed_10m_max", [None])[0]
        weather["wind_direction"] = daily.get("wind_direction_10m_dominant", [None])[0]
        weather["avg_humidity_pct"] = round(sum(hum) / len(hum), 1) if hum else None
        code = daily.get("weathercode", [None])[0]
        weather["conditions"] = WEATHER_CODES.get(code, "Unknown")
    except Exception as e:
        print("  Weather error: " + str(e))

    try:
        url2 = (
            "https://api.open-meteo.com/v1/forecast"
            "?latitude=" + str(lat) + "&longitude=" + str(lon) +
            "&daily=precipitation_sum"
            "&start_date=" + week_ago + "&end_date=" + yesterday +
            "&timezone=Europe%2FLondon"
        )
        resp2 = requests.get(url2, timeout=10)
        data2 = resp2.json()
        daily2 = data2.get("daily", {}).get("precipitation_sum", [])
        weather["rainfall_last_7days_mm"] = round(sum(v for v in daily2 if v is not None), 1)
    except Exception:
        weather["rainfall_last_7days_mm"] = None

    return weather

# ── PRINT RESULTS ─────────────────────────────────────────────────────────────

def print_results(course, date_str, race_time, race_name,
                  runners, all_form, weather,
                  page_going, page_distance, page_race_class):

    print("")
    divider()
    print("  RACE REPORT")
    divider()
    print("")
    print("  Course    : " + course.title())
    print("  Date      : " + date_str)
    print("  Time      : " + race_time)
    if race_name:
        print("  Race      : " + race_name)
    if page_distance:
        print("  Distance  : " + page_distance)
    if page_race_class:
        print("  Class     : " + page_race_class)
    if page_going:
        print("  Going     : " + page_going)

    if weather:
        print("")
        subheader("RACE DAY WEATHER  (" + course.title() + ")")
        print("")
        if weather.get("conditions"):
            print("  Conditions          : " + str(weather["conditions"]))
        if weather.get("temp_max_c") is not None:
            print("  Temperature         : " + str(weather["temp_min_c"]) + "C  to  " + str(weather["temp_max_c"]) + "C")
        if weather.get("rainfall_mm") is not None:
            print("  Rainfall today      : " + str(weather["rainfall_mm"]) + " mm")
        if weather.get("rainfall_last_7days_mm") is not None:
            print("  Rainfall last 7days : " + str(weather["rainfall_last_7days_mm"]) + " mm")
        if weather.get("wind_speed_kmh") is not None:
            print("  Wind speed          : " + str(weather["wind_speed_kmh"]) + " km/h")
        if weather.get("avg_humidity_pct") is not None:
            print("  Avg humidity        : " + str(weather["avg_humidity_pct"]) + "%")

    for runner in runners:
        name = runner["name"]
        form = all_form.get(name, [])
        stats = compute_stats(form)

        print("")
        divider("-", 70)
        print("  HORSE: " + name.upper())
        divider("-", 70)

        if runner.get("jockey"):          print("  Jockey          : " + runner["jockey"])
        if runner.get("trainer"):         print("  Trainer         : " + runner["trainer"])
        if runner.get("draw"):            print("  Draw / Stall    : " + runner["draw"])
        if runner.get("weight"):          print("  Weight          : " + runner["weight"])
        if runner.get("equipment"):       print("  Equipment       : " + runner["equipment"])
        if runner.get("official_rating"): print("  Official Rating : " + runner["official_rating"])

        if stats:
            print("")
            print("  CAREER FORM SUMMARY")
            print("  Runs            : " + str(stats["runs"]))
            print("  Wins            : " + str(stats["wins"]) + "  (" + str(stats["win_pct"]) + "%)")
            print("  Placed (top 3)  : " + str(stats["places"]) + "  (" + str(stats["place_pct"]) + "%)")
            print("  Avg finish pos  : " + str(stats["avg_position"]))
            if stats.get("days_since_last_run") is not None:
                print("  Days since last : " + str(stats["days_since_last_run"]) + " days")
            if stats.get("best_going"):
                print("  Best going      : " + stats["best_going"])
            if stats.get("last_3_positions"):
                print("  Last 3 results  : " + "  |  ".join(stats["last_3_positions"]))

        if form:
            print("")
            print("  LAST " + str(min(5, len(form))) + " RACES")
            print("  " + "-" * 66)
            print("  {:<12} {:<18} {:<6} {:<10} {:<5} {:<8} {}".format(
                "Date", "Course", "Dist", "Going", "Pos", "Odds", "Comment"
            ))
            print("  " + "-" * 66)
            for r in form[:5]:
                comment = r.get("comment", "")[:22]
                print("  {:<12} {:<18} {:<6} {:<10} {:<5} {:<8} {}".format(
                    r.get("date", "")[:11],
                    r.get("course", "")[:17],
                    r.get("dist", "")[:5],
                    r.get("going", "")[:9],
                    r.get("pos", "")[:4],
                    r.get("odds", "")[:7],
                    comment,
                ))
        else:
            print("")
            print("  No past race data retrieved.")
            print("  Racing Post may have blocked this request.")
            print("  Wait a few minutes and try again.")

    print("")
    divider()
    print("  FIELD SUMMARY  (" + str(len(runners)) + " runners)")
    divider()

    ranked = [(r["name"], compute_stats(all_form.get(r["name"], []))) for r in runners]
    ranked = [(n, s) for n, s in ranked if s]
    ranked.sort(key=lambda x: x[1].get("win_pct", 0), reverse=True)

    if ranked:
        print("")
        print("  Ranked by career win %:")
        print("")
        print("  {:<25} {:>6} {:>6} {:>8} {:>10}".format("Horse", "Runs", "Wins", "Win%", "Days off"))
        print("  " + "-" * 60)
        for name, s in ranked:
            days = str(s.get("days_since_last_run", "?"))
            print("  {:<25} {:>6} {:>6} {:>7}% {:>10}".format(
                name[:24], s.get("runs", ""), s.get("wins", ""),
                s.get("win_pct", ""), days,
            ))

    print("")
    divider()
    print("  Done. Good luck!")
    divider()
    print("")

# ── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    course, date_str, race_time = get_user_input()
    race_url, race_name = find_race(course, date_str, race_time)
    runners, page_going, page_distance, page_race_class = get_runners(
        race_url, course, date_str, race_time
    )

    if not runners:
        print("  No runners found. Exiting.")
        return

    print("  [3/5] Fetching past form for each horse...")
    all_form = {}
    for i, runner in enumerate(runners):
        print("    " + str(i + 1) + "/" + str(len(runners)) + "  " + runner["name"] + "...")
        all_form[runner["name"]] = get_horse_form(runner)

    weather = get_weather(course, date_str)
    print("  [5/5] Building report...")

    print_results(
        course, date_str, race_time, race_name,
        runners, all_form, weather,
        page_going, page_distance, page_race_class
    )

if __name__ == "__main__":
    main()
