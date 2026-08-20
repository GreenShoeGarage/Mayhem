import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { APPLICATIONS } from "../../web/src/apps/compatibility-manifest.js";

async function loadCore() {
  const bytes = await readFile("dist/assets/mayhem_core.wasm");
  const instance = (await WebAssembly.instantiate(bytes, {})).instance;
  instance.exports.__wasm_call_ctors?.();
  return instance;
}

function readString(core, ptr, len) {
  return new TextDecoder().decode(new Uint8Array(core.exports.memory.buffer, ptr, len));
}

function coreRegistry(core) {
  const out = [];
  for (let i = 0; i < core.exports.mayhem_core_app_count(); i += 1) {
    out.push({
      id: readString(core, core.exports.mayhem_core_app_id_ptr(i), core.exports.mayhem_core_app_id_len(i)),
      name: readString(core, core.exports.mayhem_core_app_name_ptr(i), core.exports.mayhem_core_app_name_len(i)),
      category: core.exports.mayhem_core_app_category(i),
      flags: core.exports.mayhem_core_app_flags(i)
    });
  }
  return out;
}

test("Mayhem core owns a 240x320 framebuffer and paints its UI in WebAssembly", async () => {
  const core = await loadCore();
  assert.equal(core.exports.mayhem_core_width(), 240);
  assert.equal(core.exports.mayhem_core_height(), 320);
  assert.equal(core.exports.mayhem_core_app_count(), APPLICATIONS.length);
  const ptr = core.exports.mayhem_core_framebuffer_ptr();
  assert.ok(ptr > 0);
  core.exports.mayhem_core_render();
  const pixels = new Uint16Array(core.exports.memory.buffer, ptr, 240 * 320);
  assert.ok(pixels.some((value) => value !== 0));
  assert.ok(new Set(pixels).size > 5, "the core should paint more than a placeholder block palette");
});

test("Mayhem core registry metadata matches the shell registry order", async () => {
  const core = await loadCore();
  const registry = coreRegistry(core);
  assert.deepEqual(registry.map((entry) => entry.id), APPLICATIONS.map((entry) => entry.id));
  assert.equal(registry[0].name, "Spectrum");
  assert.equal(registry.find((entry) => entry.id === "jammer").category, 2);
  assert.ok(registry.find((entry) => entry.id === "jammer").flags & 4, "transmit app must carry TX flag");
  assert.notEqual(core.exports.mayhem_core_registry_hash(), 0);
});

test("Mayhem core category navigation emits application activation through the registry", async () => {
  const core = await loadCore();
  core.exports.mayhem_core_render();
  assert.equal(core.exports.mayhem_core_nav_depth(), 0);
  assert.equal(core.exports.mayhem_core_selected_index(), 0);

  // ui::KeyEvent::Select = 4: HOME/Receive -> Receive category.
  core.exports.mayhem_core_input_key(4);
  assert.equal(core.exports.mayhem_core_nav_depth(), 1);
  assert.equal(core.exports.mayhem_core_selected_index(), 0);

  // Select the first Receive app, Spectrum. the core pushes an actual application
  // frame before emitting the browser activation event.
  core.exports.mayhem_core_input_key(4);
  assert.equal(core.exports.mayhem_core_nav_depth(), 2);
  const activation = core.exports.mayhem_core_take_activation();
  assert.equal(activation, 1);
  assert.equal(core.exports.mayhem_core_take_activation(), 0, "activation is consumable exactly once");

  // ui::KeyEvent::Back = 6 pops app -> category -> home.
  core.exports.mayhem_core_input_key(6);
  assert.equal(core.exports.mayhem_core_nav_depth(), 1);
  core.exports.mayhem_core_input_key(6);
  assert.equal(core.exports.mayhem_core_nav_depth(), 0);
});

test("browser framebuffer is only a presenter/input adapter after core linkage", async () => {
  const source = await readFile("web/src/panels/mayhem-framebuffer.js", "utf8");
  assert.ok(!source.includes("drawBrowserStatusOverlay"));
  assert.match(source, /core\.inputKey/);
  assert.match(source, /core\.inputEncoder/);
  assert.match(source, /core\.inputPointer/);
  assert.match(source, /dispatchEvent\(new CustomEvent\("activate"/);
});

test("browser and WebAssembly registries are generated from one source manifest", async () => {
  const registrySource = JSON.parse(await readFile("src/app_registry.json", "utf8"));
  const generatedJs = await readFile("web/src/apps/generated-registry.js", "utf8");
  const generatedSummary = await readFile("src/generated_app_registry.inc", "utf8");
  for (let i = 0; i < registrySource.length; i += 1) {
    const entry = registrySource[i];
    assert.match(generatedJs, new RegExp(`\"id\": \"${entry.id}\"`));
    assert.match(generatedSummary, new RegExp(`${String(i).padStart(2, "0")} ${entry.id}`));
    const generatedApp = await readFile(`src/generated_apps/${String(i).padStart(2, "0")}-${entry.id}.cpp`, "utf8");
    assert.match(generatedApp, /const app::Registrar registrar/);
    assert.match(generatedApp, new RegExp(`kId\\[\\] = \"${entry.id}\"`));
  }
  const coreBridge = await readFile("src/core_mayhem_bridge.cpp", "utf8");
  assert.ok(!coreBridge.includes("generated_app_registry.inc"), "core bridge must consume AppRegistry, not a compiled table");
});


test("v0.8 Mayhem core accepts actual browser radio details", async () => {
  const core = await loadCore();
  core.exports.mayhem_core_set_source(1);
  core.exports.mayhem_core_set_receiver(99_900_000, 2_400_000, -123, 2);
  core.exports.mayhem_core_set_radio_details(280, 0, 7, 2, 1);
  core.exports.mayhem_core_render();
  assert.equal(core.exports.mayhem_core_width(), 240);
  assert.ok(core.exports.mayhem_core_framebuffer_ptr() > 0);
});

test("v0.8 Mayhem core remains a self-contained static WebAssembly asset", async () => {
  const bytes = await readFile("dist/assets/mayhem_core.wasm");
  const module = await WebAssembly.compile(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const instance = await WebAssembly.instantiate(module, {});
  assert.equal(typeof instance.exports.__wasm_call_ctors, "function");
  instance.exports.__wasm_call_ctors();
  assert.equal(instance.exports.mayhem_core_app_count(), APPLICATIONS.length);
});
