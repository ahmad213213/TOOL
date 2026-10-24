// BISE Multan result extractor: Node 18+, Playwright, ExcelJS. One file, no framework.
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const PORTAL = process.env.RESULT_URL || 'https://results.bisemultan.edu.pk/';
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });
const DBF = path.join(DATA, 'results.json');
let db = fs.existsSync(DBF) ? JSON.parse(fs.readFileSync(DBF, 'utf8')) : { results: {} };
db.lists = db.lists || {};
const isDone = r => db.results[r] && ['ok', 'notfound'].includes(db.results[r].status);
let dirty = false;
const save = () => { dirty = true; };
const flush = () => { if (!dirty) return; fs.writeFileSync(DBF + '.tmp', JSON.stringify(db)); fs.renameSync(DBF + '.tmp', DBF); dirty = false; };
setInterval(flush, 5000).unref();
['SIGINT', 'SIGTERM'].forEach(sg => process.on(sg, () => { flush(); process.exit(0); }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HEADED = process.argv.includes('--headed') || process.env.HEADED === '1';   // visible browser so a human can solve a captcha
const VERIFY_WAIT_MS = 15 * 60 * 1000;
const MAX_RATE = +process.env.MAX_RATE || 360, MAX_TABS = 1;                                  // default: at most 360 starts/hour (10 s apart), only one active lookup
const TAB_TIMEOUT_MS = +process.env.TAB_TIMEOUT_MS || 10000;                                  // total time budget for one lookup; on timeout, close its tab and continue

// ---------- group detection (subject-name rules) ----------
const MEDICAL_MAX = 555; // only group max confirmed so far
function detectGroup(subs) {
  const names = subs.map(s => s.name.toLowerCase());
  const has = k => names.some(n => n.includes(k));
  const any = ks => ks.some(has);
  const ab = (full, short) => has(full) || names.some(n => new RegExp('\\b' + short + '\\b').test(n));   // full name or common abbreviation (BIO, CHEM, PHY, CS)
  const bio = ab('biology', 'bio'), chem = ab('chemistry', 'chem'), phys = ab('physics', 'phy');
  const math = names.some(n => /math/.test(n) && !/business|general/.test(n));   // science Mathematics only: 'Business Mathematics' (I.Com) and 'General Mathematics' (arts) are different
  const cs = has('computer') || names.some(n => /\b(cs|comp)\b/.test(n));
  const islamic = any(['arabic', 'islamic studies', 'islamic history']);
  if (any(['home management', 'clothing', 'textile', 'nutrition', 'home economics', 'child development'])) return 'Home Economics';
  if (chem) {
    if (bio && !math) return 'Pre-Medical';
    if (math && !bio) return 'Pre-Engineering';
    return 'Group Unknown';
  }
  if (any(['accounting', 'commerce', 'business'])) return 'I.Com';
  if (cs && math) return 'ICS';
  if (phys || has('statistics') || math || cs) return 'General Science';
  // Arts electives are checked BEFORE Economics and Islamic Studies/Arabic, because those are also ordinary FA electives.
  const arts = ['civics', 'psychology', 'geography', 'sociology', 'fine art', 'philosophy', 'logic', 'literature', 'punjabi', 'saraiki', 'persian', 'journalism', 'library', 'education', 'history', 'pakistan culture', 'general math', 'political', 'social work', 'sindhi', 'pashto', 'urdu advance', 'advanced urdu'];
  if (names.some(n => arts.some(k => n.includes(k)) && !/islamic/.test(n))) return 'FA (Humanities/Arts)';
  if (has('economics')) return islamic ? 'FA (Humanities/Arts)' : 'I.Com';
  if (islamic) return 'Islamic Studies';
  return 'Group Unknown';
}

// ---------- parsing ----------
const GRADE = /^(A\+|A|B\+|B|C|D|E|F)$/i, STAT = /^(PASS|FAIL|ABSENT|RE-?APPEAR|UFM|WITHHELD)\w*$/i, NUM = /^\d+(\.\d+)?$/;
function field(text, label) {
  const m = text.match(new RegExp(label + '\\s*[:\\t ]*\\s*\\n?\\s*([^\\n\\t]+)', 'i'));
  return m ? m[1].trim() : null;
}
function parseResult(roll, { text, rows }) {
  const subs = [];
  let lines = rows.filter(r => r.length > 1);
  if (!lines.length) lines = text.split(/\n/).map(l => l.split(/\t+|\s{2,}/).map(x => x.trim()).filter(Boolean));
  for (const c of lines) {
    const name = c[0];
    if (!name || NUM.test(name) || /^(subject name|subject|theory|practical|percentile|grade|status|total|marks)$/i.test(name) || /^result notification/i.test(name)) continue;   // header cells only, so 'Physics (Practical)' is kept
    const nums = c.slice(1).filter(x => NUM.test(x)).map(Number);
    const grade = c.find((x, i) => i > 0 && GRADE.test(x));
    const status = c.find((x, i) => i > 0 && STAT.test(x));
    if ((nums.length >= 1 && (grade || status)) || (status && /^(absent|withheld|ufm|re-?appear)/i.test(status)))   // an ABSENT/WITHHELD subject has no marks but must still count for the group; a row with a single mark (e.g. a subject without a percentile column) must not be dropped: dropping Math would change the group
      subs.push({ name, theory: nums.length ? nums[0] : null, practical: nums.length >= 3 ? nums[1] : null, percentile: nums.length >= 2 ? nums[nums.length - 1] : null, grade: grade || null, status: status || null });
  }
  const kv = {}; for (const c of rows) if (c.length >= 2 && c[0]) kv[c[0].toLowerCase().replace(/[.:]/g, '').trim()] = c[1];
  const gotRoll = /^\d{4,}$/.test(kv['roll no'] || '') ? kv['roll no'] : (text.match(/Roll No\.?[\s:]*(\d{4,})/i) || [])[1];
  const name = field(text, 'Name(?! of)\\b(?<!Father Name)') ;
  const nm = kv['name'] || (text.match(/\bName\s*[:\t ]*\s*\n?\s*([A-Z][^\n\t]+)/) || [])[1];
  const inst = kv['institute name'] || field(text, 'Institute Name');
  const tr = rows.find(c => /result notification/i.test(c[0] || '')), tc = tr && tr.slice(1).find(x => /^\d{2,4}$/.test(x));
  const tot = tc || (text.match(/Result Notification[\s\S]{0,300}?\b(\d{2,4})\b/i) || [])[1];
  const pageTotal = tot ? Number(tot) : null;
  const sum = subs.reduce((a, s) => a + (s.theory || 0) + (s.practical || 0), 0);
  const rec = {
    roll, status: 'ok', name: nm ? nm.trim() : name, father: kv['father name'] || field(text, 'Father Name'), institute: inst,
    school_code: inst && (inst.match(/^(\d+)\s*-/) || [])[1] || null,
    exam: (text.match(/(Higher Secondary[^\n]*|Secondary School[^\n]*)/i) || [])[1] || null,
    subjects: subs, note: '',
  };
  if (!gotRoll || gotRoll !== roll || !subs.length || !rec.name) {
    return { ...rec, status: 'parse_error', note: 'Unexpected layout; roll/name/subjects not found. Check data/debug.' };
  }
  rec.group = detectGroup(subs);
  rec.sum = sum;
  rec.marks = pageTotal != null ? pageTotal : sum;
  if (pageTotal == null) rec.note = 'Page total missing; used subject sum.';
  else if (pageTotal !== sum) rec.note = 'CHECK: subject sum ' + sum + ' differs from page total ' + pageTotal;
  rec.result = subs.some(s => /absent/i.test(s.status || '')) ? 'Absent' : subs.some(s => /fail/i.test(s.status || '')) ? 'Fail' : 'Pass';
  rec.max = rec.group === 'Pre-Medical' ? MEDICAL_MAX : null;
  rec.percentage = rec.max && !rec.note.startsWith('CHECK') ? +(rec.marks / rec.max * 100).toFixed(2) : null;
  return rec;
}

// ---------- job control ----------
let job = { interval: 10000, floor: 10000, streak: 0, conc: 1, meta: {}, state: 'idle', queue: [], invalid: [], dup: 0, current: null, start: 0, log: [], delay: 0, retries: 1, done: 0 };
(function restore() {
  const ids = Object.keys(db.lists).sort(); if (!ids.length) return;
  const l = db.lists[ids[ids.length - 1]]; job.queue = l.rolls; job.meta = l.meta || {}; job.done = l.rolls.filter(isDone).length; job.state = 'idle';
})();
const log = m => { job.log.push(new Date().toISOString().slice(11, 19) + ' ' + m); job.log = job.log.slice(-200); };
function parseRolls(txt) {
  const seen = new Set(), valid = [], invalid = [], meta = {}; let dup = 0;
  for (let l of txt.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)) {
    l = l.trim(); if (!l) continue;
    const c = l.split(/\t|,/).map(x => x.trim()), r = c[0];   // first column = roll (supports gazette-style TSV)
    if (/^roll/i.test(r)) continue;                              // header row
    if (!/^\d{4,8}$/.test(r)) { invalid.push(l); continue; }
    if (seen.has(r)) { dup++; continue; }
    seen.add(r); valid.push(r);
    if (c.length > 1) meta[r] = { name: c[1] || '', result: c[2] || '' };
  }
  return { valid, invalid, dup, meta };
}
// Detects a REAL visible challenge (widget/iframe/field/prompt), not just the word "captcha" somewhere in the page source.
async function captchaVisible(page) {
  try {
    return await page.evaluate(() => {
      const vis = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const sel = 'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha,.cf-turnstile,img[src*="captcha" i],img[id*="captcha" i],input[name*="captcha" i],input[id*="captcha" i]';
      if ([...document.querySelectorAll(sel)].some(vis)) return true;
      return /captcha|verify you are (a )?human|are you a robot|security check/i.test(document.body ? document.body.innerText : '');
    });
  } catch { return false; }
}
let verifying = null;   // shared gate: while a human solves a captcha, every tab waits
async function needHuman(page) {
  if (!HEADED) { const e = new Error('Captcha/verification detected'); e.blocked = true; throw e; }
  if (!verifying) {
    verifying = (async () => {
      log('CAPTCHA: solve it in the open browser window. The job resumes automatically (waiting up to 15 min).');
      job.verify = true;
      const t = Date.now();
      while (Date.now() - t < VERIFY_WAIT_MS && !STOP.includes(job.state)) { await sleep(2000); if (!(await captchaVisible(page))) { job.floor = Math.min(Math.max(job.floor, job.interval * 1.5), 60000); job.interval = job.floor; job.streak = 0; log('Verification done, resuming at a slower pace (' + Math.round(3600000 / job.interval) + '/hour).'); job.verify = false; return true; } }
      job.verify = false; return false;
    })().finally(() => { verifying = null; });
  }
  if (!(await verifying)) { const e = new Error('Captcha not solved in time'); e.blocked = true; throw e; }
}
async function throwIfPortalRefused(page) {
  const status = page.__portalRefusalStatus;
  if ([403, 429, 503].includes(status)) {
    const e = new Error('Portal returned HTTP ' + status + ' (rate limit / block)');
    e.throttled = true;
    throw e;
  }
}
async function fetchOne(page, roll) {
  if (verifying) await verifying.catch(() => {});
  const resp = await page.goto(PORTAL, { waitUntil: 'domcontentloaded' });
  if (resp && [403, 429, 503].includes(resp.status())) { const e = new Error('Portal returned HTTP ' + resp.status() + ' (rate limit / block)'); e.throttled = true; throw e; }
  await throwIfPortalRefused(page);
  if (await captchaVisible(page)) await needHuman(page);
  const input = page.locator('input[type=text],input[type=number],input:not([type])').first();
  await input.fill(roll);
  const btn = page.getByRole('button', { name: /view result/i }).first();
  if (await btn.count()) await btn.click(); else await input.press('Enter');
  try {
    await page.waitForFunction(() => /Roll No\.?[\s:]*\d{4,}|not found|no result|not available|invalid/i.test(document.body.innerText), null, { timeout: TAB_TIMEOUT_MS, polling: 100 });
  } catch {
    await throwIfPortalRefused(page);
    if (await captchaVisible(page)) { await needHuman(page); const e = new Error('captcha solved; retrying this roll'); e.keepTab = true; throw e; }
    const e = new Error('timeout waiting for result'); e.lookupTimeout = true; throw e;
  }
  await throwIfPortalRefused(page);
  const snap = await page.evaluate(() => ({ text: document.body.innerText, rows: [...document.querySelectorAll('tr')].map(r => [...r.children].map(c => c.innerText.trim())) }));
  if (!/Roll No\.?[\s:]*\d{4,}/i.test(snap.text)) return { roll, status: 'notfound', note: 'Portal reported no result' };
  const rec = parseResult(roll, snap);
  if (rec.status === 'parse_error' || (rec.group === 'Group Unknown' && unknownSaved < 25)) {
    if (rec.status !== 'parse_error') unknownSaved++;
    fs.mkdirSync(path.join(DATA, 'debug'), { recursive: true }); fs.writeFileSync(path.join(DATA, 'debug', (rec.status === 'parse_error' ? '' : 'unknown_') + roll + '.txt'), snap.text.slice(0, 4000));
  }
  return rec;
}
let unknownSaved = 0;   // debug copies of pages whose group could not be detected (first 25)
let nextSlot = 0;   // global rate limiter shared by all tabs
const STOP = ['cancelled', 'blocked', 'error'];
async function throttle() { const now = Date.now(), slot = Math.max(now, nextSlot); nextSlot = slot + job.interval; while (Date.now() < slot && !STOP.includes(job.state)) await sleep(Math.min(250, slot - Date.now())); }
let runActive = false;   // runActive: a job's browser is still open/closing (a new job must wait)
const busy = () => runActive || ['running', 'paused'].includes(job.state);
async function run() {
  nextSlot = 0; verifying = null;
  let chromium, browser;
  try { ({ chromium } = require('playwright')); }
  catch (e) { throw new Error('Playwright is not installed. Run: npm install'); }
  try { browser = await chromium.launch({ headless: !HEADED }); }
  catch (e) { throw new Error('Chromium could not start. Run: npm run build (installs Chromium). Details: ' + String(e.message).split('\n')[0]); }
  // One shared context: cookies/verification are shared by all tabs. Every lookup opens its own fresh tab and closes it afterwards.
  // Fixed, transparent identifier; deliberately do not rotate user agents or use proxy/IP rotation.
  const ctx = await browser.newContext({
    userAgent: process.env.RESULTS_TOOL_USER_AGENT || 'BISE-Results-Lookup/1.0 (automated client)'
  });
  await ctx.route('**/*', r => ['image', 'font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue());
  async function openTab() {
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(TAB_TIMEOUT_MS);
    pg.setDefaultNavigationTimeout(TAB_TIMEOUT_MS);
    pg.__portalRefusalStatus = null;
    pg.on('response', response => {
      if ([403, 429, 503].includes(response.status())) pg.__portalRefusalStatus = response.status();
    });
    job.opened = (job.opened || 0) + 1;
    return pg;
  }
  const inflight = new Set(), since = new Map();   // single active lookup; roll -> when its tab opened

  async function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { const e = new Error('lookup timed out after ' + Math.round(ms / 1000) + ' seconds'); e.lookupTimeout = true; reject(e); }, ms);
    });
    try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
  }

  // One lookup = one fresh tab. A slow lookup is closed at the timeout; the next roll then uses a new tab.
  async function lookup(roll) {
    let rec, page = null;   // the tab is kept across attempts only when a human just solved a captcha in it
    for (let a = 1; a <= job.retries; a++) {
      if (!page || page.isClosed()) page = await openTab();
      try { rec = await withTimeout(fetchOne(page, roll), TAB_TIMEOUT_MS); break; }
      catch (e) {
        if (!e.keepTab) { await page.close().catch(() => {}); page = null; }
        if (STOP.includes(job.state)) return;   // job was stopped: tabs get closed, nothing is recorded as failed
        if (e.throttled) {
          // A refusal/rate-limit response is a stop signal, not a reason to retry or change identity.
          job.state = 'blocked';
          log('STOPPED: ' + e.message + '. No retry attempted; check the portal rules or request permission from the board.');
          return;
        }
        if (e.blocked) { job.state = 'blocked'; log('STOPPED: ' + e.message + '. Manual verification required; not bypassing.'); return; }
        if (e.lookupTimeout) {
          rec = { roll, status: 'failed', note: 'Timed out after ' + Math.round(TAB_TIMEOUT_MS / 1000) + ' seconds; skipped and moved to the next roll in a fresh tab.' };
          log(roll + ': ' + rec.note);
          break;
        }
        const em = String(e.message).split('\n')[0]; log(roll + ' attempt ' + a + ' failed: ' + em); rec = { roll, status: 'failed', note: em }; await sleep(2000 * a);
      }
    }
    if (page && !page.isClosed()) await page.close().catch(() => {});
    if (STOP.includes(job.state) || !rec) return;
    const g = job.meta && job.meta[roll];
    if (g && rec.status === 'ok') {
      rec.gazette_result = g.result;
      const nz = x => String(x || '').toUpperCase().replace(/[^A-Z]/g, '');
      if (nz(g.name) && nz(g.name) !== nz(rec.name)) rec.note = (rec.note ? rec.note + ' | ' : '') + 'GAZETTE name differs: ' + g.name;
      if (/^\d+$/.test(g.result) && Number(g.result) !== rec.marks) rec.note = (rec.note ? rec.note + ' | ' : '') + 'GAZETTE total ' + g.result + ' differs from portal ' + rec.marks;
    }
    // No automatic speed-up: the configured request interval remains fixed for the whole job.
    if (rec.status !== 'ok' && rec.status !== 'notfound') job.streak = 0;
    db.results[roll] = rec; save(); job.done++;
    if (rec.status !== 'ok') log(roll + ': ' + rec.status + ' ' + (rec.note || ''));
  }

  // The single active lookup has a hard timeout; on timeout its tab closes before the next roll starts.
  const watch = setInterval(() => { const now = Date.now(); for (const [r, t] of since) if (now - t > TAB_TIMEOUT_MS) log('Lookup ' + r + ' has exceeded its ' + Math.round(TAB_TIMEOUT_MS / 1000) + 's time budget; it will be skipped.'); }, 1000);
  let idx = 0;
  try {
    while (idx < job.queue.length) {
      while (job.state === 'paused') await sleep(500);
      if (STOP.includes(job.state)) break;
      const roll = job.queue[idx++];
      if (isDone(roll)) { job.done++; continue; }
      while (inflight.size >= 1 && !STOP.includes(job.state)) await Promise.race([...inflight]);              // never run lookups concurrently
      if (verifying) await verifying.catch(() => {});                                                        // a human is solving a captcha: hold new tabs
      await throttle();                                                                                      // enforce the minimum interval between request starts
      while (job.state === 'paused') await sleep(500);
      if (STOP.includes(job.state)) break;
      job.current = roll; since.set(roll, Date.now());
      const p = lookup(roll).catch(e => log(roll + ' error: ' + String(e.message).split('\n')[0])).finally(() => { inflight.delete(p); since.delete(roll); job.inFlight = inflight.size; });
      inflight.add(p); job.inFlight = inflight.size;
      if (job.delay) await sleep(job.delay);                                                                  // optional extra pause
    }
    if (STOP.includes(job.state)) await ctx.close().catch(() => {});   // stopped/cancelled/blocked: close every open tab right away
    await Promise.all([...inflight]);                                  // otherwise wait for the tabs still running
  } finally { clearInterval(watch); job.inFlight = 0; await ctx.close().catch(() => {}); await browser.close().catch(() => {}); flush(); }
  if (job.state === 'running') job.state = 'done';
  log('Job ' + job.state);
}

