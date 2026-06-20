const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 7999);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid PORT value: ${process.env.PORT}`);
  process.exit(1);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const safePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const requestedPath = path.resolve(rootDir, safePath || 'index.html');
  const filePath = requestedPath.startsWith(rootDir) ? requestedPath : path.join(rootDir, 'index.html');

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(rootDir, 'index.html'), (fallbackError, fallbackContent) => {
        if (fallbackError) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Not found');
          return;
        }

        response.writeHead(200, { 'content-type': mimeTypes['.html'] });
        response.end(fallbackContent);
      });
      return;
    }

    response.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  });
});

server.listen(port, () => {
  console.log(`Berry FFLogs Analyzers running at http://localhost:${port}/`);
});
