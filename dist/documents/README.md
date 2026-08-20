# MAYHEM RTL

**MAYHEM RTL v0.8.2** is a browser-native, local-first, receive-only Software-Defined Radio (SDR) workbench for RTL2832U-based RTL-SDR receivers.

It is an independent browser port derived from the architecture and behavior of `mayhem-b200`. It is not an official release of Mayhem, PortaPack, HackRF, RTL-SDR Blog, Ettus Research, or `mayhem-b200`.

The intended workflow is:

**CONNECT → TUNE → INSPECT → DEMODULATE → DECODE → CAPTURE → REVIEW → EXPORT**

## What is new in v0.8.2

Version 0.8.2 adds an **Amateur Radio** receive workspace and extends the worker-side analog audio family with:

- Upper Sideband (USB);
- Lower Sideband (LSB);
- Continuous Wave (CW) reception with adjustable beat pitch;
- 10 Hz, 50 Hz, 100 Hz and larger tuning steps;
- selectable Single-Sideband (SSB) voice filters;
- narrow CW filters;
- Receiver Incremental Tuning (RIT) without changing the nominal saved frequency;
- audio Automatic Gain Control (AGC) with Off, Fast, Medium and Slow choices;
- adjustable SSB low-cut frequency;
- automatic High Frequency (HF) input-path selection, including RTL2832U Q-branch direct sampling when the selected frequency is below the connected tuner floor and the receiver profile permits it.

The Amateur Radio band presets cover common 160 m through 70 cm receive ranges. Their edges and default modes are **convenience presets, not a regulatory database**. MAYHEM RTL remains receive-only regardless of the selected band.

The v0.8.2 DSP implementation follows the same product direction as the pinned `mayhem-b200` analog-audio receiver, whose audited mode configurations include double-sideband Amplitude Modulation (AM), USB, LSB and CW. The browser implementation remains its own worker/audio adapter rather than claiming that the complete native application body is linked byte-for-byte.

### Version consistency repair

The header-version problem is treated as a release blocker in v0.8.2. The build now requires one semantic version across:

- `package.json`;
- `web/src/config.js`;
- CMake;
- the visible header;
- the About dialog;
- the HTML runtime-version marker;
- the version-addressed entry JavaScript and Cascading Style Sheets (CSS);
- generated `version.json`;
- the service-worker cache.

The browser also compares the HTML build version with the executing JavaScript version at startup. If they disagree, MAYHEM RTL visibly reports the mismatch, requests a service-worker update, removes stale MAYHEM RTL caches while preserving the current code version, and performs one cache-busted reload. A persistent mismatch stops startup instead of silently reverting the header.

## Audio-stability boundary carried from v0.8.1

Version 0.8.1 repaired the reported no-audio/continuous-underrun condition by adding a bounded AudioWorklet prebuffer, rebuffer-event accounting, explicit zero-input AudioWorklet configuration and deeper queue diagnostics. The WFM/NFM/AM deterministic fixtures continue to pass, and those modes have prior on-air reference-hardware history; however, because the browser audio-output layer changed, the **current repaired audio path remains pending focused physical re-validation** until an operator records it on this build family.

USB, LSB and CW are deterministic-fixture tested in v0.8.2 and are not labeled on-air verified yet.

## Current product state

MAYHEM RTL includes:

- direct Web Universal Serial Bus (WebUSB) control of validated RTL2832U receivers;
- a physically validated reference receive/high-rate path including live tuning, gain/rate changes, stop/restart, hot-unplug/reconnect, 1.024 million samples per second (Msps) and 2.4 Msps soaks, receive plus capture, SharedArrayBuffer streaming, and bounded long-run memory/queue behavior;
- live spectrum and waterfall;
- WFM, Narrowband Frequency Modulation (NFM), AM, USB, LSB and CW worker-side demodulation;
- bounded AudioWorklet playback with volume, mute, squelch, prebuffering and rebuffer diagnostics;
- dedicated **Broadcast Radio** and **Amateur Radio** workflows;
- a serialized Frequency Scanner;
- local Automatic Dependent Surveillance–Broadcast (ADS-B) decoding at 1090 MHz from deterministic fixtures and explicit Simulation Mode;
- raw In-phase and Quadrature (IQ) capture and local replay;
- saved stations, project import/export and diagnostics;
- adaptive rate-aware streaming with transferable-buffer and SharedArrayBuffer paths;
- a modular C++ WebAssembly Mayhem runtime with native file-scope application registration and C++ navigation/application frames;
- one authoritative application definition in `src/app_registry.json`, generated into browser and C++ representations;
- installable offline Progressive Web Application (PWA) behavior with no telemetry and no remote runtime services.

