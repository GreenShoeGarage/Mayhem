# Compatibility

## Capability levels

### Live receiver

Requires a secure context and a current Chromium-based browser exposing WebUSB,
WebAssembly, module Web Workers, Canvas, and browser storage.

### Live audio receiver

Adds AudioWorklet. Audio starts only after an explicit user gesture.

WFM, NFM, and AM DSP paths are deterministic-fixture tested and have also been
user-validated on-air on the recorded `RTL2838UHIDIR` reference configuration.
That evidence does not imply equivalent results for every receiver, tuner,
browser, or operating system.

### Shared high-rate handoff

When all of the following are true, MAYHEM RTL v0.7.0 uses the shared raw-sample
pool automatically:

- `crossOriginIsolated === true`;
- `SharedArrayBuffer` is available;
- the page was served with the supplied Cross-Origin-Opener-Policy and
  Cross-Origin-Embedder-Policy headers.

Diagnostics reports `shared-block-pool` when active. If these requirements are
not met, the application uses transferable `ArrayBuffer` handoff.

The reference configuration has now passed the v0.6 shared-path and 2.4 Msps
validation gate. The shared raw-input path is still not the same as a full
threaded Emscripten/shared-WebAssembly-memory build.

## Streaming profiles

- **Automatic:** selects conservative, balanced, or high-rate transport settings
  from configured sample rate.
- **Compatibility:** fixed conservative transport and lower display ceiling.
- **High-rate:** larger blocks and deeper bounded queues.
- **Custom:** operator-controlled bounded values; changes apply on receiver
  restart.

The recorded reference configuration has completed both the 1.024 Msps soak and
the 2.4 Msps / 60-minute target validation.

## Known receiver identifiers

The picker currently restricts selection to Realtek vendor identifier `0x0bda`
and product identifiers `0x2832` or `0x2838`. A second-stage
configuration/interface/endpoint validation runs before tuner commands.

Unverified clone identifiers are deliberately excluded until descriptor evidence
and a physical test record exist.

## Recorded physical reference configuration

Reference product: `RTL2838UHIDIR`

Conservative tuner identification: R820T/R820T2/R860 family.

Recorded successful checks:

- direct WebUSB connection;
- live spectrum/waterfall;
- retuning while receiving;
- gain and sample-rate changes;
- stop/restart;
- hot-unplug/reconnect;
- 30-minute 1.024 Msps soak with zero visible drops;
- on-air WFM, NFM, and AM audio;
- AudioContext lifecycle;
- 60-minute 2.4 Msps target soak;
- 2.4 Msps receive plus capture;
- SharedArrayBuffer stream path;
- sustained audio without unacceptable recurring underruns;
- bounded long-run memory/queue behavior.

This does not establish support for every RTL2832U receiver, browser, operating
system, tuner family, or sample rate.

## Pending compatibility evidence

- R828D physical device;
- exact R860 physical identification;
- wider current Chrome / Edge / Chromium operating-system matrix;
- additional RTL2832U clone/device profiles.

## v0.7 Mayhem core compatibility

Version 0.7.0 uses native C++ `app::Registrar` translation units and a C++
Home → Category → Application navigation stack inside WebAssembly. The browser
shell checks that registry identity/order still matches the one generated
cross-language definition.

Exact upstream fixed-font bytes, bitmap/theme assets, and the complete upstream
widget/focus implementation remain source-convergence work and are not described
as complete compatibility.

## Application states

The launcher retains visible entries for supported, pending, and transmit-only
applications. Verification terminology includes:

- ready;
- partial;
- unavailable for connected hardware;
- transmit-only;
- browser port pending;
- unit-tested;
- replay-tested;
- simulation-tested;
- hardware-tested;
- on-air behavior unverified.

Transmit applications remain visible and locked on RTL-SDR hardware.
