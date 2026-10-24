// End-to-end test: a MOCK portal (synthetic data, local only) + the real server + real Chromium driving the real web page.
// Run: npm run test:e2e   (needs `npm install` and `npm run build` first)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
process.env.MAX_RATE = '20000'; process.env.TAB_TIMEOUT_MS = '2500'; // test-only fast pace and short timeout, against localhost mock portal only
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise(r => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
async function until(fn, ms, label) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t > ms) throw new Error('Timed out waiting for: ' + label); await sleep(150); } }

// ---------- mock portal ----------
const SUBJ = {
  med: ['Translation of Holy Quran', 'Urdu', 'English', 'Islamic Education', 'Physics', 'Chemistry', 'Biology'],
  eng: ['Translation of Holy Quran', 'Urdu', 'English', 'Islamic Education', 'Physics', 'Chemistry', 'Mathematics'],
  ics: ['Urdu', 'English', 'Islamic Education', 'Physics', 'Computer Science', 'Mathematics'],
  icom: ['Urdu', 'English', 'Islamic Education', 'Principles of Accounting', 'Principles of Commerce', 'Business Mathematics', 'Economics'],
};
const DATA = { // roll: [profile, total, name, flag]
  710001: ['med', 526, 'AMNA BIBI'], 710002: ['med', 526, 'BILAL AHMAD'], 710003: ['med', 480, 'CHAUDHRY SANA'],
  710004: ['eng', 510, 'DAWOOD KHAN'], 710005: ['eng', 430, 'EHSAN ALI'], 710006: ['ics', 400, 'FARAH NAZ'],
  710007: ['icom', 350, 'GHULAM RASOOL'], 710009: ['med', 450, 'HINA SHAHID', 'fail'], 710010: ['med', 300, "O'NEIL <B>XSS</B> & CO"],
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let captcha = false, inertWord = false, throttle = false, throttleOnce = false; const hits = { page: 0, result: 0 };
let nowOpen = 0, peakOpen = 0;   // result requests currently being served / highest at once
function resultHtml(roll) {
  const d = DATA[roll]; if (!d) return '<p>Result not found for this roll number.</p>';
  const [prof, total, name, flag] = d, subs = SUBJ[prof], n = subs.length, base = Math.floor(total / n), rem = total - base * n;
  const rows = subs.map((s, i) => { const m = base + (i < rem ? 1 : 0), f = flag === 'fail' && i === n - 1; return `<tr><td>${s}</td><td>${m}</td><td></td><td>${(m / 85 * 100).toFixed(2)}</td><td>${f ? 'F' : 'A+'}</td><td>${f ? 'FAIL' : 'PASS'}</td></tr>`; }).join('');
  return `<p>Higher Secondary (Part-II) Annual Examination 2026</p><table><tr><td>Roll No.</td><td>${roll}</td></tr><tr><td>Name</td><td>${esc(name)}</td></tr><tr><td>Father Name</td><td>FATHER OF ${roll}</td></tr><tr><td>Institute Name</td><td>${prof === 'med' ? '201672' : '202001'}-Test College Multan</td></tr></table><table><tr><th>Subject Name</th><th>Theory</th><th>Practical</th><th>Percentile</th><th>Grade</th><th>Status</th></tr>${rows}<tr><td>Result Notification</td><td></td><td>${total}</td></tr></table>`;
}
const portal = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (u.pathname === '/result') {
    hits.result++; nowOpen++; peakOpen = Math.max(peakOpen, nowOpen); const roll = u.searchParams.get('roll');
    let finished = false; const finish = () => { if (finished) return; finished = true; nowOpen--; if (!res.writableEnded) res.end(resultHtml(roll)); };
    const timer = setTimeout(finish, roll === '770001' ? 22000 : 120);
    res.on('close', () => { if (!res.writableEnded && !finished) { clearTimeout(timer); finished = true; nowOpen--; } });
    return;
  } // 770001 answers after 22 s unless the client times out and closes it
  hits.page++;
  if (throttleOnce) { throttleOnce = false; res.statusCode = 429; return res.end('Too Many Requests'); }
  if (throttle) { res.statusCode = 429; return res.end('Too Many Requests'); }
  res.end(`<!doctype html><html><body><h3>BISE Multan Result</h3>${inertWord ? '<!-- captcha not enabled --><script>var captchaEnabled=false;</script><div style="display:none">captcha</div>' : ''}${captcha ? '<div>Please complete the CAPTCHA</div>' : ''}<label>Roll No</label> <input type="text" id="r"><button id="b">View Result</button><div id="out"></div><script>document.getElementById('b').onclick=function(){fetch('/result?roll='+document.getElementById('r').value).then(function(x){return x.text()}).then(function(h){document.getElementById('out').innerHTML=h})}</script></body></html>`);
});