## Amateur Radio

Choose **Amateur Radio** from the main navigation.

The focused workflow is:

**BAND → FREQUENCY → MODE → FILTER → FINE TUNE → LISTEN**

### Band presets

The workspace includes receive presets for:

- 160 m;
- 80 m;
- 60 m;
- 40 m;
- 30 m;
- 20 m;
- 17 m;
- 15 m;
- 12 m;
- 10 m;
- 6 m;
- 2 m;
- 1.25 m;
- 70 cm.

Conventional defaults are used only as starting points: lower HF voice bands commonly open in LSB, higher HF voice bands commonly open in USB, 30 m opens in CW, and ordinary 2 m/70 cm voice presets open in NFM. The operator can change the mode at any time.

### USB and LSB

The SSB path performs complex sideband selection in the processing worker before reduced audio is sent to the AudioWorklet. Typical selectable voice filters are:

- 1.8 kHz;
- 2.1 kHz;
- 2.4 kHz;
- 2.7 kHz;
- 3.0 kHz.

RIT is adjustable to ±5 kHz in the Amateur Radio workspace, with 10 Hz entry resolution and convenient ±100 Hz / zero controls. The nominal tuned frequency remains distinct from the effective listening center.

### CW

CW shares the narrow complex-filter path and adds an adjustable audio beat pitch. The focused workspace exposes 400–1000 Hz beat pitch with a 700 Hz default and selectable 250/400/500/800/1000 Hz receive filters.

### HF input manager

For a connected receiver, MAYHEM RTL compares the desired frequency with the receiver's reported normal tuner minimum.

If the frequency is below that floor and the profile supports RTL2832U direct sampling, the Amateur Radio page requests the Q-branch direct-sampling path **before** tuning the low-frequency band. When returning to a frequency reachable by the normal tuner, it restores the normal path.

If a receiver profile cannot provide the requested HF path, the page blocks the preset with an actionable explanation rather than pretending the tune succeeded. An external upconverter remains an alternative for hardware that does not provide a suitable HF input.

Direct sampling does not guarantee equivalent sensitivity, filtering or overload performance. Antenna and front-end requirements remain hardware-dependent.

## Broadcast Radio

Broadcast Radio provides focused AM/FM listening without requiring the full receiver inspector.

### FM broadcast

- 87.5–108 MHz preset range;
- WFM;
- 100 kHz or 200 kHz channel step;
- 1.024 Msps receive rate;
- 15 kHz audio low-pass bandwidth;
- 75 microsecond de-emphasis by default;
- Connect / Start / Stop / Enable Audio / Mute / Volume / Save Station.

### Medium-wave AM broadcast

- 530–1710 kHz preset range;
- AM demodulation;
- 10 kHz and 9 kHz stepping;
- tuner-capability-aware direct sampling for ordinary R8xx profiles below their normal tuning floor.

A compatible profile advertising a zero-Hertz minimum can stay on its normal low-frequency hardware path.

## Frequency Scanner

The Scanner uses the same serialized tune-command path as manual tuning. It supports:

- start/end frequency;
- step size;
- dwell time;
- signal threshold in decibels relative to full scale (dBFS);
- optional hold on activity;
- bounded hit history;
- frequency lockouts;
- local Comma-Separated Values (CSV) export.

A scanner hit means energy crossed the selected threshold. It is not a protocol or modulation identification claim.

## ADS-B receiver

The ADS-B workflow configures **1090 MHz / 2.4 Msps** and locally processes supported 112-bit Mode S extended-squitter frames.

Implemented behavior includes:

- Downlink Format (DF) 17/18 handling;
- 24-bit Cyclic Redundancy Check (CRC);
- International Civil Aviation Organization (ICAO) address;
- aircraft identification/callsign;
- supported airborne altitude form;
- velocity and heading;
- even/odd global airborne Compact Position Reporting (CPR);
- aircraft state tracking;
- recent-frame inspection;
- local JavaScript Object Notation (JSON) export;
- local coordinate graticule with no remote map tiles.

CRC, identification, CPR and IQ-to-frame paths are fixture/simulation tested. On-air aircraft reception remains pending operator verification.

## Physical reference validation carried forward

Reference product string: `RTL2838UHIDIR`  
Conservative tuner family: R820T/R820T2/R860 family.

