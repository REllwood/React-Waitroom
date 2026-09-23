import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = resolve(repositoryRoot, "public");
const sourceRoot = resolve(repositoryRoot, "src");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const host = process.env.HOST ?? "127.0.0.1";

const mediaTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function safeFile(root, relativePath) {
  const candidate = resolve(root, `.${sep}${relativePath}`);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : undefined;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
    const decodedPath = decodeURIComponent(url.pathname);
    const sourceRequest = decodedPath.startsWith("/src/");
    const relativePath = sourceRequest
      ? decodedPath.slice("/src/".length)
      : decodedPath === "/"
        ? "index.html"
        : decodedPath.slice(1);
    const filePath = safeFile(sourceRequest ? sourceRoot : publicRoot, relativePath);
    if (!filePath) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Invalid path");
      return;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mediaTypes[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(body);
  } catch (error) {
    const status = error && typeof error === "object" && error.code === "ENOENT" ? 404 : 500;
    response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    response.end(status === 404 ? "Not found" : "Server error");
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`React Waitroom listening at http://${host}:${actualPort}`);
});

function shutdown() {
  server.close((error) => {
    process.exitCode = error ? 1 : 0;
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
