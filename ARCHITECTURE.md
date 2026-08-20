# Architecture — MAYHEM RTL v0.8.2

## Runtime layers

```text
Browser window
├── Green Shoe application shell
│   ├── Easy/Advanced Receiver
│   ├── Broadcast Radio
│   ├── Amateur Radio (USB / LSB / CW / AM / NFM)
│   ├── Scanner
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

The capability object always reports receive available, transmit unavailable and full duplex unavailable. Broadcast Radio, Amateur Radio, Scanner and ADS-B contain no transmit path.

## Remaining Mayhem convergence boundary

The C++ runtime owns application identity/registration/navigation semantics, but the exact upstream font/bitmap/theme assets, full Standard Template Library-based widget/focus tree and most native application bodies are still not byte-for-byte linked into the freestanding WebAssembly artifact. `MB200_WEB=ON` remains the complete Emscripten convergence seam.
