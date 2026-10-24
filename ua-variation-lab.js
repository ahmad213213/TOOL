// Educational User-Agent variation demo.
// SAFETY: this script binds only to 127.0.0.1 and sends requests only to its own local mock server.
// The live BISE extractor intentionally keeps a single transparent User-Agent.
const http = require('http');

const sampleAgents = [
  'UA-Lab/1.0 (demo client A)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/129.0.0.0 Mobile Safari/537.36',
];

async function main() {
  const server = http.createServer((req, res) => {
    const ua = req.headers['user-agent'] || '(none)';
    console.log('Local mock server received User-Agent:', ua);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Recorded locally: ' + ua);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/ua-demo`;
  try {
    for (let i = 0; i < sampleAgents.length; i++) {
      const response = await fetch(url, { headers: { 'User-Agent': sampleAgents[i] } });
      console.log(`${i + 1}. ${await response.text()}`);
    }
    console.log('\nDone. All requests were sent only to this machine; no external site or IP rotation was used.');
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
