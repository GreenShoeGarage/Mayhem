# Compatibility

## Browser capability levels

### Live receiver

Requires a secure context and a Chromium-based browser exposing WebUSB, WebAssembly, module Web Workers, Canvas, and persistent browser storage.

### Simulation and replay

Requires WebAssembly or the JavaScript conversion fallback, module Web Workers, Canvas, and local file access. WebUSB is not required.

### Future threaded high-rate build

Will additionally require `crossOriginIsolated === true`, `SharedArrayBuffer`, and WebAssembly thread support.

## Known receiver identifiers

The device picker currently restricts selection to Realtek vendor identifier `0x0bda` and product identifiers `0x2832` or `0x2838`. After selection, the transport validates the active configuration, control interface, and bulk input endpoint before issuing tuner commands.

This conservative list deliberately excludes unverified clone identifiers. New identifiers should be added only with descriptor evidence and a recorded hardware test.

## Application compatibility states

The browser launcher uses the following states:

- ready;
- partial;
- unavailable for connected hardware;
- transmit-only;
- requires unsupported frequency;
- requires unsupported bandwidth;
- requires unsupported sample rate;
- browser port pending;
- simulated only;
- unit-tested;
- replay-tested;
- hardware-tested;
- on-air behavior unverified.

The runtime manifest in `web/src/apps/compatibility-manifest.js` is the current machine-readable source.
