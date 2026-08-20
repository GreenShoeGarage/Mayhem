# MAYHEM RTL

**MAYHEM RTL v0.1.0** is a browser-native, local-first, receive-only Software-Defined Radio (SDR) workbench for RTL2832U-based RTL-SDR receivers.

It is an independent browser-port foundation derived from the architecture and behavior of `mayhem-b200`. It is not an official Mayhem, PortaPack, HackRF, RTL-SDR Blog, or Ettus Research release.

The intended workflow is:

**CONNECT → TUNE → INSPECT → DEMODULATE → DECODE → CAPTURE → REVIEW → EXPORT**

## What this build contains

This development release includes a real static browser application, explicit Simulation Mode, direct WebUSB device selection, an RTL2832U/R8xx low-level transport, a bounded sample-processing worker, a small local WebAssembly sample-conversion core, spectrum and waterfall views, project autosave, station presets, local capture, replay import, compatibility reporting, diagnostics export, offline Progressive Web Application support, security headers, and automated tests.

The live RTL-SDR transport is implemented but **not yet verified on physical hardware in the build environment used to create this release**. The interface labels that state honestly. The upstream 240 × 320 Mayhem framebuffer, audio demodulators, scanner, Automatic Dependent Surveillance–Broadcast (ADS-B) decoder, and the wider application suite remain porting work; their launcher entries are visible with accurate states rather than decorative controls.

## What it is not

MAYHEM RTL does not require or use:

- a native executable;
- a Python, Node.js, Go, or WebSocket bridge at runtime;
- `sdrlink`;
- a local daemon;
- a cloud service;
- a user account;
- telemetry, analytics, advertisements, or tracking;
- remote Digital Signal Processing (DSP), Fast Fourier Transform (FFT), map, font, or script services.

The production runtime is only static Hypertext Markup Language (HTML), Cascading Style Sheets (CSS), JavaScript modules, WebAssembly, a Web Worker, a service worker, a manifest, and local icons.

## Receive-only boundary

RTL-SDR hardware is receive-only. This browser target reports:

- receive: available;
- transmit: unavailable;
- full duplex: unavailable.

Transmit applications remain visible in the compatibility screen but cannot start. No transmit, jamming, over-the-air replay, firmware update, or signal-generation command exists in this build.

## Supported browsers

Live WebUSB requires a Chromium-based browser with WebUSB support, such as current Google Chrome, Microsoft Edge, or Chromium. The application must run in a secure context: `https://` in production or `http://localhost` during development.

Simulation, project review, diagnostics, and replay can still be used in browsers without WebUSB, subject to their support for WebAssembly, Web Workers, and local storage.

The startup preflight reports each required or optional browser feature. Missing cross-origin isolation does not produce a blank page; this v0.1.0 compatibility path uses transferable buffers. Future high-rate shared-memory builds will require Cross-Origin-Opener-Policy (COOP) and Cross-Origin-Embedder-Policy (COEP).

## Receiver support

The initial transport restricts device selection to validated Realtek RTL2832U identifiers and then performs a second-stage interface and endpoint check before issuing vendor commands. It detects the R820T/R820T2/R860 family or R828D when possible. Exact differentiation within the R820T/R820T2/R860 family is not guaranteed by the exposed register identity and is therefore reported conservatively.

Target hardware families:

- RTL2832U with R820T;
- RTL2832U with R820T2;
- RTL2832U with R828D, including the RTL-SDR Blog V4 input-switching profile;
- RTL2832U with R860 where compatible with the R8xx register behavior.

## Operating-system setup

### Windows

The RTL-SDR interface normally needs the WinUSB driver rather than the television-driver binding. Use a trusted driver-binding tool such as Zadig and bind WinUSB only to the RTL-SDR receiver you intend to use. Do not replace drivers for unrelated USB devices.

### Linux

The kernel DVB driver may claim the receiver before the browser. Stop software using the stick and unbind or blacklist `dvb_usb_rtl28xxu` according to your distribution’s documented procedure. Device permissions may also require an appropriate udev rule.

### macOS

Use a current Chromium-based browser. Close native SDR applications before connecting. WebUSB behavior varies with browser and operating-system releases, so record exact test details in a hardware report.

## Build

Prerequisites:

- Node.js 20 or later;
- Clang 17 or another compiler capable of producing a freestanding `wasm32` module;
- CMake 3.20 or later for the C++20 browser-port scaffold;
- Emscripten Software Development Kit for the future full `MB200_WEB=ON` target.

Commands:

```bash
npm ci
npm run build
npm test
npm run serve
npm run package
```

