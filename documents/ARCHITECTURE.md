# Architecture

## Runtime layers

```text
Browser window
├── Green Shoe application shell
│   ├── header, navigation, workspace, inspector, status strip
│   ├── startup preflight and connection state machine
│   ├── project state, stations, captures, replay, diagnostics
│   └── compatibility launcher and 240 × 320 framebuffer port target
├── WebUSB RTL2832U transport
│   ├── restricted device picker and descriptor validation
│   ├── tuner detection and R8xx control
│   ├── serialized frequency, rate, gain and correction commands
│   └── bounded asynchronous bulk-transfer pump
├── Processing Web Worker
│   ├── raw unsigned 8-bit interleaved IQ ingestion
│   ├── WebAssembly byte-to-complex conversion
│   ├── bounded queue and sequence checking
│   ├── Fast Fourier Transform and display reduction
│   └── stream and latency statistics
├── Browser storage
│   ├── Indexed Database project metadata
│   ├── Origin Private File System capture streams
│   └── local import and export
└── Service worker
    ├── offline application shell
    ├── versioned cache
    └── deferred update activation
```

## Current port boundary

The static distribution is a functional browser instrument foundation. Its low-level radio transport and processing pipeline are JavaScript/WebAssembly browser adapters. The C++20 `radio::WebUsbRtlSdrRadio` class and Emscripten target are present as the intended integration seam, but the complete upstream Mayhem application suite is not yet linked into this v0.1.0 WebAssembly core.

This boundary is intentionally visible in the interface and `PORTING_MATRIX.md`. The browser shell does not claim its port-target canvas is the authentic upstream framebuffer until that linkage exists.

## State isolation

A monotonically increasing connection-session identifier is attached to every asynchronous transfer and command completion. Results from a closed or superseded session are ignored. Device-control commands use a serial queue, while the receive pump remains asynchronous and independent of the visual frame rate.

## Sample ownership

Raw WebUSB blocks remain `ArrayBuffer` objects. They are never expanded into object-per-sample structures. In normal receive operation, a block is transferred to the processing worker. During capture, one additional copy is written to persistent storage while the original is transferred to the worker.

## Receive-only enforcement

The browser capability object always reports receive available, transmit unavailable, and full duplex unavailable. The compatibility manifest gates every application. No transmit method exists in the JavaScript transport, and the C++ scaffold returns an explicit receive-only error for transmit calls.

## Shared-memory roadmap

The v0.1.0 compatibility build uses transferable buffers and runs without `SharedArrayBuffer`. A later threaded build will use cross-origin isolation, shared WebAssembly memory, and a single-producer/single-consumer ring. Hosting examples already emit Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy so deployment does not need to be redesigned later.
