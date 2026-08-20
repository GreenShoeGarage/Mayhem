# MAYHEM RTL

**MAYHEM RTL v0.8.11** is a browser-native, local-first, receive-only Software-Defined Radio (SDR) workbench for RTL2832U-based RTL-SDR receivers.

It is an independent browser port derived from the architecture and behavior of `mayhem-b200`. It is not an official release of Mayhem, PortaPack, HackRF, RTL-SDR Blog, Ettus Research, or `mayhem-b200`.

The intended workflow is:

**CONNECT → TUNE → INSPECT → DEMODULATE → DECODE → CAPTURE → REVIEW → EXPORT**

## What is new in v0.8.11

Version 0.8.11 is a focused **user-interface and user-experience cleanup release**. It does not add a new decoder or change the project schema; it reorganizes the existing capabilities around what an operator is trying to do.

- The left navigation is grouped into **Start, Listen, Decode, Analyze, Review, and Support** instead of presenting one long flat application list. Collapsed desktop navigation becomes true icon-only navigation.
- **Easy Mode** now keeps tuner/rate/gain/queue/stream implementation detail, Compatibility, Diagnostics, and Settings out of the primary workflow while preserving them in Advanced Mode.
- Home is now task-first: connect or choose a source once, then move directly into **Listen**, **View & Decode**, **Analyze**, or **Review**. The duplicated source-selection cards were removed.
- The everyday Receiver now uses one stateful **Start Receiver / Stop Receiver** control. Manual gain is hidden while automatic gain is selected instead of occupying space as a disabled control.
- The former Applications page is now a searchable **Receiver Library** with task filters for Featured, Listen, Decode, Analyze, Review, System, Unavailable, and All. Receive-only tools remain prominent and transmit-only entries are separated rather than competing for attention.
- Modern decoder workspaces now retain a consistent Advanced inspector instead of falling back to a generic receiver-start panel. The Receiver-only reset control is no longer shown where it has no effect.
- Signal Analysis tabs are constrained to a single horizontally scrollable row, reducing vertical UI growth on narrower windows.
- No receive/DSP path was removed or reimplemented. Project schema remains **12** and the generated native registry remains **42 applications**.
- The release adds six UI/UX regression tests. The complete browser/module suite is now **108 tests**.

## What is new in v0.8.10

Version 0.8.10 adds a first-class **Slow-Scan Television (SSTV) Receiver** built on the continuous processing-worker IQ stream rather than a periodic spectrum snapshot. The promoted reference path is **Martin 1, 320 × 256**, with a complete deterministic image fixture.

- **HF SSTV:** a 14.230 MHz preset uses Upper Sideband (USB) audio and the existing automatic HF/direct-sampling input manager.
- **VHF/ISS SSTV:** a 145.800 MHz preset uses Frequency Modulation (FM). Auto input mode selects USB below 30 MHz and FM above it; manual USB/FM selection remains available.
- Internal SSTV processing runs at approximately 48 kHz and performs tone-frequency estimation, Vertical Interval Signaling (VIS) detection, line synchronization, fractional pixel timing, and progressive RGB scanline reconstruction.
- The audited Mayhem mode table is present for Scottie 1, Scottie 2, Scottie DX, Martin 1, Martin 2 and SC2-180. Martin 1 is the promoted deterministic reference mode; the others remain experimental/pending broader validation.
- The image appears progressively on a 320 × 256 browser canvas. Horizontal phase and slant correction can be adjusted while receiving.
- Completed or partial images can be exported as local PNG files with local JSON reception metadata. Raw IQ capture stores the selected SSTV settings and an SSTV capture can reopen directly into the SSTV replay workflow.
- Simulation Mode carries a complete 256-line Martin 1 picture through unsigned-8-bit IQ, ordinary worker blocks, worker-style DC removal and the same continuous decoder used by live samples.
- Fixed an integration defect that would have reconfigured/reset the SSTV decoder once per IQ block. SSTV configuration is now persistent across the minute-scale transmission.
- Project schema advances to **12** and the generated native registry contains **42 applications**.
- Live/on-air SSTV remains pending physical validation; the v0.8.6 reference hardware baseline remains the last explicitly recorded physical baseline.

## What is new in v0.8.9

Version 0.8.9 adds the **Tracking & Beacons** workspace with three receive-only continuous-IQ applications:

