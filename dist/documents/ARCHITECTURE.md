# Architecture — MAYHEM RTL v0.8.11

## Runtime layers

```text
Browser window
├── Green Shoe application shell
│   ├── task-grouped Start / Listen / Decode / Analyze / Review / Support navigation
│   ├── Easy/Advanced Receiver
│   ├── searchable Receiver Library
│   ├── Broadcast Radio
│   ├── Amateur Radio (USB / LSB / CW / AM / NFM)
│   ├── Scanner
│   ├── Signal Analysis Suite
│   ├── Digital Decoder Suite
│   ├── POCSAG pager receiver
│   ├── ADS-B structured panel + local graticule
│   ├── projects / stations / capture / replay / diagnostics
│   └── 240 × 320 Mayhem WebAssembly framebuffer presenter
│
├── WebUSB RTL2832U transport
│   ├── restricted device picker + descriptor validation
│   ├── tuner detection and R8xx control
│   ├── normal tuner / RTL2832U direct-sampling input selection
│   ├── serialized actual-value tuning/rate/gain commands
│   └── bounded asynchronous USB sample pump
│
├── Stream planner + bounded sample handoff
│   ├── rate-based transport profiles
│   ├── transferable ArrayBuffer path
│   └── SharedArrayBuffer fixed-slot pool when isolated
│
├── Processing Web Worker
│   ├── raw unsigned-8-bit In-phase/Quadrature (IQ) ingestion
│   ├── WebAssembly byte-to-complex conversion
│   ├── WFM / NFM / AM demodulation
│   ├── USB / LSB complex sideband filtering + Receiver Incremental Tuning
│   ├── CW narrow filtering + beat oscillator
│   ├── audio Automatic Gain Control
│   ├── ADS-B magnitude/preamble/pulse-position/Mode-S decoder
│   ├── continuous AFSK/APRS/ACARS/RTTY/Morse decoder family
│   ├── continuous POCSAG FM/clock/sync/BCH decoder
│   ├── bounded Time Sink I/Q snapshot publication
│   ├── Fast Fourier Transform / averaging / peak work
│   └── reduced spectrum / audio / decoder-result publication
│
├── AudioWorklet
│   ├── fixed-size Float32 ring
│   ├── bounded prebuffer / rebuffer state
│   ├── volume / mute
│   └── queue / drop / rebuffer reporting
│
├── C++ Mayhem WebAssembly core
│   ├── UI geometry/color/key primitives
│   ├── framebuffer display + painter
│   ├── native app::Registrar registry
│   ├── Home → Category → Application navigation
│   └── mirrored receiver/tuner/gain/drop/error state
│
├── Browser storage
│   ├── Indexed Database
│   ├── Origin Private File System
│   └── local import / export
│
└── Service worker
    ├── offline static shell
    ├── semantic-version cache namespace
    ├── network-first version-sensitive assets
    └── deferred update activation
```

## v0.8.11 shell and navigation ownership

Version 0.8.11 changes presentation and routing organization, not radio ownership. The shell groups existing routes by operator task: **Start**, **Listen**, **Decode**, **Analyze**, **Review**, and **Support**. Route identifiers and decoder controllers remain unchanged, so moving an entry in the navigation does not create another radio, sample path, or storage model.

Home is a task router over the same source controller used everywhere else. It exposes one source summary and sends task buttons into existing application routes/presets. The Receiver Library reads the existing application registry and applies browser-side search/task filters; it does not maintain a second capability database. Transmit-required applications remain unavailable because of the receive-only hardware policy and are filtered into a separate Unavailable view.

Easy Mode is now a deliberate information-density policy: system/implementation telemetry and support tooling carry `advanced-status` / `advanced-control` markers, while core source, frequency, level, audio, drop, and capture state remains visible. Advanced Mode exposes the existing detail rather than loading a different runtime.

The general Receiver owns the stateful Start/Stop control. Automatic gain hides the manual slider at the presentation layer; changing gain mode still uses the same serialized hardware settings path. Modern decoder pages use the common Application inspector in Advanced Mode so context remains stable when moving among decoder workspaces.

## Amateur Radio ownership

`radio/amateur-radio.js` owns only band presets, conventional receive defaults, frequency clamping and the decision about whether a desired frequency is reachable through the normal tuner path or requires RTL2832U direct sampling. It does not create a second radio model.