Recorded reference receive/high-rate checks include:

- direct WebUSB initialization;
- live IQ reception;
- spectrum and waterfall;
- retune while receiving;
- gain changes;
- sample-rate changes;
- stop/restart;
- hot-unplug/reconnect;
- 30-minute 1.024 Msps soak with zero visible drops;
- 60-minute 2.4 Msps target soak;
- 2.4 Msps receive plus capture;
- SharedArrayBuffer handoff;
- bounded long-run memory and queue behavior.

Earlier builds also received on-air WFM/NFM/AM audio, but the v0.8.1 audio-output repair changed the current browser playback layer, so the repaired path is intentionally pending a focused re-check.

These results validate one recorded reference configuration only. They are not a universal device/browser/operating-system compatibility claim.

## Easy Mode

The full Receiver keeps everyday controls in one workspace:

- frequency;
- tuning step, including 10/50/100/500 Hz fine steps;
- WFM/NFM/AM/USB/LSB/CW mode;
- gain;
- Start/Stop Receiver;
- Enable Audio / Mute;
- volume;
- squelch;
- spectrum;
- waterfall;
- Save Station;
- Start/Stop Capture;
- stream health.

Broadcast Radio and Amateur Radio provide even more focused workflows for those use cases.

## Advanced Mode

Advanced Mode retains the same receiver/project state and adds:

- requested and actual sample rate;
- frequency correction in parts per million (ppm);
- direct sampling;
- device-specific bias tee;
- Fast Fourier Transform (FFT) parameters;
- audio bandwidth;
- WFM de-emphasis;
- SSB low-cut frequency;
- RIT;
- CW beat pitch;
- audio AGC;
- streaming profile;
- USB block size;
- queued transfer depth;
- processing queue depth;
- display update ceiling;
- shared-pool/governor/latency evidence.

## High-rate streaming architecture

Automatic stream planning uses bounded values derived from the selected sample rate:

| Rate class | USB block | Transfer depth | Processing queue | Display ceiling |
|---|---:|---:|---:|---:|
| below 1.5 Msps | 32,768 complex samples | 4 | 4 | 30 Hz |
| 1.5–2.0 Msps | 49,152 | 5 | 6 | 25 Hz |
| 2.0 Msps and above | 65,536 | 6 | 7 | 24 Hz |

When cross-origin isolation and `SharedArrayBuffer` are available, a fixed-slot shared raw-input pool is used. Otherwise the transferable-`ArrayBuffer` compatibility path remains available.

The adaptive governor reduces optional spectrum work before accepted-block audio processing. It never resets drop counters to manufacture a clean result.

## Mayhem core boundary

The 240 × 320 logical display is C++/WebAssembly-owned. The browser canvas presents pixels and maps browser input into the core.

The modular runtime under `src/mayhem/` provides:

- upstream-compatible UI geometry/color/key primitives;
- framebuffer display adapter;
- painter;
- application registry;
- native file-scope `app::Registrar` registration;
- Home → Category → Application navigation;
- mirrored actual radio/tuner/gain/drop/error state.

The exact upstream fixed 8 × 16 font byte table, full bitmap/icon/theme resources, complete Standard Template Library (STL)-based widget/focus tree and most native application bodies are not yet byte-for-byte compiled into the freestanding WebAssembly artifact. `MB200_WEB=ON` remains the full Emscripten convergence seam. See `UPSTREAM_RUNTIME_AUDIT.md`.

## Receive-only boundary

RTL-SDR hardware is receive-only. MAYHEM RTL always reports receive available, transmit unavailable and full duplex unavailable.

Transmit applications remain visible and locked with an explanation. The browser build contains no transmit, jamming, over-the-air replay, firmware-update, or radio signal-generation command.

## Browser requirements

Live WebUSB reception requires a supported Chromium-based browser and a secure context: Hypertext Transfer Protocol Secure (HTTPS) in production or localhost during development.

Audio requires AudioWorklet and a user gesture before playback begins.

Shared raw-sample handoff additionally requires cross-origin isolation and `SharedArrayBuffer`. Supplied deployment examples set the relevant Cross-Origin-Opener-Policy (COOP) and Cross-Origin-Embedder-Policy (COEP) headers.

## Build and run

Prerequisites:

- Node.js 20 or later;
- Clang 17 or another compiler capable of the current freestanding `wasm32` modules;
- CMake 3.20 or later;
- Emscripten Software Development Kit for the future complete `MB200_WEB=ON` target.

