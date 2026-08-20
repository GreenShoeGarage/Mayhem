# Test results

Version: 0.1.0  
Upstream commit: `44736b9ca844732e18f35e86eb5beece1d9c2c57`  
Web RTL-SDR reference commit: `5699cec220cb0349e8f9144b7b71d3d03b5d9dbf`  
Executed: `2026-08-20T02:35:38Z`

## Verification boundary

This is a truthful development release. Automated, simulation, local-capture, local-replay, offline, and responsive-browser paths were exercised. Physical RTL-SDR hardware, on-air decoding, and demodulated audio were not available in the artifact-generation environment and are not marked hardware-tested.

## Test environment

- Operating system: Debian GNU/Linux 13 container, Linux `6.18.35`, x86-64
- Node.js: `22.16.0`
- npm: `10.9.2`
- Chromium: `144.0.7559.96`
- Clang: `17.0.0`
- CMake: `3.31.6`
- Browser test origin: `http://127.0.0.1:4173/` with the supplied Cross-Origin-Opener-Policy, Cross-Origin-Embedder-Policy, Cross-Origin-Resource-Policy, Content Security Policy, and Permissions Policy headers

## Automated test command

```bash
npm run build
npm test
```

Results:

- 11 JavaScript and browser-module tests passed.
- Portable C Digital Signal Processing kernel tests passed.
- Receive-only C++ `RadioDevice` contract tests passed.
- The production build completed with a real local WebAssembly module at `dist/assets/dsp_core.wasm`.
- The outbound-runtime audit found no remote runtime URL literals and no permissive connection policy.

The automated suite covers Fast Fourier Transform behavior, project validation, application compatibility and transmit gating, connection-state legality, latest-request-wins command serialization, restricted WebUSB identifiers, second-stage device rejection, and replay pacing after the sample `ArrayBuffer` has been transferred to a worker.

## Full Chromium workflow smoke test

Viewport: `1600 × 1000` CSS pixels.

Observed results:

- Home rendered with 10 browser and hosting preflight checks.
- The processing worker reported `WebAssembly development build`.
- Workspace `scrollWidth` equaled `clientWidth`; no horizontal workspace overflow was present.
- Explicit Simulation Mode displayed `SIMULATION — NO LIVE RADIO` continuously.
- The synthetic receiver became active at 1.024 million samples per second, reported approximately `-4.4 dBFS`, and showed zero dropped samples during the observed interval.
- Streaming capture started, wrote approximately `2.69 MiB`, closed as `complete`, and reported zero dropped samples.
- The capture library displayed the committed record.
- The committed capture was reopened locally and replay became active at half-speed with the persistent `REPLAY — LOCAL CAPTURE, NO LIVE RADIO` banner.
- The launcher displayed 16 application entries. Both transmit entries remained visible and locked.
- Diagnostics rendered four first-class evidence cards.
- The service worker became the active controller; after Chromium networking was forced offline, a reload still rendered the home view and initialized the local WebAssembly processing worker.
- JavaScript exceptions: `0`.
- browser security or console warnings: `0`.
- application-generated requests outside the local origin: `0`.

Machine-readable results are stored in `tests/results/browser-smoke-v0.1.0.json`.

## Responsive browser smoke test

The shell was exercised at:

- wide desktop: `1600 × 1000`;
- compact desktop: `1024 × 768`;
- tablet: `820 × 900`;
- mobile viewer: approximately `390 × 844`.

The workspace had no horizontal overflow at any tested width. Metric cards changed from four columns to two and then one. The tablet hid the contextual inspector. The mobile viewer started with navigation closed, opened it from the menu button, and closed it again after navigation. No JavaScript exception or browser warning was observed.

Machine-readable results are stored in `tests/results/responsive-smoke-v0.1.0.json`. Review screenshots are stored under `screenshots/`.

## Not yet verified

- Direct WebUSB initialization of a physical RTL2832U receiver
- R820T, R820T2, R828D, or R860 hardware detection
- Actual accepted frequency, sample rate, gain, frequency correction, direct sampling, or bias-tee behavior on hardware
- Sustained 1.024 or 2.4 million-samples-per-second hardware soak performance
- Wideband Frequency Modulation, Narrowband Frequency Modulation, or Amplitude Modulation audio output
- Automatic Dependent Surveillance–Broadcast or other on-air decoder behavior
- Authentic upstream 240 × 320 Mayhem framebuffer and application-registry linkage

No item above may be relabeled `hardware-tested` or `on-air verified` until recorded physical testing supports that claim.