- **AIS RX** — simultaneous Automatic Identification System (AIS) channel A (161.975 MHz) and channel B (162.025 MHz) reception from a 162.000 MHz center, with 9600 bit/s frequency-shift keying, Non-Return-to-Zero Inverted (NRZI), High-Level Data Link Control (HDLC) framing/bit de-stuffing, CRC-16/X-25, and fixture-backed message types 1/2/3 Class-A position reports. Structured output includes Maritime Mobile Service Identity (MMSI), navigation status, speed, course, heading, and position.
- **Radiosonde RX** — the first promoted sonde path is **Vaisala RS41-SG** at 4800 bit/s 2FSK, including the upstream XOR descrambler, per-block CRC-16/CCITT-FALSE checks, serial/frame/battery extraction, and Earth-Centered Earth-Fixed (ECEF) position conversion. Meteomodem and additional sonde families remain pending.
- **406 MHz Beacon RX** — passive receive/analysis of deterministic COSPAS-SARSAT long-frame bursts using biphase-L, BCH-1/BCH-2 validation, and a fixture-backed Standard Location Personal Locator Beacon (PLB) serial/position subset. **No transmit or distress-beacon activation capability exists.**
- All three decoders consume the gap-free processing-worker I/Q path, preserve state across ordinary 32,768-sample worker blocks, and export only local structured results. No remote vessel, balloon, beacon, or map service is used.
- The 406 MHz decoder deliberately protects the long unmodulated carrier from the worker's DC-removal notch by using a small receiver intermediate-frequency offset and digitally translating the beacon back to baseband before demodulation.
- The previously delivered **v0.8.6 reference baseline remains user-validated**. The new v0.8.8 paging and v0.8.9 tracking/beacon decoders remain fixture-tested/on-air-pending until separate physical evidence is recorded.
- Project schema advances to **11** and all active package/header/cache/version surfaces are **0.8.9**.

## What is new in v0.8.8

Version 0.8.8 adds the **Paging** workspace with two receive-only, continuous-IQ applications:

- **FLEX RX** — fixture-backed FLEX 1600 bit/s 2FSK synchronization, Frame Information Word (FIW), BCH(31,21) correction, Phase-A address/vector handling, and alphanumeric page recovery. The current promoted subset deliberately does not claim FLEX 3200/6400, 4FSK, fragmented pages, or the complete vector catalog.
- **2-Tone RX** — Motorola/EIA Quik-Call II-style sequential paging tone detection using the audited Mayhem tone bank, 40 ms Goertzel windows, A/B sequencing, and measured tone durations. It reports detected tone pairs; it does not infer agency identity.
- Both decoders run from the existing gap-free processing-worker IQ stream and preserve state across normal 32,768-sample worker blocks.
- Both have explicit local Simulation Mode fixtures plus JSON/CSV export.
- Paging content stays local. On-air FLEX and Two-Tone validation remains pending.
- The previously delivered **v0.8.6 reference baseline was user-validated**; v0.8.8's new paging decoders are not included in that earlier validation.
- Project schema advances to **10** and all active package/header/cache/version surfaces are **0.8.8**.

## What is new in v0.8.6

Version 0.8.6 adds the **Sub-GHz Telemetry** workspace and a shared continuous-IQ OOK pulse/packet foundation. The first fixture-backed consumers are **TPMS RX** and **Weather Sensors**.

- TPMS presets for 315 MHz and 433.92 MHz.
- Initial Schrader-style 8.192 kHz OOK/Manchester TPMS decoding with sensor ID, pressure, flags, repeat count, JSON and CSV export.
- Weather defaults to 433.92 MHz and initially promotes the Nexus TH protocol, decoding sensor ID, temperature, humidity, channel, battery state, repeat count and age-oriented observations.
- Adaptive magnitude slicing with hysteresis and pulse/gap duration recovery runs in the processing worker and preserves state across USB blocks.
- Deterministic pulse fixtures and quantized IQ fixtures exercise the same decoder path used by live samples.
- TPMS and Weather are intentionally marked simulation-tested/on-air pending. The wider upstream TPMS FSK and weather-protocol catalog remain future promotions rather than implied support.
- Project schema advances to 9 and all version/cache/package surfaces are 0.8.6.

## What is new in v0.8.4

Version 0.8.4 adds the **Signal Analysis Suite**, seven receive-only workflows built on shared spectrum, level, tuning, worker-snapshot and capture infrastructure rather than seven independent sample pipelines:

