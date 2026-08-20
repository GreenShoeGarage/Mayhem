# Architecture

## Runtime layers — v0.7.0

```text
Browser window
├── Green Shoe application shell
│   ├── Easy Mode receiver control deck
│   ├── Advanced Mode inspector / diagnostics
│   ├── project state, stations, captures, replay
│   └── Canvas presenter for the 240 × 320 Mayhem WebAssembly framebuffer
│
├── WebUSB RTL2832U transport
│   ├── restricted device picker + descriptor validation
│   ├── tuner detection and R8xx control
│   ├── serialized actual-value frequency/rate/gain commands
│   └── bounded asynchronous USB transfer pump
│
├── Stream planner / Processing Web Worker
│   ├── rate-aware bounded transport plan
│   ├── transferable ArrayBuffer OR SharedArrayBuffer fixed-slot input
│   ├── WebAssembly unsigned-8-bit IQ conversion
│   ├── WFM / NFM / AM audio demodulation on every accepted block
│   └── FFT / reduced spectrum publication
│
├── Adaptive performance governor
│   ├── queue pressure / worker time / capture backlog
│   ├── drop and audio-underrun changes
│   └── visualization load shedding before radio/audio work
│
├── AudioWorklet
│   ├── fixed-size Float32 ring
│   ├── volume / mute
│   └── underrun reporting
│
├── Mayhem C++ WebAssembly runtime (v0.7 convergence)
│   ├── src/mayhem/ui.*            upstream-shaped geometry/Color/KeyEvent
│   ├── src/mayhem/display.*       browser framebuffer display adapter
│   ├── src/mayhem/painter.*       text/line/rectangle painter
│   ├── src/mayhem/app_registry.*  native file-scope Registrar registry
│   ├── src/mayhem/navigation.*    Home → Category → Application stack
│   ├── src/mayhem/runtime.*       framebuffer + mirrored radio state
│   └── src/generated_apps/*.cpp   one C++ Registrar translation unit per app
│
├── Browser storage
│   ├── Indexed Database project + metadata
│   ├── Origin Private File System capture streams
│   └── local import / export
│
└── Service worker
    ├── offline static shell
    ├── versioned cache
    └── deferred update activation
```

## v0.7 runtime-convergence boundary

Version 0.7 removes the previous monolithic `core_mayhem_bridge.cpp` implementation.
The bridge now exposes only the browser-facing C ABI. Rendering, navigation,
registry behavior and radio-state presentation are implemented in separate C++
modules under `src/mayhem/`.

The geometry, RGB565 `Color` packing, 8 × 16 character metrics and `KeyEvent`
ordinals match the audited `mayhem-b200` UI primitives at the pinned upstream
commit. The Painter follows the same rule as the host port: applications paint
through a display abstraction rather than directly into browser JavaScript.

The exact upstream fixed-font byte table, icon/theme resources and complete
STL-based widget/focus tree are not yet byte-for-byte compiled into the
freestanding stock-clang WebAssembly build. `UPSTREAM_RUNTIME_AUDIT.md` records
that boundary explicitly.

## Native application registration

`src/app_registry.json` remains the cross-language build definition. During
`npm run build`, it produces:

- `web/src/apps/generated-registry.js` for browser compatibility metadata; and
- one C++ source file per app under `src/generated_apps/`.

Each generated C++ translation unit declares a file-scope `app::Registrar`.
The WebAssembly build exports `__wasm_call_ctors`; the browser invokes it once
before reading the registry. This means the C++ core is populated through
static registration semantics rather than a compiled array included by the C
ABI bridge.

The registry uses fixed storage in the freestanding core instead of
`std::vector`, but duplicate-ID rejection, category lookup, application identity
and registration ownership follow the upstream host design.

## Navigation ownership

The C++ core now owns a true push/pop navigation stack:

```text
Home
  ↓ Select
Category
  ↓ Select
Application frame
```

Back pops Application → Category → Home. Selecting an app also emits one
consumable activation event so the Green Shoe shell can show the corresponding
large browser-native panel without pretending that the browser owns the Mayhem
navigation state.

## Radio-state mirror

The live WebUSB device remains controlled by the proven browser transport. The
C++ logical runtime receives the *actual* accepted state for presentation:

- center frequency;
- sample rate;
- receive level;
- tuner-family code;
- automatic/manual gain and actual gain;
- dropped-sample count;
- radio error count;
- live/simulation/replay source state.

This is not yet the final direct app-to-WebUSB `radio::RadioDevice` call path.
The checked-in `MB200_WEB=ON` Emscripten target now includes the same v0.7
Mayhem runtime modules and remains the seam for that later complete C++ control
path.

## Stream ownership

WebUSB sample blocks arrive as `ArrayBuffer` objects containing unsigned 8-bit
interleaved I/Q values.

### Transferable path

The compatibility path transfers ownership of the `ArrayBuffer` to the
processing worker.

### Shared raw-input pool

When cross-origin isolation and `SharedArrayBuffer` are available, the main
thread owns a fixed eight-slot shared pool. Each slot is 131,072 bytes, enough
for 65,536 complex unsigned-8-bit interleaved samples. A slot cannot be reused
until the worker acknowledges it.

The DSP WebAssembly module still owns separate non-shared memory, so this is a
shared raw-input handoff rather than a claim that the full Mayhem runtime uses
shared WebAssembly memory.

## Adaptive load shedding

The critical sample loop never runs in `requestAnimationFrame()`. The
performance governor protects radio/audio work before visualization:

- normal: spectrum every block;
- busy: spectrum every second block;
- critical: spectrum every fourth block.

Audio demodulation runs before the spectrum-stride decision and remains on every
accepted block.

## State isolation

A monotonically increasing connection-session identifier is attached to
asynchronous USB work. Results from a closed or superseded session are ignored.
Device-control commands are serialized with latest-request-wins behavior where
appropriate.

## Capture ownership

When capture is active, `CaptureStore.append()` makes a capture-owned copy
before worker handoff. Long captures stream to the Origin Private File System
when available and Indexed Database otherwise.

## Receive-only enforcement

The capability object always reports:

```text
has_rx = true
has_tx = false
full_duplex = false
```

Transmit applications remain visible and locked. No radio-transmit method exists
in the browser WebUSB transport.
