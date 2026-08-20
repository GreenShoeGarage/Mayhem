import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

test("user-facing version has one package source of truth", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const config = await readFile(path.join(root, "web/src/config.js"), "utf8");
  const cmake = await readFile(path.join(root, "CMakeLists.txt"), "utf8");
  assert.match(config, new RegExp(`APP_VERSION = ["']${pkg.version.replaceAll('.', '\\.')}`));
  assert.match(cmake, new RegExp(`VERSION ${pkg.version.replaceAll('.', '\\.')}`));
  const index = await readFile(path.join(root, "web/index.html"), "utf8");
  assert.ok(!index.includes("v0.1.0") && !index.includes("v0.2.0"));
  assert.ok(index.includes("v__APP_VERSION__"));
});

test("service worker does not serve stale JavaScript version-first", async () => {
  const sw = await readFile(path.join(root, "web/service-worker.js"), "utf8");
  assert.match(sw, /cache: "no-store"/);
  assert.match(sw, /versionSensitive/);
  assert.ok(sw.includes("mayhem-rtl-v__APP_VERSION__"));
});
