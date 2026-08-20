# MAYHEM RTL

**MAYHEM RTL v0.7.0** is a browser-native, local-first, receive-only Software-Defined Radio (SDR) workbench for RTL2832U-based RTL-SDR receivers.

It is an independent browser port derived from the architecture and behavior of `mayhem-b200`. It is not an official release of Mayhem, PortaPack, HackRF, RTL-SDR Blog, Ettus Research, or `mayhem-b200`.

The intended workflow is:

**CONNECT → TUNE → INSPECT → DEMODULATE → DECODE → CAPTURE → REVIEW → EXPORT**

## Current product state

Version 0.7.0 is the first **runtime-convergence** release after the validated v0.6 receiver/performance milestone.

The release includes:

- direct WebUSB RTL2832U reception with the validated v0.6 transport/performance path;
- live spectrum and waterfall;
- hardware-validated Wideband Frequency Modulation (WFM), Narrowband Frequency Modulation (NFM), and Amplitude Modulation (AM) audio on the recorded reference configuration;
- local capture/replay, projects, stations, diagnostics, and offline Progressive Web Application behavior;
- a modular C++ WebAssembly Mayhem runtime built around upstream-shaped `ui` geometry/color/key primitives, a browser framebuffer display adapter, a `Painter`, a navigation stack, and `app::AppRegistry`;
- individual generated C++ application translation units containing file-scope `app::Registrar` objects, replacing the former compiled registry table while retaining `src/app_registry.json` as the one cross-language build definition;
- C++ application frames inside the 240 × 320 logical display rather than category selection immediately returning control to the browser;
- live tuner, gain/automatic-gain-control state, dropped-sample count, and radio-error count mirrored into the Mayhem WebAssembly runtime;
- the same v0.7 C++ runtime sources added to the `MB200_WEB=ON` Emscripten target so the freestanding and future complete browser builds no longer diverge at the Mayhem-core boundary.

The exact upstream `fixed_8x16` glyph byte table, complete bitmap/icon/theme resources, and the entire `ui_widget`/focus/navigation implementation are **not yet byte-for-byte compiled into the browser target**. Version 0.7.0 replaces the monolithic bridge with the correct modular seams and native registration behavior, but it does not falsely claim that the remaining upstream assets/classes are already linked. Scanner and Automatic Dependent Surveillance–Broadcast (ADS-B) remain later application work.

## Physical hardware evidence

The user has validated the v0.6 milestone on the recorded `RTL2838UHIDIR` reference configuration. The recorded checks now include:

- direct WebUSB connection and initialization;
- live sample reception;
- spectrum and waterfall;
- retuning, gain changes, and sample-rate changes while receiving;
- stop/restart and hot-unplug/reconnect recovery;
- a 30-minute 1.024 million-samples-per-second (Msps) soak with zero visible dropped samples;
- on-air WFM, NFM, and AM audio;
- browser audio lifecycle validation;
- a 60-minute 2.4 Msps target soak;
- 2.4 Msps receive plus capture;
- SharedArrayBuffer streaming on the reference setup;
- sustained audio without unacceptable recurring underruns;
- bounded long-run memory/queue behavior.

Those results verify the recorded reference configuration. They do not establish a multi-device, multi-browser, or multi-operating-system compatibility matrix. R828D and exact R860 hardware identification remain separate validation items.

## Easy Mode — v0.5 receiver workflow

Easy Mode is now intentionally focused on the complete everyday receive workflow. The Receiver workspace exposes:

- center frequency;
- tuning step;
- WFM / NFM / AM mode;
- automatic or manual gain;
- manual gain when selected;
- Start Receiver / Stop Receiver;
- Enable Audio / Mute;
- volume;
- squelch;
- spectrum;
- waterfall;
- Save Station;
- Start Capture / Stop Capture;
- clear receiver/source state;
- a concise stream-health indicator.

The contextual right inspector, Mayhem 240 × 320 integration target, low-level transport controls, compatibility matrix, diagnostics, and project settings are hidden from the Easy Mode primary workflow. Switching to Advanced Mode reveals them without changing receiver/project state.

Saved Stations preserve frequency, modulation, sample rate, gain, frequency correction, audio bandwidth, squelch, volume, and notes.

## Advanced Mode — v0.6 streaming controls

Advanced Mode exposes the same receiver state plus:

- requested/actual sample rate;
- frequency correction;
- direct sampling where available;
- bias tee only for explicitly compatible profiles;
- Fast Fourier Transform (FFT) size/window/averaging/range controls;
- audio low-pass bandwidth and WFM de-emphasis;
- streaming profile;
- USB block size;
- queued USB transfer depth;
- processing queue depth;
- maximum display update rate;
- processing latency, queue pressure, and stream-governor state in Diagnostics.

### Streaming profiles

`Automatic` is the normal default. It chooses a bounded plan from the actual configured sample rate:

