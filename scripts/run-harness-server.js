#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const path = require("path");

const root = path.resolve(__dirname, "..");
const defaultPort = 4173;

function main() {
  const port = parsePort(process.argv.slice(2)) || defaultPort;
  const server = http.createServer((request, response) => {
    const safeUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    const pathname = decodeURIComponent(safeUrl.pathname === "/" ? "/fixtures/content-harness.html" : safeUrl.pathname);
    const filePath = path.resolve(root, `.${pathname}`);

    if (!filePath.startsWith(root)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    fs.stat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      response.writeHead(200, {
        "Content-Type": `${getContentType(filePath)}; charset=utf-8`,
        "Cache-Control": "no-store",
      });
      fs.createReadStream(filePath).pipe(response);
    });
  });

  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/fixtures/content-harness.html?sid=fixture-session`;
    console.log(`[harness] serving ${root}`);
    console.log(`[harness] open ${url}`);
    console.log("[harness] press Ctrl+C to stop");
  });
}

function parsePort(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--port") {
      const parsed = Number(args[index + 1] || "");
      return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultPort;
    }
  }
  return defaultPort;
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html";
  if (extension === ".js") return "application/javascript";
  if (extension === ".css") return "text/css";
  if (extension === ".json") return "application/json";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return "text/plain";
}

main();