// City/district are NOT separate fields on the portal; they are matched from the institute address text.
// BISE Multan covers four districts: Multan, Khanewal, Lodhran and Vehari. Towns are listed under their district.
const DISTRICTS = {
  Multan: ['Multan', 'Shujabad', 'Jalalpur Pirwala'],
  Khanewal: ['Khanewal', 'Kabirwala', 'Mian Channu', 'Jahanian', 'Abdul Hakim', 'Tulamba'],
  Lodhran: ['Lodhran', 'Dunyapur', 'Kehror Pacca'],
  Vehari: ['Vehari', 'Burewala', 'Mailsi', 'Gaggo Mandi'],
};
const OTHER_TOWNS = ['Karor Lal Eason'];   // kept from the earlier list; it is in Layyah district, outside the four districts
const CITIES = [...Object.values(DISTRICTS).flat(), ...OTHER_TOWNS];
const ALIASES = { 'Kehror Pacca': ['Kehror Pacca', 'Kahror Pacca', 'Kahror Pakka', 'Kehror Pakka'], 'Mian Channu': ['Mian Channu', 'Mian Chunnu'], 'Jalalpur Pirwala': ['Jalalpur Pirwala', 'Jalalpur Pirwal'], 'Karor Lal Eason': ['Karor Lal Eason', 'Karor Lal Esan', 'Kot Karor'] };
const placeRe = c => new RegExp('\\b(?:' + (ALIASES[c] || [c]).join('|') + ')\\b', 'ig');
const cityIn = (r, c) => placeRe(c).test(r.institute || '');   // 'mentions this town anywhere in the address'
// District of a result = the district of the LAST town named in the address (addresses usually end with the town,
// so 'Multan Road, Burewala' is Vehari, not Multan). '' = could not be worked out.
const DCACHE = new WeakMap();
function districtOf(r) {
  if (DCACHE.has(r)) return DCACHE.get(r);
  const t = r.institute || '', hits = [];
  for (const [d, towns] of Object.entries(DISTRICTS)) for (const c of towns) { let m; const re = placeRe(c); while ((m = re.exec(t))) hits.push({ d, i: m.index }); }
  hits.sort((x, y) => y.i - x.i);
  const d = hits.length ? hits[0].d : '';
  DCACHE.set(r, d); return d;
}
// ---------- rankings & exports ----------
const all = () => job.queue.length ? job.queue.map(r => db.results[r]).filter(Boolean) : Object.values(db.results);
function rank(list) {
  const s = list.filter(r => r.status === 'ok' && Number.isFinite(r.marks)).sort((a, b) => b.marks - a.marks);
  let prev = null, pos = 0; // competition ranking: ties share a rank, next rank skips (1,2,2,4)
  return s.map((r, i) => { if (r.marks !== prev) { pos = i + 1; prev = r.marks; } return { rank: pos, ...r }; });
}
const COLS = ['rank', 'roll', 'name', 'father', 'school_code', 'institute', 'group', 'marks', 'max', 'percentage', 'result', 'gazette_result', 'status', 'note'];
const q = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const csv = (rows, cols = COLS) => '\uFEFF' + cols.join(',') + '\r\n' + rows.map(r => cols.map(c => q(r[c])).join(',')).join('\r\n');
const fname = g => g.replace(/[^A-Za-z0-9]+/g, '_') + '_Ranking.csv';
function sets() {
  const rs = all(), ok = rs.filter(r => r.status === 'ok');
  const groups = [...new Set(['Pre-Medical', 'Pre-Engineering', 'ICS', ...ok.map(r => r.group)])];
  const out = { 'All_Results.csv': rs, 'Overall_Ranking.csv': rank(ok) };
  for (const g of groups) out[fname(g)] = rank(ok.filter(r => r.group === g));
  const bySchool = {}; ok.forEach(r => r.school_code && (bySchool[r.school_code] = bySchool[r.school_code] || []).push(r));
  out['School_Ranking.csv'] = Object.values(bySchool).flatMap(rank).sort((a, b) => a.school_code.localeCompare(b.school_code) || a.rank - b.rank);
  out['Failed_Absent_Unavailable.csv'] = rs.filter(r => r.status !== 'ok' || r.result !== 'Pass' || !Number.isFinite(r.marks));
  out['Processing_Report.csv'] = rs.map(r => ({ roll: r.roll, status: r.status, note: r.note, group: r.group }));
  return out;
}
async function xlsx() {
  const ExcelJS = require('exceljs'), wb = new ExcelJS.Workbook(), s = sets();
  for (const [f, rows] of Object.entries(s)) {
    if (f === 'Processing_Report.csv' || f === 'School_Ranking.csv') continue;
    const ws = wb.addWorksheet(f.replace('.csv', '').slice(0, 31)); ws.columns = COLS.map(c => ({ header: c, key: c, width: 18 }));
    rows.forEach(r => ws.addRow(r));
  }
  const ws = wb.addWorksheet('Processing_Errors'); ws.columns = ['roll', 'status', 'note'].map(c => ({ header: c, key: c, width: 30 }));
  s['Processing_Report.csv'].filter(r => r.status !== 'ok').forEach(r => ws.addRow(r));
  return wb.xlsx.writeBuffer();
}