`npm run serve` starts a local static server with the required security and isolation headers. Open the printed localhost address in Chrome or Edge.

The checked-in `dist/` directory is directly deployable and needs no package manager at runtime.

## First use

1. Open the application over HTTPS or localhost.
2. Review the browser preflight card.
3. Choose **Enter Simulation Mode** to verify the interface without hardware, or choose **Connect RTL-SDR** in a supported browser.
4. Select the intended receiver in the browser’s USB picker.
5. Start the receiver only after the connection state reaches **Connected — idle**.
6. Tune, adjust sample rate and gain, inspect spectrum and waterfall, save a station, or start a local capture.
7. Stop the receiver and disconnect before removing the device where practical.

The application never reconnects automatically on page load.

## Simulation Mode

Simulation Mode is explicit and persistent. It displays:

**SIMULATION — NO LIVE RADIO**

Available fixtures include multiple carriers, Amplitude Modulation (AM), Narrowband Frequency Modulation (NFM), Wideband Frequency Modulation (WFM), changing signal level, and controlled overflow/disconnect conditions. Simulation is not loaded automatically into a fresh project.

## Capture and replay

Raw captures use unsigned 8-bit interleaved In-phase and Quadrature (IQ) samples. Capture data is streamed to the Origin Private File System (OPFS) when available, with Indexed Database fallback. Long captures are not accumulated as one growing JavaScript array.

A sidecar JavaScript Object Notation (JSON) record stores sample format, actual sample rate, center frequency, tuner label, gain state, frequency correction, timestamps, version, upstream commit, dropped-sample count, notes, and verification source.

Replay accepts a local `.cu8`, `.iq`, or `.bin` file plus optional sidecar metadata. Replay is local and does not require a radio.

## Diagnostics

The Diagnostics screen records browser capability, device descriptors, tuner and accepted settings, stream counters, processing latency, ring/backlog state, capture status, application port state, and the last bounded log entries.

**Export Diagnostics** creates a local JSON package. Serial-number inclusion is optional and off by default.

## Privacy and network behavior

All samples, screenshots, captures, settings, notes, and diagnostics stay in the browser unless the user explicitly exports a file. No application code sends decoded or diagnostic data anywhere.

Run:

```bash
node scripts/verify-no-network.mjs dist
```

to audit the production distribution for remote Uniform Resource Locators (URLs) and permissive connection policies.

## Deployment

Header examples are provided for Apache, Nginx, Cloudflare Pages, Netlify, and generic static hosts under `deployment/`. The key production requirements are secure transport, same-origin assets, restrictive Content Security Policy (CSP), USB permission limited to the application origin, and safe cross-origin isolation headers for threaded builds.

## Source lineage and licenses

See:

- `NOTICE.md`;
- `SOURCE_ATTRIBUTION.md`;
- `THIRD_PARTY_LICENSES.md`;
- `PORTING_MATRIX.md`;
- `UPSTREAM_COMMIT.txt`;
- `WEBRTLSDR_COMMIT.txt`.

MAYHEM RTL is distributed under GNU General Public License version 2.0 or later. The adapted WebUSB transport retains Apache License 2.0 notices.

## Verification performed for this artifact

The v0.1.0 release was built and exercised in Chromium 144. The automated suite passed 11 JavaScript and browser-module tests plus the portable C Digital Signal Processing kernel and receive-only C++ interface tests. A full browser workflow entered explicit simulation, received local sample blocks, committed a multi-megabyte capture with zero reported drops, reopened that capture for paced local replay, verified all 16 launcher entries and both locked transmit entries, rendered diagnostics, and reloaded successfully while Chromium networking was forced offline. No JavaScript exception, browser warning, or application-generated request outside the local origin was observed.

The interface was also reviewed at wide desktop, compact desktop, tablet, and mobile-viewer sizes. See `TEST_RESULTS.md`, `tests/results/`, and `screenshots/` for the exact record. These results do not substitute for physical RTL-SDR testing.

## Known limitations in v0.1.0

- Physical RTL-SDR hardware has not yet been exercised by this build environment.
- The complete upstream Mayhem framebuffer and application registry are not linked into the current WebAssembly module.
- AudioWorklet demodulation is scaffolded but disabled until Wideband Frequency Modulation, Narrowband Frequency Modulation, and Amplitude Modulation paths are verified.
- Automatic Dependent Surveillance–Broadcast, scanner, map/graticule application output, and additional decoders are visible as pending or replay-test targets.
- The compatibility build uses transferable buffers rather than shared WebAssembly memory and therefore makes no 2.4 million-samples-per-second release claim.

See `TEST_RESULTS.md` for the exact verification record.
