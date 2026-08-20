const CATEGORY_NAMES = Object.freeze(["Home", "Receive", "Transmit", "Transceiver", "Utilities", "Games", "Settings", "Debug"]);

export const MayhemKey = Object.freeze({
  RIGHT: 0,
  LEFT: 1,
  DOWN: 2,
  UP: 3,
  SELECT: 4,
  BACK: 6
});

export class MayhemCoreBridge {
  constructor() {
    this.instance = null;
    this.memory = null;
    this.ready = false;
    this.registry = [];
    this.registryIds = [];
    this.registryHash = 0;
  }

  async init(url = "./assets/mayhem_core.wasm") {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Mayhem core WebAssembly failed to load (${response.status}).`);
    const result = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    this.instance = result.instance;
    this.memory = this.instance.exports.memory;
    // The freestanding core links native file-scope app::Registrar objects. With no
    // WebAssembly start function we invoke static constructors explicitly once.
    this.instance.exports.__wasm_call_ctors?.();
    this.ready = true;
    this.registry = this.readRegistry();
    this.registryIds = this.registry.map((entry) => entry.id);
    this.registryHash = this.instance.exports.mayhem_core_registry_hash();
    this.instance.exports.mayhem_core_render();
    return this;
  }

  readString(ptr, len) {
    if (!ptr || !len) return "";
    return new TextDecoder().decode(new Uint8Array(this.memory.buffer, ptr, len));
  }

  readRegistry() {
    const ex = this.instance.exports;
    const entries = [];
    for (let i = 0; i < ex.mayhem_core_app_count(); i += 1) {
      const category = ex.mayhem_core_app_category(i);
      entries.push({
        index: i,
        id: this.readString(ex.mayhem_core_app_id_ptr(i), ex.mayhem_core_app_id_len(i)),
        name: this.readString(ex.mayhem_core_app_name_ptr(i), ex.mayhem_core_app_name_len(i)),
        category,
        categoryName: CATEGORY_NAMES[category] || "Unknown",
        flags: ex.mayhem_core_app_flags(i)
      });
    }
    return entries;
  }

  update({ frequencyHz, sampleRate, levelDbfs, connection, source, gainDb = null, dropped = 0, errors = 0, tuner = "" }) {
    if (!this.ready) return;
    const state = connection === "RECEIVING" ? 2 : connection === "CONNECTED_IDLE" ? 1 : 0;
    const sourceKind = source === "live" ? 1 : source === "simulation" ? 2 : source === "replay" ? 3 : 0;
    this.instance.exports.mayhem_core_set_source(sourceKind);
    this.instance.exports.mayhem_core_set_receiver(
      Math.max(0, Math.round(frequencyHz || 0)),
      Math.max(0, Math.round(sampleRate || 0)),
      Number.isFinite(levelDbfs) ? Math.round(levelDbfs * 10) : -900,
      state
    );
    const tunerText = String(tuner || "").toLowerCase();
    const tunerCode = source === "simulation" ? 3 : source === "replay" ? 4 : tunerText.includes("r828") ? 2 : tunerText.includes("r820") || tunerText.includes("r860") || tunerText.includes("r8xx") ? 1 : 0;
    this.instance.exports.mayhem_core_set_radio_details?.(
      Number.isFinite(gainDb) ? Math.round(gainDb * 10) : 0,
      gainDb == null ? 1 : 0,
      Math.max(0, Math.round(dropped || 0)),
      Math.max(0, Math.round(errors || 0)),
      tunerCode
    );
    this.instance.exports.mayhem_core_render();
  }

  inputKey(key) {
    if (!this.ready) return null;
    this.instance.exports.mayhem_core_input_key(key);
    return this.takeActivation();
  }

  inputEncoder(delta) {
    if (!this.ready || !delta) return null;
    this.instance.exports.mayhem_core_input_encoder(delta);
    return this.takeActivation();
  }

  inputPointer(x, y, type = 2) {
    if (!this.ready) return null;
    this.instance.exports.mayhem_core_input_pointer(Math.round(x), Math.round(y), type);
    return this.takeActivation();
  }

  takeActivation() {
    if (!this.ready) return null;
    const value = this.instance.exports.mayhem_core_take_activation();
    if (!value) return null;
    return this.registry[value - 1] || null;
  }

  navigationState() {
    if (!this.ready) return { depth: 0, selectedIndex: 0 };
    return {
      depth: this.instance.exports.mayhem_core_nav_depth(),
      selectedIndex: this.instance.exports.mayhem_core_selected_index(),
      lastActivatedIndex: this.instance.exports.mayhem_core_last_activated_app()
    };
  }

  rgbaFrame() {
    if (!this.ready) return null;
    const ex = this.instance.exports;
    const width = ex.mayhem_core_width();
    const height = ex.mayhem_core_height();
    const ptr = ex.mayhem_core_framebuffer_ptr();
    const src = new Uint16Array(this.memory.buffer, ptr, width * height);
    const out = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < src.length; i += 1, j += 4) {
      const v = src[i];
      out[j] = ((v >> 11) & 0x1f) * 255 / 31;
      out[j + 1] = ((v >> 5) & 0x3f) * 255 / 63;
      out[j + 2] = (v & 0x1f) * 255 / 31;
      out[j + 3] = 255;
    }
    return new ImageData(out, width, height);
  }
}