```bash
npm ci
npm run build
npm test
npm run serve
npm run package
```

`npm run build` performs active-version consistency checks before producing `dist/`. `npm run serve` supplies the required security/isolation headers. The production `dist/` tree is static and requires no Node.js, Python, native daemon, WebSocket bridge, or local SDR server at runtime.

## Version consistency

The active release version is **0.8.2**.

The built HTML includes a `data-app-version` marker and version-addressed entry JavaScript/CSS URLs. On startup, the executing JavaScript checks that marker before initializing radio, worker or storage activity. A mismatch triggers one controlled stale-cache recovery attempt; a persistent mismatch is surfaced as an error rather than hidden.

Version-sensitive navigation, JavaScript, CSS, JSON and web-manifest requests use network-first behavior with offline cache fallback. The service worker itself is registered with a versioned URL and `updateViaCache: "none"`.

Historical evidence filenames under `documents/test-results/` may contain earlier release numbers; they are preserved records and are not active runtime version indicators.

## Capture and replay

Raw capture uses unsigned 8-bit interleaved IQ samples. Long captures stream to the Origin Private File System (OPFS) when available, with Indexed Database fallback.

Capture metadata records actual receiver settings, application version, upstream commit, dropped-sample count, modulation/audio context, RIT/CW/SSB settings, direct-sampling mode, timestamps and notes.

Replay accepts local `.cu8`, `.iq`, or `.bin` data plus optional metadata and does not require a radio.

## Project schema

Version 0.8.2 uses project schema **5**. Older schemas are migrated by merging validated current defaults.

Schema-5 settings include:

- amateur band preset;
- fine amateur tuning step;
- SSB low-cut frequency;
- RIT offset;
- CW beat pitch;
- audio AGC mode;
- USB/LSB/CW modulation values;
- prior broadcast/scanner state.

Browser audio always restores disabled after reload/import so a fresh user gesture is required.

## Privacy and network behavior

All radio samples, decoded results, stations, captures, screenshots, notes and diagnostics remain local unless the user explicitly exports a file.

There is no telemetry, analytics, advertising, account, third-party font, remote Content Delivery Network (CDN), remote DSP, remote audio service, remote map tile request, silent sample upload, or silent crash-log upload.

Audit the built runtime with:

```bash
node scripts/verify-no-network.mjs dist
```

## Verification in v0.8.2

The automated release gate covers:

- deterministic WFM/NFM/AM IQ-to-audio fixtures;
- USB selected-sideband recovery and opposite-sideband rejection;
- LSB selected-sideband recovery and opposite-sideband rejection;
- SSB RIT correction fixture;
- CW beat-pitch fixture;
- bounded AudioWorklet buffering and rebuffer behavior;
- Amateur Radio band/default/input-path logic;
- Broadcast FM/AM configuration and direct-sampling decisions;
- Scanner sequence/threshold/hold/wrap/lockout behavior;
- ADS-B Mode S CRC, callsign, CPR and 2.4 Msps IQ fixtures;
- explicit ADS-B Simulation Mode fixture;
- FFT behavior;
- receive-only gating;
- receiver state machine and command serialization;
- WebUSB identifier policy;
- C++ Mayhem framebuffer/registry/navigation behavior;
- generated native application registration;
- one-source registry generation;
- rate-aware stream planning and SharedArrayBuffer slot ownership;
- adaptive performance governor behavior;
- project schema migration/validation;
- active header/About/HTML/JavaScript/CMake/version.json/service-worker consistency;
- stale-cache recovery behavior;
- C/C++ contracts and no-network distribution audit.

See `TEST_RESULTS.md` for exact counts and remaining verification boundaries.

## Remaining validation / roadmap

Primary physical checks after v0.8.2 are:

- re-check repaired browser audio output on a known strong FM station;
- on-air USB reception of a known amateur SSB signal;
- on-air LSB reception of a known amateur SSB signal;
- on-air CW reception and beat-pitch adjustment;
- direct-sampling HF review on the reference receiver and suitable HF antenna/input;
- focused medium-wave AM review;
- on-air ADS-B reception at 1090 MHz;
- practical live Scanner review;
- broader RTL-SDR hardware/browser/operating-system matrix;
- deeper exact upstream Mayhem asset/widget/application convergence.

After these gates, receive-only application candidates include Automatic Packet Reporting System (APRS), Automatic Identification System (AIS), pager receivers, radiosondes, weather receivers and additional telemetry applications.

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
