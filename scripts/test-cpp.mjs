import { mkdir, rm, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(root, ".test-build");
await rm(build, { recursive: true, force: true });
await mkdir(build, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || "");
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}
run("clang", ["-std=c11", "-O2", "-c", "src/dsp/dsp_core.c", "-o", path.join(build, "dsp_core.o")]);
run("clang++", ["-std=c++20", "tests/cpp/test_dsp_core.cpp", path.join(build, "dsp_core.o"), "-o", path.join(build, "test_dsp_core")]);
run(path.join(build, "test_dsp_core"), []);
run("clang++", ["-std=c++20", "-Isrc", "tests/cpp/test_radio_contract.cpp", "src/web/web_radio_device.cpp", "-o", path.join(build, "test_radio_contract")]);
run(path.join(build, "test_radio_contract"), []);
run("clang++", ["-std=c++20", "-Isrc", "tests/cpp/test_ui_primitives.cpp", "src/mayhem/ui.cpp", "-o", path.join(build, "test_ui_primitives")]);
run(path.join(build, "test_ui_primitives"), []);
const generatedApps = (await readdir(path.join(root, "src", "generated_apps"))).filter((name) => name.endsWith(".cpp")).sort().map((name) => path.join("src", "generated_apps", name));
run("clang++", ["-std=c++20", "-Isrc", "tests/cpp/test_mayhem_registry.cpp", "src/mayhem/app_registry.cpp", ...generatedApps, "-o", path.join(build, "test_mayhem_registry")]);
run(path.join(build, "test_mayhem_registry"), []);
console.log("C and C++ tests passed, including upstream-shaped UI primitives and native Registrar registry.");