| Rate class | USB block | Transfer depth | Processing queue | Display ceiling |
|---|---:|---:|---:|---:|
| below 1.5 Msps | 32,768 complex samples | 4 | 4 | 30 Hz |
| 1.5–2.0 Msps | 49,152 complex samples | 5 | 6 | 25 Hz |
| 2.0 Msps and above | 65,536 complex samples | 6 | 7 | 24 Hz |

Additional profiles are:

- **Compatibility** — conservative fixed transport and 20 Hz display ceiling;
- **High-rate** — 65,536-sample blocks, six queued transfers, seven processing slots;
- **Custom** — exposes bounded operator values for block size, transfer depth, processing queue depth, and display ceiling.

Custom transport changes apply on the next receiver start.

## Adaptive visualization governor

The v0.6 processing governor protects radio/audio work before visual work. Every status interval it considers:

- processing queue pressure;
- worker processing time relative to radio block duration;
- capture-write backlog;
- sample-drop changes;
- audio-underrun changes.

It has three states:

- **Healthy** — normal visualization work;
- **Managing load** — lower display ceiling and spectrum processing every second block;
- **Protecting stream** — further reduced display ceiling and spectrum processing every fourth block.

Audio demodulation remains on every accepted sample block. The governor does not falsify counters or reset drop evidence. When pressure clears, it returns toward full visualization with hysteresis rather than oscillating every status tick.

## Shared sample handoff

When the page is cross-origin isolated and `SharedArrayBuffer` is available, v0.6 creates a fixed-slot shared raw-sample pool between the browser main thread and processing worker.

The design is intentionally bounded:

- eight slots;
- 131,072 bytes per slot, enough for 65,536 unsigned-8-bit interleaved complex samples;
- a slot cannot be reused until the worker acknowledges the corresponding block;
- pool exhaustion rejects the incoming processing block and increments visible drop accounting rather than silently overwriting data;
- shared slots are not marked free during a reset while older worker messages may still be reading them.

The browser still copies the WebUSB block once into the shared pool, and the processing worker copies it into the current WebAssembly kernel memory. This is therefore a **shared raw-input handoff**, not yet a claim that the complete Mayhem WebAssembly runtime uses shared WebAssembly memory or Emscripten pthreads.

If cross-origin isolation or SharedArrayBuffer is unavailable, MAYHEM RTL continues using the tested transferable-ArrayBuffer path. Diagnostics state which handoff is active.

## Current Mayhem core boundary

Version 0.7.0 removes the former monolithic Mayhem core implementation. The WebAssembly logical display is now composed from C++ modules under `src/mayhem/`:

- `ui.hpp` / `ui.cpp` — upstream-compatible geometry, RGB565 `Color`, 8 × 16 character metrics, and Mayhem `KeyEvent` ordinals;
- `display.*` — browser framebuffer implementation of the host display drawing seam;
- `painter.*` — rectangle/line/text painting through the display adapter;
- `app_registry.*` — fixed-storage browser form of Mayhem's self-registering registry;
- `navigation.*` — Home → Category → Application push/pop navigation;
- `runtime.*` — framebuffer ownership, rendering, and mirrored radio state.

`src/app_registry.json` remains the authoritative cross-language application definition. The build generates browser metadata plus **one C++ source file per application**, each containing a file-scope `app::Registrar`. The WebAssembly runtime invokes its static constructors before reading the registry. The old `generated_app_registry.inc` is retained only as an audit summary and is no longer compiled into the core.

The logical framebuffer now receives actual center frequency, sample rate, signal level, tuner family, gain/automatic-gain-control state, dropped samples, and error counts from the browser receiver. Selecting an application pushes a C++ application frame before emitting the activation event used by the Green Shoe shell.

Still pending for deeper source convergence are the exact upstream `fixed_8x16` glyph bytes, full bitmap/icon/theme resources, the complete upstream widget/focus implementation, and broader native Mayhem application translation units. See `UPSTREAM_RUNTIME_AUDIT.md` and `PORTING_MATRIX.md`.

## Receive-only boundary

RTL-SDR hardware is receive-only. The browser capability model always reports receive available, transmit unavailable, and full duplex unavailable.

Transmit applications remain visible with explanatory locked states. No transmit, jamming, over-the-air replay, firmware update, or signal-generation command exists in this build.

## Browser requirements

Live WebUSB reception requires a current Chromium-based browser exposing WebUSB and a secure context: `https://` in production or `http://localhost` during development.

Audio additionally requires AudioWorklet and explicit user activation.

The shared raw-sample path additionally requires:

- `Cross-Origin-Opener-Policy: same-origin`;
- `Cross-Origin-Embedder-Policy: require-corp`;
- `crossOriginIsolated === true`;
- `SharedArrayBuffer`.

All supplied deployment examples include the isolation headers. Missing shared-memory support does not blank the application; the transferable-buffer compatibility path remains available.

## Receiver support

The device picker restricts selection to validated Realtek RTL2832U identifiers and performs a second-stage interface/endpoint check before vendor commands are issued.

Target tuner families are:

- R820T;
- R820T2;
- R828D, including the RTL-SDR Blog V4 switching profile;
- R860 where compatible with the audited R8xx behavior.

Exact differentiation inside the R820T/R820T2/R860 family is reported conservatively when the exposed hardware identity does not support a stronger claim.

## Build and run

Prerequisites:

- Node.js 20 or later;
- Clang 17 or another compiler capable of the current freestanding `wasm32` modules;
- CMake 3.20 or later;
- Emscripten Software Development Kit for the future complete `MB200_WEB=ON` upstream C++ target.

```bash
npm ci
npm run build
npm test
npm run serve
npm run package
```

`npm run serve` provides the required security/isolation response headers. `dist/` is directly deployable and requires no package manager at runtime.

## First live session

1. Open MAYHEM RTL over HTTPS or localhost.
2. Choose **Connect RTL-SDR** and select the intended RTL2832U receiver.
3. After the device reaches **Connected — idle**, choose **Start Receiver**.
4. Enter a frequency or click the spectrum to tune.
5. Select WFM, NFM, or AM.
6. Choose **Enable Audio** if audio is desired.
7. Adjust gain, volume, and squelch.
8. Save a station or start a local IQ capture.
9. Watch the Stream indicator. In Advanced Mode, Diagnostics shows the active transfer plan, handoff mode, queue, governor, and latency evidence.
10. Stop capture, stop the receiver, and disconnect before removing the device where practical.

MAYHEM RTL never reconnects to a USB device automatically on page load.

## Capture and replay

Raw captures use unsigned 8-bit interleaved IQ samples. Capture data streams into the Origin Private File System (OPFS) when available, with Indexed Database fallback. Long captures are never accumulated as one growing JavaScript array.

Metadata records sample format, actual sample rate, center frequency, tuner, gain, frequency correction, timestamps, application version, upstream commit, dropped-sample count, notes, modulation, audio bandwidth, and squelch.

Replay accepts local `.cu8`, `.iq`, or `.bin` data plus optional metadata. Replay is local and requires no radio.

## Project schema

Version 0.7.0 continues to use project schema **3**. Older schema-1 and schema-2 projects are migrated by merging validated current defaults. Browser audio is always restored disabled so a new user gesture is required after reload/import.

New performance fields include:

- `performanceProfile`;
- `processingQueueDepth`;
- `displayRateHz`.

## Privacy and network behavior

All radio samples, decoded results, settings, stations, captures, screenshots, notes, and diagnostics remain local unless the user explicitly exports a file.

There is:

- no telemetry;
- no analytics;
- no advertising;
- no user account;
- no third-party font;
- no remote Content Delivery Network;
- no remote DSP/audio service;
- no remote map tiles;
- no silent upload of samples, diagnostics, or crashes.

Run:

```bash
node scripts/verify-no-network.mjs dist
```

to audit the production distribution for remote runtime Uniform Resource Locators and permissive connection policy.

## Verification in v0.7.0

The automated release gate currently covers:

- deterministic WFM/NFM/AM IQ-to-audio fixtures;
- bounded AudioWorklet ring structure;
- FFT behavior;
- receive-only application gating;
- physical-hardware evidence metadata;
- state-machine start/stop behavior;
- WebAssembly Mayhem framebuffer and registry behavior;
- one-source registry generation;
- automatic/custom stream planning;
- performance-governor degradation and recovery;
- fixed-slot shared-block-pool ownership;
- preservation of audio processing while spectrum work is strided;
- Easy Mode essential receiver controls;
- project schema migration and validation;
- replay pacing;
- stale-session rejection and command serialization;
- WebUSB identifier policy;
- version/service-worker cache consistency;
- portable C DSP tests;
- receive-only C++ `RadioDevice` contract tests;
- outbound-runtime no-network audit.

See `TEST_RESULTS.md` for the exact result count and limitations.

## Not yet verified

- R828D physical hardware;
- exact R860 physical identification;
- wider browser/operating-system/device hardware matrix;
- exact upstream fixed 8 × 16 font bytes in the browser WebAssembly target;
- complete upstream bitmap/icon/theme set in the browser WebAssembly target;
- complete upstream `ui_widget` / focus / navigation translation units in the browser WebAssembly target;
- Frequency Scanner;
- Automatic Dependent Surveillance–Broadcast decoder behavior from fixture and real received data.

No pending capability should be relabeled complete, hardware-tested, or on-air verified until recorded evidence supports that statement.

## Source lineage and licenses

See:

- `NOTICE.md`;
- `SOURCE_ATTRIBUTION.md`;
- `THIRD_PARTY_LICENSES.md`;
- `PORTING_MATRIX.md`;
- `UPSTREAM_RUNTIME_AUDIT.md`;
- `UPSTREAM_COMMIT.txt`;
- `WEBRTLSDR_COMMIT.txt`.

MAYHEM RTL is distributed under GNU General Public License version 2.0 or later. Adapted WebUSB transport portions retain their Apache License 2.0 notices.
