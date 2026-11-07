const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DASHBOARD_DIR = path.join(__dirname, 'dashboard');
const DEPLOYMENT_FILE = path.join(__dirname, 'docs', 'DEPLOYED_ADDRESSES.json');
const CONTRACT_NAMES = new Set([
  'EnergyToken',
  'SmartMeterRegistry',
  'GridTariffManager',
  'EnergyTradingPlatform',
  'CommunityBatteryManager'
]);
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');

  if (requestUrl.pathname === '/api/rpc' && req.method === 'POST') {
    const chunks = [];
    let bodySize = 0;
    req.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'JSON-RPC request exceeds 1 MB' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      const rpcRequest = http.request({
        hostname: '127.0.0.1',
        port: 8545,
        method: 'POST',
        path: '/',
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'Content-Length': bodySize
        }
      }, (rpcResponse) => {
        res.writeHead(rpcResponse.statusCode || 502, {
          'Content-Type': rpcResponse.headers['content-type'] || 'application/json'
        });
        rpcResponse.pipe(res);
      });
      rpcRequest.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        }
        res.end(JSON.stringify({ error: 'Local Hardhat node is not running on port 8545' }));
      });
      rpcRequest.end(Buffer.concat(chunks));
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/api/deployment') {
    fs.readFile(DEPLOYMENT_FILE, 'utf8', (error, contents) => {
      if (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: error.code === 'ENOENT' ? 'No contracts have been deployed yet.' : 'Unable to read deployment information.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(contents);
    });
    return;
  }

  const abiMatch = req.method === 'GET' && requestUrl.pathname.match(/^\/api\/abi\/([A-Za-z]+)$/);
  if (abiMatch && CONTRACT_NAMES.has(abiMatch[1])) {
    const artifactPath = path.join(__dirname, 'artifacts', 'contracts', abiMatch[1] + '.sol', abiMatch[1] + '.json');
    fs.readFile(artifactPath, 'utf8', (error, contents) => {
      if (error) {
        res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Compile contracts before starting the dashboard.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ abi: JSON.parse(contents).abi }));
    });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/vendor/ethers.umd.min.js') {
    const ethersBundle = path.join(__dirname, 'node_modules', 'ethers', 'dist', 'ethers.umd.min.js');
    fs.readFile(ethersBundle, (error, data) => {
      if (error) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Ethers.js is unavailable. Run npm install in the project directory.');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data);
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Allow': 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Invalid request path');
    return;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(DASHBOARD_DIR, '.' + requestedPath);
  const relativePath = path.relative(DASHBOARD_DIR, filePath);
  if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error loading dashboard resource');
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Solar P2P Dashboard running at http://localhost:${PORT}`);
});