const inRange = (m, min, max) => !!m && /^\d+$/.test(m.result) && (!min || Number(m.result) >= min) && (!max || Number(m.result) <= max);
function startJob(body) {
  if (busy()) return { error: runActive && !['running', 'paused'].includes(job.state) ? 'Previous job is still stopping, try again in a moment' : 'Job already active', code: 409 };
  const p = parseRolls(body.text || '');
  if (body.onlyNumeric) p.valid = p.valid.filter(r => p.meta[r] && /^\d+$/.test(p.meta[r].result));
  const min = +body.minMarks || 0, max = +body.maxMarks || 0;   // optional gazette-total range
  if (min > 0 || max > 0) p.valid = p.valid.filter(r => inRange(p.meta[r], min, max));
  if (!p.valid.length) return { error: 'No valid roll numbers match the filters', code: 400 };
  const rate = Math.min(MAX_RATE, Math.max(1, +body.rate || 360));   // fixed cap; default 360/hour (at least 10s between lookup starts)
  job = { meta: p.meta, state: 'running', queue: p.valid, invalid: p.invalid, dup: p.dup, current: null, start: Date.now(), log: [], delay: Math.max(0, body.delay === '' || body.delay == null || !Number.isFinite(+body.delay) ? 0 : +body.delay), conc: 1, rate, interval: 3600000 / rate, floor: 3600000 / rate, streak: 0, retries: Math.max(1, Math.min(5, +body.retries || 1)), done: 0 };
  const id = String(Date.now()); db.lists[id] = { name: String(body.name || 'list').slice(0, 80), created: new Date().toISOString(), rolls: p.valid, meta: Object.fromEntries(p.valid.filter(r => p.meta[r]).map(r => [r, p.meta[r]])) }; save();
  if (p.valid.every(isDone)) { job.state = 'done'; job.done = p.valid.length; log('All ' + p.valid.length + ' results already saved. No requests made.'); return { valid: p.valid.length, invalid: p.invalid.length, dup: p.dup, cached: true }; }
  log('Started: ' + p.valid.length + ' valid, ' + p.invalid.length + ' invalid, ' + p.dup + ' duplicates removed; one active tab; max ' + rate + '/hour; timeout ' + Math.round(TAB_TIMEOUT_MS / 1000) + 's');
  runActive = true;
  run().catch(e => { job.state = 'error'; log('ERROR: ' + e.message); console.error('Job error:', e.message); }).finally(() => { runActive = false; });
  return { valid: p.valid.length, invalid: p.invalid.length, dup: p.dup };
}

