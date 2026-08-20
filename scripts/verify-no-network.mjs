import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const target = path.resolve(process.argv[2] || "dist");
const runtimeExtensions = new Set([".html", ".js", ".mjs", ".css", ".webmanifest"]);
const failures = [];

async function walk(directory) {
  for (const name of await readdir(directory)) {
    const absolute = path.join(directory, name);
    const info = await stat(absolute);
    if (info.isDirectory()) await walk(absolute);
    else if (runtimeExtensions.has(path.extname(name).toLowerCase())) {
      const text = await readFile(absolute, "utf8");
      const relative = path.relative(target, absolute);
      if (/\bhttps?:\/\//i.test(text)) failures.push(`${relative}: remote URL literal`);
      if (/\b(?:fetch|import)\s*\(\s*["']\/\//i.test(text)) failures.push(`${relative}: protocol-relative runtime request`);
      if (/connect-src(?![^;]*'self')/i.test(text)) failures.push(`${relative}: Content Security Policy connect-src is not same-origin`);
      if (/googletagmanager|google-analytics|segment\.com|mixpanel|sentry\.io/i.test(text)) failures.push(`${relative}: analytics software marker`);
    }
  }
}
await walk(target);
if (failures.length) {
  console.error("Outbound-runtime audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Outbound-runtime audit passed for ${target}: no remote runtime URL literals or permissive connection policy found.`);
