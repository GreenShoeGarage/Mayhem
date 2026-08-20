# Changelog

## 0.7.0 — 2026-08-20

- Closed the v0.6 reference-hardware validation gate: recorded successful on-air WFM/NFM/AM audio, AudioContext lifecycle, 2.4 Msps / 60-minute reception, 2.4 Msps receive+capture, SharedArrayBuffer streaming, sustained audio, and bounded long-run memory/queue behavior on the reference `RTL2838UHIDIR` setup.
- Replaced the monolithic Mayhem WebAssembly core implementation with modular C++ runtime layers under `src/mayhem/`.
- Added upstream-shaped UI geometry, RGB565 Color packing, 8 × 16 character metrics, and exact Mayhem `KeyEvent` ordinals.
- Added a browser framebuffer `Display` adapter and C++ `Painter` so the logical display no longer contains direct browser-specific painting code in the C ABI bridge.
- Replaced the compiled C++ registry table with one generated C++ translation unit per application and a file-scope `app::Registrar`, matching mayhem-b200's native registration ownership semantics.
- Added a fixed-storage freestanding `AppRegistry` with duplicate-ID rejection, category lookup, hash generation, and native C++ tests.
- Added a C++ Home → Category → Application navigation stack; selecting an app pushes a logical application frame before emitting the shell activation event, and Back now pops app → category → Home.
- Mirrored actual tuner family, automatic/manual gain, gain value, dropped-sample count, and radio error count into the Mayhem logical runtime.
- Added the same Mayhem runtime modules and generated app translation units to the checked-in `MB200_WEB=ON` Emscripten target.
- Added `UPSTREAM_RUNTIME_AUDIT.md` to distinguish behavior-converged modules from the exact upstream font/icon/widget resources that remain pending.
- Expanded automated browser/module coverage to 34 passing tests plus native C++ UI primitive and Registrar-registry tests.
- Kept the exact upstream fixed_8x16 byte table, bitmap/icon/theme set, complete STL-based widget/focus tree, Scanner, and ADS-B explicitly pending rather than representing them as linked.

## 0.6.0 — 2026-08-20

- Added automatic sample-rate-aware stream planning with conservative, balanced, and high-rate plans.
- Added Compatibility, High-rate, and Custom streaming profiles in Advanced Mode.
- Added bounded operator controls for USB block size, USB transfer depth, processing queue depth, and display update ceiling.
- Added a fixed-slot SharedArrayBuffer raw-sample pool when cross-origin isolation is available.
- Kept the transferable-ArrayBuffer worker path as an automatic compatibility fallback.
- Added shared-slot ownership tracking and explicit worker acknowledgement before slot reuse.
- Prevented reset from prematurely recycling shared slots that may still be read by older queued worker messages.
- Added adaptive stream protection using processing queue pressure, worker time/block duration, capture backlog, drop changes, and audio underrun changes.
- Added visualization load shedding: normal spectrum work, every-second-block under load, and every-fourth-block under critical pressure.
- Kept WFM/NFM/AM audio processing on every accepted block while visual spectrum work is degraded.
- Added runtime Stream health status and expanded Diagnostics with transport mode, plan, SharedArrayBuffer pool, governor, queue, display ceiling, and spectrum-stride evidence.
- Advanced project schema to version 3 with migration defaults for the new performance settings.
- Expanded automated browser/module coverage to stream planning, governor hysteresis, shared-slot ownership, spectrum-stride/audio ordering, and the v0.5 Easy Mode receiver contract.
- Did not claim the 2.4 Msps / 60-minute target; physical high-rate verification remains pending.

## 0.5.0 — 2026-08-20

- Consolidated the everyday receiver workflow into one Easy Mode control deck in the main workspace.
- Added main-workspace center-frequency and tuning-step controls.
- Added main-workspace WFM/NFM/AM selection, automatic/manual gain, manual-gain slider, volume, squelch, audio enable/mute, receiver start/stop, capture, and station save.
- Added a concise stream-health badge to the primary receiver workflow.
- Hid the contextual right inspector, Mayhem integration target, low-level diagnostics, compatibility, and project settings from the Easy Mode primary workflow while retaining them in Advanced Mode.
- Preserved one receiver/project state across Easy and Advanced modes.
- Expanded Saved Stations to show modulation and to restore audio bandwidth in addition to modulation, gain, rate, squelch, volume, and tuning state.

## 0.4.2 — 2026-08-20

- Completed the initial WFM, NFM, and AM worker-side audio-demodulation family.
- Added bounded AudioWorklet output with user-gesture startup, volume, mute, squelch, and underrun reporting.
- Added deterministic IQ-to-audio fixtures for WFM/NFM/AM.
- Advanced project schema to version 2 for audio receiver state.

## 0.3.1 — 2026-08-20

- Moved visible 240 × 320 status/menu painting and category navigation into the C++ WebAssembly core.
- Added Mayhem-style input handling, registry metadata, and application activation.
- Recorded successful reference-hardware live receive, retune, gain/rate change, stop/restart, hot-unplug/reconnect, and 30-minute 1.024 Msps soak checks.

## 0.3.0 — 2026-08-20

- Fixed stale Progressive Web Application asset caching/version reversion.
- Established a WebAssembly-owned 240 × 320 framebuffer boundary.

## 0.1.0 — 2026-08-20

- Established the browser shell, WebUSB transport, bounded worker pipeline, spectrum/waterfall, simulation, capture/replay, project state, diagnostics, offline PWA, security headers, licensing, and release packaging foundations.