- **Level** — live dBFS meter, rolling mean/peak/minimum, estimated in-passband noise floor, and bounded level history;
- **Detector** — threshold, hysteresis, minimum-active time, release time, and a bounded activity-event history;
- **Fox Hunt** — relative signal-strength meter with adjustable floor/ceiling and rolling trend for direction-finding workflows; it deliberately does not infer bearing or claim calibrated field strength;
- **Search** — current-passband Fast Fourier Transform (FFT) peak search with threshold, prominence, minimum-frequency separation, tune and marker actions;
- **Looking Glass** — serialized multi-tune wideband sweep that stitches FFT slices into a local max-hold overview and restores the original frequency after a normal completed sweep;
- **Signal Hunter** — current-frequency or range-hop energy watch with threshold crossing, cooldown, bounded state, and automatic local post-trigger raw IQ capture using the existing capture store;
- **Time Sink** — a bounded worker-generated In-phase/Quadrature (I/Q) time-domain oscilloscope snapshot that does not create a second raw-sample transport.

Signal Hunter pauses range hopping while an automatic capture is active and resumes afterward. Version 0.8.4 records **post-trigger samples only**; pre-trigger IQ buffering is intentionally not claimed yet. Looking Glass is a serial sweep, so short signals can be missed while the receiver is tuned elsewhere. Time Sink is a diagnostic visualization, while raw IQ capture remains the sample-complete evidence path.

The Looking Glass and Signal Hunter workflows were behavior-audited against the corresponding PortaPack Mayhem receiver sources at supplemental reference commit `6dadefe86fd7b012c69b153b7f40115531bd66e5`. MAYHEM RTL keeps its browser-native shared receiver/storage architecture rather than copying hardware-specific display or baseband plumbing.

The Signal Analysis Suite is automated/unit tested in v0.8.4. **Physical workflow verification remains pending** for these seven new applications.

## What is new in v0.8.3

Version 0.8.3 adds a first-class **POCSAG Pager Receiver**. The receive/decode path runs continuously in the processing worker and supports:

- automatic or fixed 512, 1200, and 2400 bit/s operation;
- 2FSK/FM-discriminator decoding with nominal ±4.5 kHz deviation;
- the standard `0x7CD215D8` synchronization word and `0x7A89C197` idle word;
- normal and inverted discriminator polarity;
- BCH(31,21) correction compatible with the pinned Mayhem implementation;
- Receiver Identity Code (RIC) and function extraction;
- alphanumeric and numeric page decoding;
- local RIC keep/ignore filtering;
- local JSON and CSV export;
- an optional **Monitor FSK Audio** control for hearing the paging tones without making audio playback a decoder dependency;
- an explicit deterministic POCSAG Simulation Mode fixture for testing without radio hardware.

Paging messages may contain private or sensitive information. MAYHEM RTL keeps decoded pages local, does not upload them, and does not provide a transmit path. Operators remain responsible for applicable law and policy.

The browser implementation was audited against the pinned `mayhem-b200` POCSAG application and tests. The upstream host implementation itself notes that a periodically sampled spectrum snapshot is not a sufficient source for gap-free POCSAG decoding; MAYHEM RTL therefore attaches the decoder to the continuous worker IQ stream instead.

POCSAG is deterministic-fixture and Simulation Mode tested in v0.8.3. **On-air POCSAG reception remains pending physical verification.**

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
- a **Paging** workspace with FLEX 1600 2FSK and Motorola/EIA 2-Tone fixture-backed receive paths;
- a **Sub-GHz Telemetry** workspace with fixture-backed Schrader-style TPMS and Nexus TH Weather receive paths;
- a **Tracking & Beacons** workspace with dual-channel AIS, Vaisala RS41-SG radiosonde, and passive 406 MHz distress-beacon vertical slices;
- continuous local POCSAG decoding at 512/1200/2400 bit/s with optional FSK audio monitoring, RIC filtering and export;
- a seven-workflow **Signal Analysis Suite** covering level metering, activity detection, relative fox-hunt strength, passband peak search, wideband stitched sweeps, triggered/range-hop IQ capture, and time-domain I/Q snapshots;
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

The active release version is **0.8.6**.

The built HTML includes a `data-app-version` marker and version-addressed entry JavaScript/CSS URLs. On startup, the executing JavaScript checks that marker before initializing radio, worker or storage activity. A mismatch triggers one controlled stale-cache recovery attempt; a persistent mismatch is surfaced as an error rather than hidden.

Version-sensitive navigation, JavaScript, CSS, JSON and web-manifest requests use network-first behavior with offline cache fallback. The service worker itself is registered with a versioned URL and `updateViaCache: "none"`.

Historical evidence filenames under `documents/test-results/` may contain earlier release numbers; they are preserved records and are not active runtime version indicators.

## Signal Analysis Suite

Choose **Signal Analysis** from the main navigation and select one of the seven tools. All tools operate on the same active receive source and use the existing serialized tune path, worker pipeline, project state, and local capture store.

### Level