Actual direct-sampling changes and tuning go through the shared serialized WebUSB radio control path. If a live band change requires a different input path, reception is stopped, the hardware path is changed, the frequency is tuned, and reception is restarted when appropriate.

The band list is a tuning convenience. It is not a regulatory database and has no transmit capability.

## SSB/CW processing

Upper Sideband (USB), Lower Sideband (LSB), and Continuous Wave (CW) processing stays in the signal-processing Web Worker.

For SSB:

```text
IQ → decimate → optional digital RIT rotation → complex sideband FIR
   → real audio → optional audio AGC → resample → AudioWorklet
```

USB selects the positive-frequency sideband and LSB selects the negative-frequency sideband. The deterministic fixtures verify recovery of the selected sideband and rejection of the opposite sideband.

For CW:

```text
IQ → decimate → optional RIT → narrow complex low-pass
   → configurable beat oscillator → audio AGC → resample → AudioWorklet
```

The current implementation uses bounded state across radio blocks. It does not move demodulation into `requestAnimationFrame()`.

## Broadcast Radio ownership

Broadcast Radio is another workflow controller over the same shared receiver. FM selects WFM. Medium-wave AM selects AM and requests direct sampling when the connected profile cannot reach the band through its normal tuner path.

## Scanner ownership

`ScannerController` owns scan sequencing, hit history and lockouts. Actual tuning uses the same serialized hardware command queue as manual tuning. A hit is only a threshold crossing.

## Signal Analysis ownership

`analysis/signal-analysis.js` contains reusable, browser-side analysis primitives: noise-floor estimation, separated spectrum-peak search, bounded level history, activity timing/hysteresis, relative-strength mapping, wideband sweep accumulation and deterministic range-hop sequencing. These consume reduced worker telemetry/spectrum products rather than opening another raw-sample path.

Looking Glass and Signal Hunter use the same serialized `tuneTo()` path as manual tuning and Scanner. Looking Glass serially retunes and stitches fresh FFT slices. Signal Hunter can remain on one frequency or serially hop a range; a trigger reuses the existing streaming local capture store and pauses hopping for the capture duration. There is no simultaneous multi-frequency receive claim.

Time Sink is the only v0.8.4 feature that asks the processing worker for an additional data product. The worker rate-limits a bounded 64–2048 point downsampled I/Q snapshot and transfers only those reduced arrays to the UI. Raw IQ capture remains the continuous evidence path.

## ADS-B pipeline

At 1090 MHz / 2.4 million samples per second (Msps):

```text
IQ → magnitude → preamble detection → pulse-position bit sampling
   → 112-bit Mode S frame → Cyclic Redundancy Check gate
   → supported extended-squitter parser → aircraft tracker / CPR pairing
   → browser structured result
```

No decoder processing runs in the visual animation loop, and the local graticule uses no external map service.

## Version ownership

`package.json` is the packaging semantic-version source. Build guards require the same value in JavaScript configuration and CMake. The build injects the version into the visible HTML header/About surfaces, the HTML runtime marker, version-addressed entry JavaScript/CSS and service-worker cache, then writes the same value to `version.json`.

At browser startup, the HTML build version is compared with the executing JavaScript `APP_VERSION` before normal initialization. A mismatch triggers one controlled service-worker/cache update and cache-busted reload. Stale MAYHEM RTL caches are removed while the executing/current version cache is preserved. A persistent mismatch throws rather than allowing a mixed-version UI.

## Receive-only enforcement

The capability object always reports receive available, transmit unavailable and full duplex unavailable. Broadcast Radio, Amateur Radio, Scanner, the Signal Analysis Suite, Digital Decoder Suite, POCSAG and ADS-B contain no transmit path.

## Remaining Mayhem convergence boundary

The C++ runtime owns application identity/registration/navigation semantics, but the exact upstream font/bitmap/theme assets, full Standard Template Library-based widget/focus tree and most native application bodies are still not byte-for-byte linked into the freestanding WebAssembly artifact. `MB200_WEB=ON` remains the complete Emscripten convergence seam.



## Digital Decoder stream ownership

AFSK, APRS, ACARS, RTTY and Morse consume the same continuous `Float32Array` I/Q blocks already produced by the processing worker after byte conversion/DC handling. Decoder state is preserved across source blocks. No decoder polls a canvas, spectrum snapshot, or `requestAnimationFrame()`, and speaker AudioWorklet delivery is an independent optional branch.

