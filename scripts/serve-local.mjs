import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serveRoot = path.resolve(root, process.argv[2] || "dist");
const port = Number(process.env.PORT || process.argv[3] || 4173);
const types = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".webmanifest", "application/manifest+json"],
  [".wasm", "application/wasm"], [".svg", "image/svg+xml"], [".md", "text/markdown; charset=utf-8"], [".txt", "text/plain; charset=utf-8"]
]);

function headers(contentType) {
  return {
    "Content-Type": contentType,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "usb=(self), camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-cache"
  };
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const candidate = path.resolve(serveRoot, `.${pathname}`);
    if (!candidate.startsWith(`${serveRoot}${path.sep}`) && candidate !== serveRoot) throw new Error("Path traversal rejected");
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(candidate);
    response.writeHead(200, headers(types.get(path.extname(candidate).toLowerCase()) || "application/octet-stream"));
    response.end(body);
  } catch {
    response.writeHead(404, headers("text/plain; charset=utf-8"));
    response.end("Not found\n");
  }
});

server.listen(port, "127.0.0.1", () => console.log(`MAYHEM RTL: http://127.0.0.1:${port}/`));