The Level tool reports the current block level in dBFS plus bounded rolling mean, peak and minimum values. When spectrum data is available it also estimates a current in-passband noise floor. These values are useful relative measurements; MAYHEM RTL does not claim calibrated RF power without a calibrated front end.

### Detector

The Detector adds threshold, hysteresis, minimum-active time and release timing. Completed activity events retain start/end time, duration and peak level locally. Hysteresis and hold timing prevent a noisy signal near threshold from creating a rapid stream of false state changes.

### Fox Hunt

Fox Hunt maps dBFS into a configurable relative-strength scale and plots the rolling trend. It is intended to support move-and-compare direction-finding work. It does not calculate a bearing, direction of arrival, distance or calibrated received field strength.

### Search

Search analyzes the current instantaneous FFT passband for separated local peaks above both an absolute threshold and an estimated-noise-floor prominence threshold. Results can be tuned directly or converted to local spectrum markers. It is not a protocol identifier.

### Looking Glass

Looking Glass serially tunes across a configured range, waits for each tune to settle, consumes a fresh FFT slice and stitches max-hold values into one local overview. The step is bounded against the current sample rate to reduce uncovered gaps. Because an RTL-SDR sees only one instantaneous passband at a time, this is a **sweep**, not simultaneous wideband reception; intermittent signals can be missed between visits.

### Signal Hunter

Signal Hunter can watch the current frequency or serially hop a configured range. A rising threshold crossing triggers the existing raw-IQ capture engine, names and annotates the capture, pauses range hopping while capture is active, then resumes. Cooldown prevents immediate repeated captures. Version 0.8.4 stores post-trigger IQ only; a future pre-trigger ring is not claimed.

### Time Sink

Time Sink asks the processing worker for a bounded, decimated I/Q snapshot and renders a time-domain oscilloscope. Snapshot publication is rate-limited and point count is bounded. It is a visualization/diagnostic surface; use raw IQ capture when every sample matters.

## POCSAG Pager Receiver

Choose **POCSAG** from the main navigation. Enter the local paging frequency, select **Auto** or a fixed 512/1200/2400 bit/s rate, connect/start the receiver, and watch the synchronization and decoded-page counters. The decoder does not require speaker audio; **Monitor FSK Audio** is optional and uses the existing NFM audio path only for listening to the tones.

The decoded table records timestamp, RIC, function, bit rate, detected message type, message, corrected-bit count, uncorrectable-codeword count, and polarity. Up to 500 recent pages are retained in session memory. RIC filters can show all pages, only one RIC, or ignore one RIC. JSON and CSV exports are local.

Common channel examples are provided only as starting points and are not a worldwide frequency database.

## Capture and replay

Raw capture uses unsigned 8-bit interleaved IQ samples. Long captures stream to the Origin Private File System (OPFS) when available, with Indexed Database fallback.

Capture metadata records actual receiver settings, application version, upstream commit, dropped-sample count, modulation/audio context, RIT/CW/SSB settings, direct-sampling mode, timestamps and notes.

Replay accepts local `.cu8`, `.iq`, or `.bin` data plus optional metadata and does not require a radio.

## Project schema

Version 0.8.10 uses project schema **12**. Older schemas are migrated by merging validated current defaults.

Schema-12 adds SSTV frequency, Auto/USB/FM input selection, mode, automatic VIS state, horizontal phase and slant correction on top of schema-11 Tracking & Beacons state. Schema-11 adds the selected Tracking & Beacons tool plus AIS center, radiosonde frequency/protocol, and passive 406 MHz beacon frequency/intermediate-frequency settings on top of schema-10 Paging state.

Schema-8 settings include:

- selected Digital Decoder tool;
- AFSK channel/profile/polarity/audio-monitor state;
- APRS channel/polarity/audio-monitor state;
- ACARS channel/IF-offset/audio-monitor state;
- RTTY channel/profile/sideband/polarity/audio-monitor state;
- Morse channel/speed/pitch/threshold/audio-monitor state;
- prior Signal Analysis settings;

- selected Signal Analysis tool;
- Detector threshold, hysteresis and timing;
- Search threshold, prominence and separation;
- Looking Glass start/end/step/dwell;
- Fox Hunt display floor/ceiling;
- Signal Hunter single/range mode, threshold, capture/cooldown, hop range/step/dwell;
- Time Sink point count;
- POCSAG receiver settings;
- prior amateur/SSB/CW, broadcast/scanner and performance state.

Earlier schema settings also include:

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

## Verification in v0.8.11

The automated release gate covers:

