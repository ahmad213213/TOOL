// Headed-mode test: a mock portal shows a captcha; the job must WAIT (not bypass), then resume once a "human" solves it.
// Needs a display (on a headless Linux box: xvfb-run -a node test-headed.js)
const http = require('http'), os = require('os'), fs = require('fs'), path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let solved = false, hits = 0;
const portal = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (u.pathname === '/status') return res.end(solved ? 'ok' : 'no');
  if (u.pathname === '/result') { hits++; return res.end('<table><tr><td>Roll No.</td><td>' + u.searchParams.get('roll') + '</td></tr><tr><td>Name</td><td>TEST STUDENT</td></tr><tr><td>Institute Name</td><td>1-Test College</td></tr></table><table><tr><th>Subject Name</th></tr><tr><td>Physics</td><td>70</td><td></td><td>82.35</td><td>A</td><td>PASS</td></tr><tr><td>Chemistry</td><td>70</td><td></td><td>82.35</td><td>A</td><td>PASS</td></tr><tr><td>Biology</td><td>70</td><td></td><td>82.35</td><td>A</td><td>PASS</td></tr><tr><td>Result Notification</td><td></td><td>210</td></tr></table>'); }
  res.end(`<!doctype html><body><div id="cap" style="${solved ? 'display:none' : ''}">Please complete the CAPTCHA</div><input type="text" id="r"><button id="b">View Result</button><div id="out"></div><script>
  var iv=setInterval(function(){fetch('/status').then(function(x){return x.text()}).then(function(t){if(t==='ok'){var c=document.getElementById('cap');if(c)c.remove();clearInterval(iv)}})},300);
  document.getElementById('b').onclick=function(){fetch('/result?roll='+document.getElementById('r').value).then(function(x){return x.text()}).then(function(h){document.getElementById('out').innerHTML=h})}</script></body>`);
});
(async () => {
  await new Promise(r => portal.listen(0, '127.0.0.1', r));
  const port = 3900 + Math.floor(Math.random() * 90), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bise-h-'));
  const p = spawn(process.execPath, ['server.js', '--headed'], { cwd: __dirname, env: { ...process.env, MAX_RATE: '20000', MAX_TABS: '8', PORT: String(port), DATA_DIR: dir, RESULT_URL: `http://127.0.0.1:${portal.address().port}/` }, stdio: 'ignore' });
  const api = async (u, b) => (await fetch(`http://127.0.0.1:${port}${u}`, b === undefined ? {} : { method: 'POST', body: JSON.stringify(b) })).json();
  try {
    for (let i = 0; i < 50; i++) { try { await api('/health'); break; } catch { await sleep(200); } }
    await api('/api/start', { name: 't', text: '810001\n810002', rate: 3600, delay: 0 });
    let waiting = false; for (let i = 0; i < 60 && !waiting; i++) { await sleep(250); waiting = (await api('/api/status')).verify === true; }
    assert(waiting, 'job should wait for a human while the captcha is showing');
    await sleep(1500); assert.equal(hits, 0, 'no portal lookups may happen while the captcha is unsolved');
    solved = true;   // the "human" solves it
    let st; for (let i = 0; i < 80; i++) { await sleep(250); st = await api('/api/status'); if (st.state === 'done') break; }
    assert.equal(st.state, 'done'); assert.equal(st.ok, 2); console.log('headed captcha-wait test passed');
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
  finally { p.kill('SIGTERM'); portal.close(); setTimeout(() => process.exit(), 300); }
})();
