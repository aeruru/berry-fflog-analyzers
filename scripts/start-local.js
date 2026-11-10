const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const rootDirectory = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 7999);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid PORT value: ${process.env.PORT}`);
  process.exit(1);
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
  const requestedPath = path.resolve(rootDirectory, relativePath);
  const isInsideRoot = requestedPath === rootDirectory
    || requestedPath.startsWith(`${rootDirectory}${path.sep}`);

  // Resolving before this check prevents encoded parent paths from exposing files outside
  // the project when this intentionally small server handles local development requests.
  if (!isInsideRoot) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  fs.readFile(requestedPath, (error, content) => {
    if (error) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': contentTypes[path.extname(requestedPath).toLowerCase()] || 'application/octet-stream',
    });
    response.end(content);
  });
});

function isBerryServerAlreadyRunning() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/`, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 64_000) request.destroy();
      });
      response.on('end', () => resolve(body.includes('Berry FFLogs Companion')));
    });
    request.setTimeout(1_500, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

server.on('error', async (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  if (await isBerryServerAlreadyRunning()) {
    console.log(`Berry FFLogs Analyzers is already running at http://127.0.0.1:${port}/`);
    process.exitCode = 0;
    return;
  }
  console.error(`Port ${port} is already being used by another application.`);
  console.error(`Close that application or start Berry with a different port, for example: $env:PORT=8000; npm start`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Berry FFLogs Analyzers running at http://127.0.0.1:${port}/`);
});