- grouped task-based navigation, compact collapsed-rail behavior, and Easy/Advanced visibility contracts;
- task-first Home routing without duplicated source cards;
- the stateful Receiver start/stop control and automatic/manual gain visibility;
- Receiver Library search/filter behavior and separation of unavailable transmit entries;
- consistent Advanced inspector coverage across the modern receive workspaces;

- complete 256-line Martin 1 SSTV tone-to-RGB reconstruction with known per-plane pixel values;
- Martin 1 USB-IQ and FM-IQ paths through unsigned-8-bit quantization, worker-style DC removal and ordinary 32,768-sample worker boundaries;
- SSTV VIS parity/mode table, 1500-Hz black / 2300-Hz white mapping, worker state-continuity contract, browser workspace controls, full Simulation Mode picture, local PNG/metadata hooks and capture/replay metadata plumbing;
- deterministic WFM/NFM/AM IQ-to-audio fixtures;
- FLEX BCH/sync and continuous 1600 2FSK Phase-A alphanumeric page fixtures;
- Two-Tone Motorola/EIA Goertzel/sequencer deterministic IQ fixture;
- AIS CRC-16/X-25 and dual-channel Class-A position-report deterministic IQ, including worker quantization/DC-removal/chunk boundaries;
- Vaisala RS41-SG descrambling, per-block CRC-16/CCITT-FALSE, identity/battery/ECEF position fixture across worker blocks;
- 406 MHz COSPAS-SARSAT long-frame biphase-L fixture, BCH-1/BCH-2 validation, Standard Location PLB parsing, and worker-style DC-removal protection;
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
- Signal Analysis noise-floor estimation and separated FFT peak detection;
- Detector minimum-active/hysteresis/release timing;
- bounded Level history and relative-strength mapping;
- Looking Glass multi-slice max-hold stitching;
- Signal Hunter range stepping/wrap, receive-only registry exposure and local capture integration;
- bounded Time Sink worker snapshots;
- AFSK Bell/V-series profile definitions and chunk-continuous deterministic IQ decode;
- AX.25/ACARS independent CRC check values;
- APRS Bell 202 → NRZI → HDLC → AX.25 deterministic IQ decode and basic position extraction;
- ACARS AM/MSK deterministic IQ decode, odd parity, CRC and structured fields through the IF-offset path;
- RTTY 45.45-baud/170-Hz-shift ITA2 deterministic IQ decode;
- Morse configured-speed deterministic IQ decode after worker-style per-block DC removal;
- Digital Decoder registry/Simulation Mode exposure and continuous-worker-IQ integration contract;
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

Primary physical checks after v0.8.11 are:

- receive a known Martin 1 SSTV transmission on HF USB and verify VIS, line timing, progressive image reconstruction and PNG export against an independent decoder;
- receive a known VHF/FM SSTV transmission (for example a lawful local/test source) and verify the FM path independently;
- capture and replay the same SSTV transmission and verify that the image reconstructs progressively without a radio;

- receive known local AIS traffic on channels A/B and compare MMSI/position/course/speed against an independent receiver;
- receive a known Vaisala RS41-SG radiosonde and compare serial/frame/battery/position against an independent decoder;
- validate the 406 MHz path only with a lawful test source, shielded/simulated source, or recorded capture; do not intentionally activate a distress beacon for testing;
- receive known FLEX and 2-Tone test traffic and compare the decoded paging evidence to an independent reference;
- compare Level and Fox Hunt relative readings while moving a known signal source/antenna geometry;
- exercise Detector threshold/hysteresis against a known intermittent signal;
- run Search on a passband containing multiple known carriers;
- sweep a known band with Looking Glass and compare stitched peaks to the ordinary spectrum;
- arm Signal Hunter in single-frequency and range-hop modes, verify an energy crossing creates a valid local IQ capture, and confirm hopping pauses during capture;
- inspect Time Sink on a known modulated signal and confirm leaving the page disables its worker snapshots;
- decode a known Bell 202/AFSK source and compare terminal text;
- receive APRS on a known local channel and verify AX.25 source/path/text plus any uncompressed coordinates;
- receive a known ACARS channel and verify CRC-valid structured blocks;
- receive a known RTTY transmission and validate sideband/polarity/tone settings;
- receive a known CW transmission and compare configured-WPM Morse text;
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

After v0.8.11 the recommended next milestone is **v0.8.12 SSTV robustness and usability**: automatic frequency/tone centering, improved line resynchronization, automatic slant assistance, partial-image recovery/history, replay workflow polish, and Scottie line-buffer correctness. After that, v0.9.0 returns to the planned feature freeze and system-wide hardening cycle.

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
