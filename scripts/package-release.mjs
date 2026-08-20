import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const release = path.join(root, "release");
await mkdir(release, { recursive: true });
const build = spawnSync(process.execPath, [path.join(root, "scripts", "build.mjs")], { cwd: root, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);
const distZip = path.join(release, `MAYHEM-RTL-v${version}-dist.zip`);
const sourceZip = path.join(release, `MAYHEM-RTL-v${version}-source-and-dist.zip`);
await rm(distZip, { force: true }); await rm(sourceZip, { force: true });
function zip(args) { const result = spawnSync("zip", args, { cwd: root, stdio: "inherit" }); if (result.status !== 0) process.exit(result.status ?? 1); }
zip(["-q", "-r", distZip, "dist"]);
zip(["-q", "-r", sourceZip, ".", "-x", "./release/*", "./.test-build/*", "./.git/*", "./node_modules/*"]);
const checksumPath = path.join(release, "SHA256SUMS.txt");
const checksumLines = [];
for (const archive of [distZip, sourceZip]) {
  const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
  checksumLines.push(`${digest}  ${path.basename(archive)}`);
}
await writeFile(checksumPath, `${checksumLines.join("\n")}\n`);
console.log(distZip); console.log(sourceZip); console.log(checksumPath);
