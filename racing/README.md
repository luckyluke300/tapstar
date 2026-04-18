# UK / Ireland Horse Racing Data Collector
## Setup & Usage Guide

---

## What This Does

Runs before every race day and automatically collects:

| Data | Source | Cost |
|------|--------|------|
| Race cards (all races, all runners) | Sporting Life | Free |
| Horse past performance (last 10 races each) | Racing Post | Free |
| Jockey win % (overall, by track, by going) | Calculated from form | Free |
| Trainer win % (overall, layoff record) | Calculated from form | Free |
| Official going conditions | Sporting Life / BHA | Free |
| Weather (temp, rain, wind, humidity) | Open-Meteo API | Free |
| Last 7 days rainfall (for going prediction) | Open-Meteo API | Free |
| Betfair exchange odds + volume | Betfair API | Free* |

*Free with a funded Betfair account (even £10 deposit is enough)

Everything saves as CSV files in a `data/` folder.

---

## Step 1: Install Python

If you don't have Python installed:
- Go to https://python.org/downloads
- Download Python 3.10 or newer
- During install, **tick "Add Python to PATH"** — important!

---

## Step 2: Install the Required Libraries

Open a terminal (Windows: press Win+R, type `cmd`, press Enter):

```
pip install requests beautifulsoup4 cloudscraper pandas betfairlightweight lxml
```

Or using the requirements file:
```
pip install -r requirements.txt
```

---

## Step 3: Set Up Betfair (Optional but Recommended)

Betfair odds data is extremely valuable for modelling. It's free with an account.

1. Sign up at https://www.betfair.com/exchange
2. Make a small deposit (even £10 is fine — you need a funded account for API access)
3. Go to https://developer.betfair.com and create an API application
4. Get your App Key from the API dashboard
5. Open `racing_collector.py` in any text editor
6. Find these lines near the top and fill them in:

```python
BETFAIR_USERNAME = "your@email.com"
BETFAIR_PASSWORD = "yourpassword"
BETFAIR_APP_KEY  = "yourAppKey"
```

---

## Step 4: Run the Script

**Collect today's data:**
```
python racing_collector.py --date today
```

**Collect data for a specific date:**
```
python racing_collector.py --date 2025-03-15
```

**Collect yesterday's data (for testing):**
```
python racing_collector.py --date 2025-03-14
```

---

## Step 5: Find Your Data

After running, all files appear in a `data/` folder in the same directory as the script:

```
data/
  race_cards_2025-03-15.csv       ← All races and basic info
  horse_form_2025-03-15.csv       ← Every horse's past 10 races
  jockey_stats_2025-03-15.csv     ← Jockey win percentages
  trainer_stats_2025-03-15.csv    ← Trainer win percentages
  going_2025-03-15.csv            ← Going conditions per course
  weather_2025-03-15.csv          ← Weather per course
  betfair_odds_2025-03-15.csv     ← Exchange odds and volume
  MASTER_2025-03-15.csv           ← Everything merged into one file ← USE THIS
```

The **MASTER CSV** is what you feed into your prediction model — it has all variables
in one row per horse per race.

---

## Automate It (Run Every Morning Automatically)

### On Windows (Task Scheduler):
1. Open Task Scheduler (search for it in Start menu)
2. Create Basic Task → Name it "Racing Data Collector"
3. Trigger: Daily, set time to 8:00 AM
4. Action: Start a Program
5. Program: `python`
6. Arguments: `C:\path\to\racing_collector.py --date today`
7. Click Finish

### On Mac (cron):
Open Terminal and type `crontab -e`, then add:
```
0 8 * * * python3 /path/to/racing_collector.py --date today
```
This runs at 8 AM every day.

---

## Troubleshooting

**"No races found"**
- Racing post and Sporting Life occasionally block scrapers temporarily
- Wait 10-15 minutes and try again
- Try on a day with known racing first to test

**"ModuleNotFoundError"**
- Run: `pip install -r requirements.txt`

**"Betfair error: login failed"**
- Check your username, password and app key
- Make sure your account has a deposit on it

**Weather shows None for a course**
- The course name might not match our coordinates list
- Check the COURSE_COORDINATES dictionary in the script and add the course

---

## Notes

- The script is polite to servers (waits 2 seconds between requests)
- You can change `PAST_RACES_TO_COLLECT` at the top to get more or fewer past races per horse
- The script handles errors gracefully — if one source fails, it continues with the others
- All times are in UK local time (Europe/London timezone)