// ---------- HTTP ----------
const UI = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
const REPORT = fs.readFileSync(path.join(__dirname, 'report.html'), 'utf8');
// Self-contained HTML snapshot of all results (data embedded as JSON; '<' escaped so names can never break out of the script tag)
function reportHtml() {
  const rs = all(), ok = rs.filter(r => r.status === 'ok');
  const data = {
    generated: new Date().toISOString(),
    groups: [...new Set(['Pre-Medical', 'Pre-Engineering', 'ICS', ...ok.map(r => r.group)])],
    students: ok.map(r => ({ roll: r.roll, name: r.name, father: r.father, school_code: r.school_code, institute: r.institute, district: districtOf(r) || 'none', group: r.group, marks: r.marks, percentage: r.percentage, result: r.result, note: r.note || '', subjects: (r.subjects || []).map(s => [s.name, s.theory, s.practical, s.percentile, s.grade, s.status]) })),
    districts: Object.keys(DISTRICTS),
    unavailable: rs.filter(r => r.status !== 'ok').map(r => ({ roll: r.roll, status: r.status, note: r.note || '' })),
  };
  return REPORT.replace('__DATA__', () => JSON.stringify(data).replace(/</g, '\\u003c'));
}
const json = (res, o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/health') return json(res, { ok: true });
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(UI); }
    if (u.pathname === '/report') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(reportHtml()); }
    if (u.pathname === '/api/status') {
      const rs = all(), c = s => rs.filter(r => r.status === s).length, total = job.queue.length;
      const el = job.start ? (Date.now() - job.start) / 1000 : 0, rem = total - job.done;
      return json(res, { state: job.state, verify: !!job.verify, tabsOpened: job.opened || 0, inFlight: job.inFlight || 0, rateNow: job.state === 'running' ? Math.round(3600000 / job.interval) : null, total, ok: c('ok'), notfound: c('notfound'), failed: c('failed') + c('parse_error'), remaining: rem, current: job.current, invalid: job.invalid.length, dup: job.dup, elapsed: Math.round(el), eta: job.done ? Math.round(el / job.done * rem) : null, log: job.log.slice(-30) });
    }
    if (u.pathname === '/api/lists') return json(res, Object.entries(db.lists).map(([id, l]) => ({ id, name: l.name, created: l.created, count: l.rolls.length, done: l.rolls.filter(isDone).length })).reverse());
    if (u.pathname === '/api/summary') {
      const ok = all().filter(r => r.status === 'ok'), gs = [...new Set(['Pre-Medical', 'Pre-Engineering', 'ICS', ...ok.map(r => r.group)])];
      return json(res, gs.map(g => {
        const rk = rank(ok.filter(r => r.group === g)), n = rk.length;
        return { group: g, count: n, highest: n ? rk[0].marks : null, average: n ? +(rk.reduce((a, r) => a + r.marks, 0) / n).toFixed(1) : null, top: rk.slice(0, 3).map(r => ({ rank: r.rank, name: r.name, roll: r.roll, marks: r.marks })), file: fname(g) };
      }));
    }
    if (u.pathname === '/api/colleges') {
      const m = {}; all().filter(r => r.status === 'ok' && r.school_code).forEach(r => { (m[r.school_code] = m[r.school_code] || { code: r.school_code, name: r.institute.replace(/^\d+\s*-\s*/, '').slice(0, 70), count: 0 }).count++; });
      return json(res, Object.values(m).sort((a, b) => a.name.localeCompare(b.name)));
    }
    if (u.pathname === '/api/cities') {
      const ok = all().filter(r => r.status === 'ok');
      const dOf = c => Object.keys(DISTRICTS).find(d => DISTRICTS[d].includes(c)) || 'Other';
      return json(res, CITIES.map(c => ({ city: c, district: dOf(c), count: ok.filter(r => cityIn(r, c)).length })));   // every town is an option, even with 0 results so far
    }
    if (u.pathname === '/api/districts') {
      const ok = all().filter(r => r.status === 'ok'), c = {}; ok.forEach(r => { const d = districtOf(r) || 'none'; c[d] = (c[d] || 0) + 1; });
      return json(res, [...Object.keys(DISTRICTS).map(d => ({ district: d, towns: DISTRICTS[d], count: c[d] || 0 })), { district: 'none', towns: [], count: c.none || 0 }]);
    }
    if (u.pathname === '/api/groups') {
      const rs = all(), ok = rs.filter(r => r.status === 'ok'), c = {};
      ok.forEach(r => c[r.group] = (c[r.group] || 0) + 1);
      return json(res, { All: ok.length, ...c, Unavailable: rs.length - ok.length });
    }
    if (u.pathname === '/api/results') {
      const sp = u.searchParams, t = (sp.get('q') || '').toLowerCase(), p = +sp.get('page') || 1, g = sp.get('group') || '';
      const col = sp.get('college') || '', city = CITIES.includes(sp.get('city')) ? sp.get('city') : '', mn = sp.get('minM'), mx = sp.get('maxM');
      const ok = all().filter(r => r.status === 'ok'), bad = all().filter(r => r.status !== 'ok');
      // college/city narrow the pool first, so rank = position within that selection; marks range keeps that rank
      let base = g && g !== 'All' && g !== 'Unavailable' ? ok.filter(r => r.group === g) : ok;
      if (col) base = base.filter(r => r.school_code === col);
      if (city) base = base.filter(r => cityIn(r, city));
      const dist = sp.get('district') || ''; if (dist) base = base.filter(r => (districtOf(r) || 'none') === dist);
      let rows = g === 'Unavailable' ? bad : rank(base);
      if (mn) rows = rows.filter(r => r.marks >= +mn);
      if (mx) rows = rows.filter(r => r.marks <= +mx);
      rows = rows.filter(r => !t || [r.roll, r.name, r.group, r.status, r.school_code].join(' ').toLowerCase().includes(t));
      return json(res, { n: rows.length, rows: rows.slice((p - 1) * 50, p * 50).map(({ subjects, ...r }) => r) });
    }
    if (req.method === 'POST' && u.pathname.startsWith('/api/')) {
      let b = ''; for await (const ch of req) b += ch; const body = b ? JSON.parse(b) : {};
      if (u.pathname === '/api/start') { const r = startJob(body); return json(res, r, r.code || 200); }
      if (u.pathname === '/api/preview') { const p = parseRolls(body.text || ''); return json(res, { valid: p.valid.length, invalid: p.invalid.length, dup: p.dup, numeric: p.valid.filter(r => p.meta[r] && /^\d+$/.test(p.meta[r].result)).length, atLeast: (+body.minMarks > 0 || +body.maxMarks > 0) ? p.valid.filter(r => inRange(p.meta[r], +body.minMarks || 0, +body.maxMarks || 0)).length : null }); }
      if (u.pathname === '/api/view') {
        if (busy()) return json(res, { error: 'Job is running' }, 409);
        const l = db.lists[body.id]; if (!l) return json(res, { error: 'unknown list' }, 404);
        job = { ...job, meta: l.meta || {}, state: 'idle', queue: l.rolls, done: l.rolls.filter(isDone).length, invalid: [], dup: 0, current: null, start: 0 };
        return json(res, { ok: true });
      }
      if (u.pathname === '/api/deletelist') {
        if (busy()) return json(res, { error: 'Job is running' }, 409);
        delete db.lists[body.id]; save(); job.queue = []; job.done = 0; return json(res, { ok: true });
      }
      if (u.pathname === '/api/pause' && job.state === 'running') job.state = 'paused';
      if (u.pathname === '/api/resume' && job.state === 'paused') job.state = 'running';
      if (u.pathname === '/api/cancel' && ['running', 'paused'].includes(job.state)) job.state = 'cancelled';
      return json(res, { state: job.state });
    }
    if (u.pathname.startsWith('/download/')) {
      const f = decodeURIComponent(u.pathname.slice(10));
      if (f === 'BISE_Multan_Results.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename=' + f }); return res.end(reportHtml()); }
      if (f === 'BISE_Multan_Results.xlsx') { res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename=' + f }); return res.end(Buffer.from(await xlsx())); }
      const s = sets(); if (!s[f]) return json(res, { error: 'unknown file' }, 404);
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=' + f });
      return res.end(csv(f === 'Processing_Report.csv' ? s[f] : s[f], f === 'Processing_Report.csv' ? ['roll', 'status', 'group', 'note'] : COLS));
    }
    if (u.pathname === '/groupcheck' || u.pathname === '/api/subject-sets') {
      const rs = all(), ok = rs.filter(r => r.status === 'ok'), sets = {}, counts = {};
      ok.forEach(r => { counts[r.group] = (counts[r.group] || 0) + 1; const names = (r.subjects || []).map(x => x.name).sort(), k = names.join(' | ');
        (sets[k] = sets[k] || { group: r.group, count: 0, example: r.roll, subjects: names }).count++; });
      const list = Object.values(sets).sort((a, b) => b.count - a.count);
      if (u.pathname === '/api/subject-sets') return json(res, { groups: counts, notOk: rs.length - ok.length, sets: list });
      const E = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('<!doctype html><meta charset="utf-8"><title>Group check</title><style>body{font:14px system-ui;margin:20px;max-width:1100px}td,th{border-bottom:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:top}th{background:#eee}</style><h2>Group check</h2><p>Each row is one distinct set of subjects seen in the fetched results and the group the tool gave it. If a row is in the wrong group, or many are in "Group Unknown", send this page (or a screenshot) so the rules can be fixed. Pages of unknown-group results are saved in <code>data/debug/unknown_*.txt</code>.</p><p><b>Fetched OK:</b> ' + ok.length + ' &nbsp; <b>Not OK (failed / not found / parse error):</b> ' + (rs.length - ok.length) + '</p><p>' + Object.entries(counts).map(([g, n]) => '<b>' + E(g) + '</b>: ' + n).join(' &nbsp;|&nbsp; ') + '</p><table><tr><th>Students</th><th>Group given</th><th>Subjects</th><th>Example roll</th></tr>' + list.map(x => '<tr><td>' + x.count + '</td><td>' + E(x.group) + '</td><td>' + E(x.subjects.join(', ')) + '</td><td>' + E(x.example) + '</td></tr>').join('') + '</table>');
    }
    if (u.pathname === '/api/files') return json(res, ['BISE_Multan_Results.html', ...Object.keys(sets()), 'BISE_Multan_Results.xlsx']);
    json(res, { error: 'not found' }, 404);
  } catch (e) { json(res, { error: e.message }, 500); }
}).listen(PORT, () => {
  console.log('Listening on ' + PORT);
  // Background mode: node server.js --file rolls.txt [--numeric] [--rate 360] [--delay 0] [--headed]
  const A = process.argv, arg = k => { const i = A.indexOf('--' + k); return i > -1 ? A[i + 1] : undefined; };
  if (arg('file')) {
    const r = startJob({ name: path.basename(arg('file')), text: fs.readFileSync(arg('file'), 'utf8'), onlyNumeric: A.includes('--numeric'), minMarks: arg('min'), maxMarks: arg('max'), rate: arg('rate'), conc: arg('tabs'), delay: arg('delay') });
    console.log(r.error ? 'Could not start: ' + r.error : 'Background job started: ' + JSON.stringify(r) + '. Open http://localhost:' + PORT + ' to watch.');
  }
});

module.exports = { parseResult, detectGroup, rank, parseRolls, districtOf, DISTRICTS };
