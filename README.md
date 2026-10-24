# BISE Multan Result Extractor
Needs a backend (Node 18+) and Chromium. NOT deployable to static hosting.
## Run locally
    npm install
    npm run build      # installs Chromium for Playwright
    npm start          # http://localhost:3000   (health: /health)
    npm test           # offline tests
## Deploy
Use a host with persistent disk and Docker/VM (Railway, Render, Fly.io, VPS). Build: `npm install && npm run build`. Start: `npm start`. Mount a volume at DATA_DIR.
## Env vars
PORT (3000) · DATA_DIR (./data, holds results.json + debug/) · RESULT_URL (portal URL) · RESULTS_TOOL_USER_AGENT (optional fixed client identifier) · MAX_RATE (only raise with explicit permission) · TAB_TIMEOUT_MS (default 10000 ms)
## Behaviour
Each roll uses a fresh tab, with one active lookup at a time. The default request-start interval is at least 10 seconds (max 360/hour), and the total lookup timeout is 10 seconds. If a lookup times out, its tab is closed, the row is marked failed, and the next roll starts in a fresh tab. A new job cannot start until the previous one stops. The client uses one fixed, transparent user-agent string and does not rotate user agents, proxies, or IP addresses. An HTTP 403/429/503 immediately stops the job without retrying; check portal rules or request permission instead of trying another identity. The tool does not bypass CAPTCHA; a challenge may indicate automated access is not permitted. Completed successful/not-found rolls are skipped on restart. Groups come from subject names; ranking ties share a rank (1,2,2,4); percentage only for Pre-Medical (555).
## User-agent differentiation lab (local mock only)
Run `node ua-variation-lab.js` to see a localhost-only server record different User-Agent strings. This is an isolated teaching demonstration and is not used by the BISE extractor, whose real-portal client retains one identifiable User-Agent. It sends no external requests and does not rotate IP addresses.

## Results page (HTML)
Open http://localhost:3000/report (also linked in the app under "3. Results") for a searchable, printable HTML page: group summary cards, ranked tabs per group, college filter, marks range, and a click-to-expand subject-wise marks view. It is a snapshot of whatever has been retrieved so far, so refresh it while a job runs. `BISE_Multan_Results.html` in Downloads is the same page as a single self-contained file you can save, email or open offline.

## Tests
    npm test            # offline parser/ranking tests
    npm run test:headed # needs a display (Linux: xvfb-run -a npm run test:headed): checks the wait-for-human captcha flow
    npm run test:e2e    # starts a mock portal + the real server + Chromium, drives the web page, checks results/report/downloads/pause/cancel/captcha-stop/restart/background mode

## Troubleshooting
If you click Start and the Progress log shows `ERROR: Playwright is not installed` or `Chromium could not start`, run `npm install` then `npm run build`, and restart `npm start`. Always open http://localhost:3000 in the browser (not ui.html directly).

## Unverified
The live portal selectors/layout (first input + first button, parse via table rows) have NOT been tested against the real site. Failed parses save text to data/debug/.

## Saved data
Every fetched result is stored in DATA_DIR/results.json and each uploaded file is saved as a list. Re-uploading a processed list, or restarting the server, makes no new requests for completed roll numbers. The last list reopens automatically; use 'Saved lists' to view older ones. Back up or mount DATA_DIR on hosting.

## Group rules (subject names only, in this order)
Home Economics (home management/home economics/child development/clothing/textile/nutrition) > Chemistry: Bio no Math = Pre-Medical, Math no Bio = Pre-Engineering, else Unknown > Accounting/Commerce/Business = I.Com > Computer + Math = ICS > Physics/Statistics/Math/Computer = General Science > Economics only = I.Com > Arabic/Islamic Studies/Islamic History = Islamic Studies > known arts electives = FA (Humanities/Arts) > Group Unknown.
Rules for groups other than Pre-Medical/Pre-Engineering come from a general (not BISE-verified) group table; check a few real results.

Pacing: one active tab and one request start every 10 seconds by default. A timeout closes the tab and skips to the next roll; the tool does not run a slow lookup in parallel with the next one. Images/fonts are not downloaded, to reduce load. A refusal is a stop condition, not a cue to retry, raise speed, change user-agent, or route through another IP. `MAX_RATE` can be raised only if the board has explicitly authorized the rate.

## Background mode (no browser needed to start)
    node server.js --file rolls.txt --numeric --rate 360
or with pm2: pm2 start server.js --name bise -- --file rolls.txt --numeric --rate 360
The job starts at launch; open http://localhost:3000 any time to watch, pause, resume or download. Re-running the same command after a restart skips finished rolls.

Minimum marks: set 'Min gazette marks' in the UI, or add --min 500 to the background command, to process only rolls whose gazette total is at least that. Rolls with no numeric gazette total are skipped. Pass/total shown in rankings then covers only that subset.


## Group check
Open http://localhost:3000/groupcheck (also linked under "3. Results"). It lists every distinct set of subjects seen so far, how many students have it, and the group the tool gave it, plus the count per group. Use it to spot a wrong rule or a pile of 'Group Unknown'. Pages whose group could not be detected are saved as data/debug/unknown_<roll>.txt (first 25). Subject rows are kept even if the name contains 'Theory'/'Practical' or the row has a single mark, and short names (BIO, CHEM, PHY, CS) are recognised.

## Group rules, updated order
Arts electives are now checked before Economics and Islamic Studies/Arabic (they are ordinary FA electives, so an FA student with Economics or Islamic Studies is no longer labelled I.Com / Islamic Studies), and 'General Mathematics' counts as an arts subject, not science Math. A subject the student was ABSENT in keeps its row, so it still counts for the group. These rules are still NOT verified against BISE's own group table: check http://localhost:3000/groupcheck on real data.

## Using this tool responsibly
This is not legal advice. The results are public, but the board's website terms and the captcha show it limits automated access, and results contain students' names and marks. Check the portal's terms, keep the speed low, and if you need the whole board's data ask BISE Multan or use the gazette PDFs they publish. Use the data for analysis you are entitled to do (for example your own school's students); do not publish individual students' results or rankings without permission.


## Speed
The defaults are deliberately conservative (one tab, at most one request per minute). This reduces load but does not itself authorize automation; whether automated lookups are allowed depends on the board's terms and permission. At the default rate, 1,000 roll numbers take at least about 16 hours 40 minutes, not counting page load time.

## Districts and cities
BISE Multan covers four districts: Multan, Khanewal, Lodhran and Vehari. The app has a District box and a City/Town box (grouped by district) that list every district and town as options, with how many fetched results match each. The portal has no city field, so both are worked out from the institute address text: a town matches if its name appears in the address (common spelling variants are handled), and a result's district is the district of the LAST town named in the address ('Multan Road, Burewala' counts as Vehari). Addresses with no known town show under 'District not identifiable'. These filters only narrow results you have already fetched; a roll number's city is not known until it has been looked up.