The shared browser decoder module owns tone-pair symbol decisions, asynchronous serial framing, AX.25 CRC/HDLC helpers, ACARS block framing/CRC, ITA2 state and Morse timing. APRS and ACARS emit structured events; AFSK/RTTY/Morse emit text events. The processing client forwards only reduced decoder events/status to the window.

ACARS tunes the hardware by `channel + IF offset` and digitally shifts by the inverse offset before AM detection. Morse uses a fixed 2 kHz equivalent IF offset plus digital RIT before CW filtering/envelope timing. These offsets are deliberate protections against the RTL2832U/per-block DC-removal notch, not claims that the radio channel itself is offset.

## POCSAG stream ownership

The POCSAG decoder consumes the same gap-aware worker IQ blocks used by the rest of the receive pipeline. It does not poll the spectrum display and it is not tied to `requestAnimationFrame()`. The decoder preserves discriminator, decimator, bit-clock, sync-search, BCH, and message-assembly state across worker blocks. Optional FSK monitor audio is a separate NFM/audio-output path; disabling speaker audio does not disable POCSAG decoding.

## Sub-GHz telemetry path

The v0.8.6 telemetry path is `continuous IQ -> worker DC removal -> adaptive magnitude slicer -> high/low pulse durations -> protocol decoder -> structured local observation -> browser table/export`. TPMS and Weather share this path. The initial promoted protocols are Schrader-style OOK/Manchester TPMS and Nexus TH Weather. Wider FSK TPMS and weather-protocol coverage remains pending deterministic fixtures.

## v0.8.8 paging receive path

FLEX and Two-Tone consume the same continuous converted IQ blocks as the rest of the receive pipeline. `pagingMode` selects one worker-side decoder and emits structured `paging` / `paging-status` events through `ProcessingClient`. No decoder reads the visual spectrum snapshot. FLEX uses a continuous 1600 bit/s discriminator/bit clock and BCH/FIW/Phase-A parser; Two-Tone uses NFM audio derived in-worker and a fixed Motorola/EIA Goertzel bank with sequential A/B state.


## v0.8.9 Tracking & Beacons receive path

AIS, RS41 and 406 MHz beacon decoding run entirely in the processing worker from the same continuous converted I/Q blocks used by the other decoders. `trackingMode` selects the active tracking decoder and `ProcessingClient` forwards only reduced `tracking` / `tracking-status` events to the window. No visual spectrum snapshot or animation-frame polling participates in decoding.

AIS uses a 162.000 MHz hardware center and two digital branches at -25 kHz/+25 kHz for channels A/B. Each branch performs FM discrimination, fixed 9600-bit/s timing, NRZI decoding, HDLC flag/bit-stuff handling, CRC-16/X-25, then structured message parsing.

RS41 uses 4800-bit/s 2FSK, a sync search for the upstream on-air header, the 64-byte Vaisala XOR mask, CRC-16/CCITT-FALSE on status/measurement/GPS blocks, and ECEF-to-geodetic position conversion. Calibration-dependent temperature/humidity is intentionally not promoted in this first browser slice.

The 406 MHz path is passive receive-only. To protect the long unmodulated carrier from blockwise DC removal, live/simulation tuning places the beacon at a small known intermediate-frequency offset; the decoder digitally translates it to baseband before carrier/biphase-L recovery. The decoded long frame is validated with BCH-1/BCH-2 before the promoted Standard Location PLB fields are surfaced.


## v0.8.10 SSTV receive path

SSTV consumes the same continuous converted I/Q blocks as the other worker-side decoders; it never polls the visual spectrum or browser animation loop. The path is `IQ -> optional channel NCO -> stateful decimation to approximately 48 kHz -> USB analytic audio or FM discriminator -> 1750-Hz-centered tone estimator -> VIS -> line synchronizer/pixel clock -> 320-pixel RGB scanline -> reduced worker event -> progressive browser canvas`.

The decoder configuration is applied when settings change, not once per USB block. This is a correctness requirement because an SSTV picture lasts roughly minutes and VIS/line timing state must span hundreds of source blocks. Phase and slant controls update the line decoder without restarting the entire receive chain.

The browser retains reconstructed pixels only; raw IQ evidence continues to use the existing capture store. Capture metadata now records the SSTV application/input/mode/VIS/phase/slant state so replay can reopen the SSTV workspace with matching settings.
