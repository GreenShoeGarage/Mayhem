# Security

MAYHEM RTL is a receive-only static browser application.

## Runtime boundaries

The production build does not use:

- a native companion daemon;
- a local WebSocket service;
- a cloud API;
- telemetry;
- analytics;
- remote DSP;
- remote fonts or scripts.

The WebUSB picker is restricted to known RTL2832U identifiers and a second-stage descriptor/interface/endpoint check occurs before tuner vendor commands.

## Content and permissions policy

Deployment examples provide:

- Cross-Origin-Opener-Policy: `same-origin`;
- Cross-Origin-Embedder-Policy: `require-corp`;
- Cross-Origin-Resource-Policy: `same-origin`;
- Permissions Policy limiting USB to the application origin and disabling camera/microphone/geolocation;
- restrictive Content Security Policy;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`.

## SharedArrayBuffer in v0.6

Version 0.6.0 may use SharedArrayBuffer only when the browser confirms cross-origin isolation.

The shared raw-sample path uses a fixed-slot pool. Slots are not silently overwritten. A slot is released only after worker acknowledgement. Pool exhaustion rejects the processing block and feeds visible drop accounting.

The shared memory carries raw radio sample bytes only inside the application's origin/process boundary. It is not transmitted over the network.

The current DSP WebAssembly memory is not shared; v0.6 does not claim a pthread/shared-WebAssembly-memory runtime.

## Receive-only enforcement

The browser radio capability model has no supported transmit path. Transmit applications remain visible but gated. No firmware update, jamming, over-the-air replay, or signal-generation command is implemented.

## Imports and decoded text

Imported project/capture metadata is parsed as data, validated, bounded in size where applicable, and never executed. User/decoded strings are inserted through text-oriented DOM APIs rather than unsafe HTML assignment where they originate from untrusted content.

## Reporting

Security issues should include the application version, browser/operating system, reproduction steps, and the smallest safe diagnostic package necessary to reproduce the behavior. Device serial inclusion in exported diagnostics is off by default.