// ---------- helpers ----------
const procs = [];
function startServer(port, portalUrl, dataDir, args = []) {
  const p = spawn(process.execPath, ['server.js', ...args], { cwd: __dirname, env: { ...process.env, PORT: String(port), RESULT_URL: portalUrl, DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d); procs.push(p); p.output = () => out; return p;
}
const stop = p => new Promise(r => { if (p.exitCode !== null) return r(); p.on('exit', r); p.kill('SIGTERM'); setTimeout(r, 3000); });
const waitUp = port => until(() => fetch(`http://127.0.0.1:${port}/health`).then(r => r.ok), 10000, 'server to start');
const gazette = () => ['Roll Number\tName of Candidate\tResult']
  .concat(Object.entries(DATA).map(([r, d]) => `${r}\t${d[2]}\t${r === '710005' ? 999 : d[1]}`))
  .concat(['710008\tNOT IN PORTAL\tABS', 'bad\tZ\t2', '710001\tDUPLICATE\t1']).join('\n');
let passed = 0; async function step(name, fn) { process.stdout.write('  ' + name + ' ... '); await fn(); passed++; console.log('ok'); }

(async () => {
  await new Promise(r => portal.listen(0, '127.0.0.1', r));
  const portalUrl = `http://127.0.0.1:${portal.address().port}/`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bise-e2e-')), dataDir = path.join(tmp, 'data');
  const rollsFile = path.join(tmp, 'rolls.txt'); fs.writeFileSync(rollsFile, gazette());
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const api = async (p, body) => (await fetch(base + p, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json();
  const stateIs = (...s) => async () => s.includes((await api('/api/status')).state);
  let server = startServer(port, portalUrl, dataDir), browser;
  try {
    await waitUp(port);
    browser = await chromium.launch();
    const ctx = await browser.newContext(), errors = [];
    const track = pg => { pg.on('pageerror', e => errors.push('pageerror: ' + e.message)); pg.on('dialog', d => { errors.push('unexpected dialog: ' + d.message()); d.dismiss(); }); };

    console.log('1. Web page (the original "nothing happens on Start" bug)');
    const page = await ctx.newPage(); track(page);
    await page.goto(base + '/');
    await step('page loads with no JavaScript errors', async () => { await sleep(500); assert.deepEqual(errors, []); });
    await step('choosing a file shows the preview and enables Start', async () => {
      await page.setInputFiles('#f', rollsFile);
      await page.waitForSelector('#go:not([disabled])');
      await until(async () => /10 valid, 1 invalid, 1 duplicates removed/.test(await page.textContent('#pv')), 5000, 'preview text');
    });
    await step('clicking Start runs the job to completion', async () => {
      await page.fill('#c', '1'); await page.fill('#rt', '3600'); await page.fill('#d', '0');
      await page.click('#go');
      await until(async () => /^Started:/.test(await page.textContent('#pv')), 5000, 'Started message');
      await until(async () => /State: done/.test(await page.textContent('#st')), 60000, 'job to finish');
      assert.deepEqual(errors, []);
    });
    await step('progress cards: 9 retrieved, 1 not found, 0 failed', async () => {
      await until(async () => { const t = await page.innerText('#k'); return /Retrieved\s*9/.test(t) && /Not found\s*1/.test(t) && /Failed\s*0/.test(t); }, 5000, 'progress cards');
    });
    await step('results table in the app shows the students (and escapes HTML in names)', async () => {
      await until(async () => (await page.locator('#tb tr').count()) === 9, 15000, '9 rows in app table');
      assert.equal(await page.locator('#tb b').count(), 0);
    });

    console.log('2. HTML results page (/report)');
    const rp = await ctx.newPage(); track(rp);
    await rp.goto(base + '/report'); await rp.waitForSelector('#tb tr.m');
    if (process.env.SHOT) await rp.screenshot({ path: process.env.SHOT, fullPage: true });
    await step('lists all 9 results, ranked', async () => {
      assert.equal(await rp.locator('#tb tr.m').count(), 9);
      assert.equal((await rp.locator('#tb tr.m td:first-child').allInnerTexts())[0], '1');
    });
    await step('group tab ranks ties correctly (Pre-Medical: 1,1,3,4,5)', async () => {
      await rp.click('#tabs button[data-g="Pre-Medical"]');
      assert.deepEqual(await rp.locator('#tb tr.m td:first-child').allInnerTexts(), ['1', '1', '3', '4', '5']);
    });
    await step('clicking a row shows subject-wise marks', async () => {
      await rp.click('#tb tr.m >> nth=0'); await rp.waitForSelector('#tb tr.d');
      const t = await rp.innerText('#tb tr.d'); assert(/Physics/.test(t) && /Biology/.test(t));
    });
    await step('search, college filter and marks range work', async () => {
      await rp.click('#tabs button[data-g="All"]'); await rp.fill('#q', 'dawood'); assert.equal(await rp.locator('#tb tr.m').count(), 1);
      await rp.fill('#q', ''); await rp.selectOption('#sc', '201672');
      assert.deepEqual(await rp.locator('#tb tr.m td:first-child').allInnerTexts(), ['1', '1', '3', '4', '5']);
      await rp.selectOption('#sc', ''); await rp.fill('#mn', '500'); assert.equal(await rp.locator('#tb tr.m').count(), 3);
      await rp.fill('#mn', '');
    });
    await step('names containing HTML are shown as text, never executed', async () => {
      await rp.fill('#q', 'neil'); assert.equal(await rp.locator('#tb tr.m').count(), 1);
      assert((await rp.innerText('#tb tr.m')).includes('<B>XSS</B>')); assert.equal(await rp.locator('#tb b').count(), 0);
    });
    await step('report page has no JavaScript errors', async () => assert.deepEqual(errors, []));

    console.log('3. API, downloads and parsing');
    await step('status, ranking, percentage, fail and gazette-mismatch notes are right', async () => {
      const s = await api('/api/status'); assert.equal(s.state, 'done'); assert.equal(s.ok, 9); assert.equal(s.notfound, 1); assert.equal(s.failed, 0);
      const all = (await api('/api/results?group=All')).rows, by = r => all.find(x => x.roll === r);
      assert.equal(by('710001').percentage, 94.77); assert.equal(by('710001').group, 'Pre-Medical'); assert.equal(by('710004').group, 'Pre-Engineering');
      assert.equal(by('710006').group, 'ICS'); assert.equal(by('710007').group, 'I.Com'); assert.equal(by('710009').result, 'Fail');
      assert(/GAZETTE total 999 differs/.test(by('710005').note)); assert.equal(by('710001').note, '');
    });
    await step('CSV and HTML downloads work and escape names', async () => {
      const buf = Buffer.from(await (await fetch(base + '/download/Overall_Ranking.csv')).arrayBuffer());   // raw bytes: fetch().text() would strip the BOM
      assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'CSV should start with a UTF-8 BOM so Excel reads names correctly');
      const lines = buf.toString('utf8').replace(/^\uFEFF/, '').trim().split('\r\n');
      assert(lines[0].startsWith('rank,roll,name'), 'header: ' + lines[0]); assert.equal(lines.length, 10, 'header + 9 students, got ' + lines.length);
      const r = await fetch(base + '/download/BISE_Multan_Results.html'); const h = await r.text();
      assert(/attachment/.test(r.headers.get('content-disposition'))); assert(h.includes('CHAUDHRY SANA') && !h.includes('<B>XSS</B>'));
      assert((await api('/api/files')).includes('BISE_Multan_Results.html'));
    });
    await step('group check page lists every group that was fetched (not just one)', async () => {
      const j = await api('/api/subject-sets'); for (const g of ['Pre-Medical', 'Pre-Engineering', 'ICS', 'I.Com']) assert(j.groups[g] > 0, 'missing group ' + g);
      assert.equal(Object.values(j.groups).reduce((a, b) => a + b, 0), 9);
      const h = await (await fetch(base + '/groupcheck')).text(); assert(h.includes('Pre-Engineering') && h.includes('Biology') && !h.includes('<B>'));
    });
    await step('all Multan-board districts and towns are options; district filter narrows the table', async () => {
      const ds = await api('/api/districts'); assert.deepEqual(ds.map(x => x.district), ['Multan', 'Khanewal', 'Lodhran', 'Vehari', 'none']);
      assert.equal(ds.find(x => x.district === 'Multan').count, 9); assert.equal(ds.find(x => x.district === 'Vehari').count, 0);
      const cs = await api('/api/cities'); assert(cs.length >= 17 && cs.some(c => c.city === 'Burewala' && c.count === 0 && c.district === 'Vehari') && cs.find(c => c.city === 'Multan').count === 9);
      assert.equal((await api('/api/results?group=All&district=Multan&page=1')).n, 9); assert.equal((await api('/api/results?group=All&district=Vehari&page=1')).n, 0);
      assert.equal((await api('/api/results?group=All&district=none&page=1')).n, 0); assert.equal((await api('/api/results?group=All&city=Multan&page=1')).n, 9);
      const rep = await (await fetch(base + '/report')).text(); assert(rep.includes('id="sd"') && rep.includes('"district":"Multan"'));
    });

    console.log('4. Saved data and restart');
    await step('re-uploading a processed list makes no new portal requests', async () => {
      const before = hits.result, r = await api('/api/start', { name: 'again', text: gazette() });
      assert.equal(r.cached, true); assert.equal(hits.result, before);
    });
    await step('after a server restart the results are still there and still not refetched', async () => {
      await stop(server); server = startServer(port, portalUrl, dataDir); await waitUp(port);
      assert.equal((await api('/api/status')).ok, 9);
      const before = hits.result, r = await api('/api/start', { name: 'again', text: gazette() });
      assert.equal(r.cached, true); assert.equal(hits.result, before);
    });

    console.log('5. Pause / resume / cancel');
    await step('state changes work, and cancel stops promptly even with a slow rate limit', async () => {
      const r = await api('/api/start', { name: 'ctl', text: '720001\n720002\n720003\n720004', rate: 600, conc: 2, delay: 0 }); assert.equal(r.valid, 4);
      await until(stateIs('running'), 5000, 'running');
      assert.equal((await api('/api/pause', {})).state, 'paused'); assert.equal((await api('/api/resume', {})).state, 'running');
      assert.equal((await api('/api/cancel', {})).state, 'cancelled');
      await until(async () => (await api('/api/status')).log.some(l => /Job cancelled/.test(l)), 8000, 'job to wind down');
    });
    await step('default speed is one request start per 10 seconds, hard cap 360/h and 1 tab', async () => {
      const r = await api('/api/start', { name: 'defaults', text: '780001\n780002\n780003' }); assert.equal(r.valid, 3);
      await until(async () => (await api('/api/status')).rateNow === 360, 5000, 'default rate of 360/hour');
      await api('/api/cancel', {}); await until(async () => (await api('/api/status')).log.some(l => /Job cancelled/.test(l)), 8000, 'job to wind down');
    });

    console.log('6. Captcha safety');
    await step('job STOPS when a captcha appears (no bypass attempted)', async () => {
      captcha = true; await api('/api/start', { name: 'cap', text: '730001\n730002', rate: 3600, conc: 1, delay: 0 });
      await until(stateIs('blocked'), 20000, 'blocked state'); await until(async () => (await api('/api/status')).log.some(l => /Job blocked/.test(l)), 10000, 'job to wind down');
      assert((await api('/api/status')).log.some(l => /STOPPED.*not bypassing/.test(l))); captcha = false;
    });


    console.log('6b. Fewer false alarms and refusal handling');
    await step('the word "captcha" hidden in page source does NOT stop the job', async () => {
      inertWord = true; const r = await api('/api/start', { name: 'inert', text: '740001\n740002', rate: 3600, conc: 1, delay: 0 }); assert.equal(r.valid, 2);
      await until(stateIs('done'), 20000, 'job to finish'); inertWord = false;
      assert.notEqual((await api('/api/status')).state, 'blocked');
    });
    await step('HTTP 429 stops immediately without retries or identity changes', async () => {
      throttle = true; const before = hits.page; const rolls = Array.from({ length: 12 }, (_, i) => 750001 + i).join('\n');
      await api('/api/start', { name: 'thr', text: rolls, rate: 9000, conc: 1, delay: 0, retries: 1 });
      await until(stateIs('blocked'), 20000, 'blocked after first 429'); await until(async () => (await api('/api/status')).log.some(l => /Job blocked/.test(l)), 10000, 'job to wind down');
      const lg = (await api('/api/status')).log; throttle = false;
      assert(lg.some(l => /STOPPED:.*429.*No retry attempted/.test(l)));
      assert(hits.page - before === 1, 'it should stop after the first refused request; got ' + (hits.page - before));
    });
    await step('a one-time HTTP 429 still stops the job instead of retrying or ramping up', async () => {
      throttleOnce = true; const before = hits.page;
      await api('/api/start', { name: 'one-throttle', text: '760001\n760002', rate: 3600, conc: 1, delay: 0 });
      await until(stateIs('blocked'), 20000, 'blocked after one 429');
      const st = await api('/api/status');
      assert(st.log.some(l => /No retry attempted/.test(l)));
      assert.equal(hits.page - before, 1);
    });

    await step('a lookup exceeding the timeout is closed and the next roll uses a fresh tab, without parallel lookups', async () => {
      peakOpen = 0; await api('/api/start', { name: 'slow', text: '770001\n770002\n770003\n770004', rate: 3600, conc: 3, delay: 0 });
      await until(stateIs('done'), 20000, 'slow lookup to time out and the remaining rolls to finish'); const st = await api('/api/status');
      assert.equal(st.failed, 1); assert.equal(st.notfound, 3);
      assert(st.log.some(l => /timed out after 3 seconds.*skipped/i.test(l)), 'should record timeout and skip');
      assert.equal(peakOpen, 1, 'only one mock result request should be active at once; peak was ' + peakOpen);
      assert(st.tabsOpened >= 4);
    });

    console.log('7. Background mode (no browser)');
    await step('node server.js --file rolls.txt --numeric ... runs by itself', async () => {
      const p2 = await freePort(), s2 = startServer(p2, portalUrl, path.join(tmp, 'data2'), ['--file', rollsFile, '--numeric', '--rate', '3600', '--delay', '0']);
      await waitUp(p2);
      const st = () => fetch(`http://127.0.0.1:${p2}/api/status`).then(r => r.json());
      await until(async () => (await st()).state === 'done', 60000, 'background job'); const s = await st();
      assert.equal(s.ok, 9); assert.equal(s.total, 9); assert(s.tabsOpened >= 9, 'each lookup should open its own tab, got ' + s.tabsOpened); assert(/Background job started/.test(s2.output())); await stop(s2);
    });
    console.log(`\nAll ${passed} end-to-end checks passed`);
  } catch (e) {
    console.error('\nFAILED:', e.message); process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const p of procs) p.kill('SIGKILL'); portal.close(); fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode || 0), 100);
  }
})();
