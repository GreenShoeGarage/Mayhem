# Test results

Version: **0.8.2**  
Upstream commit: `44736b9ca844732e18f35e86eb5beece1d9c2c57`  
Web RTL-SDR reference commit: `5699cec220cb0349e8f9144b7b71d3d03b5d9dbf`

## Verification boundary

This is a truthful development release. Automated JavaScript/browser-module tests, portable C Digital Signal Processing (DSP) tests, receive-only C++ contract tests, C++ Mayhem registry/UI tests, WebAssembly compilation, registry generation, active-version consistency checks and the built-runtime no-network audit are executed in the artifact environment.

The reference live-receive/high-rate evidence is carried forward from physical testing. The browser audio-output layer changed in v0.8.1 after the reported no-audio/continuous-underrun condition, so the current repaired audio path remains **pending focused physical re-validation**. USB/LSB/CW are deterministic-fixture tested in v0.8.2 and are not labeled on-air verified.

## Automated commands

```bash
npm run build
npm test
```

## Result summary

- **54 JavaScript/browser-module tests passed.**
- Portable C DSP kernel tests passed.
- Receive-only C++ `RadioDevice` contract tests passed.
- C++ Mayhem UI/registry tests passed, including all generated native file-scope `Registrar` application units.
- `dist/assets/dsp_core.wasm` compiled successfully.
- `dist/assets/mayhem_core.wasm` compiled successfully.
- Built-distribution no-network audit passed.
- Active-version/service-worker regression tests passed.

## v0.8.2 Amateur Radio coverage

Automated tests verify:

- common 160 m–70 cm receive presets are present;
- conventional 40 m LSB, 20 m USB, 30 m CW and 2 m NFM defaults;
- ordinary R8xx-class profiles select Q-branch direct sampling for HF below the tuner floor;
- zero-minimum-frequency profiles do not request unnecessary direct sampling;
- USB recovers its selected sideband fixture and strongly rejects the opposite sideband;
- LSB recovers its selected sideband fixture and strongly rejects the opposite sideband;
- RIT corrects a known carrier offset without changing nominal hardware tune;
- CW produces the configured beat pitch from a carrier at the tuned frequency;
- USB/LSB/CW/Amateur Radio are receive-only registered applications;
- project schema accepts the new SSB/CW/AGC/RIT state.

The worker DSP fixtures exercise IQ-to-audio behavior rather than merely checking labels or menu entries.

## Audio-output stabilization carried from v0.8.1

Automated tests continue to verify:

- WFM/NFM/AM deterministic audio fixtures;
- fixed-size AudioWorklet ring structure;
- bounded prebuffer/rebuffer behavior;
- zero-input source configuration contract;
- worker/audio frame handoff without duplicate transferred-buffer cloning;
- queue/rebuffer/drop diagnostic state.

These tests do not replace the requested physical listening re-check of the repaired browser audio-output path.

## Broadcast Radio / Scanner / ADS-B coverage

Broadcast tests cover WFM/AM preset selection, normal-tuner versus direct-sampling decisions and regional-neutral channel steps.

Scanner tests cover deterministic sequence, threshold hits, hold behavior, range wrapping, lockouts, lockout clearing and bounded discovery history.

Automatic Dependent Surveillance–Broadcast (ADS-B) tests cover Mode S 24-bit Cyclic Redundancy Check, a known callsign fixture, a known even/odd global Compact Position Reporting pair, 2.4 million-samples-per-second IQ pulse recovery and the explicit Simulation Mode fixture. On-air aircraft reception remains pending.

## Version-consistency verification

The active semantic version is checked across:

- `package.json`;
- `web/src/config.js`;
- CMake;
- visible header/About token injection;
- HTML `data-app-version` runtime marker;
- version-addressed entry JavaScript and Cascading Style Sheets;
- generated `version.json`;
- versioned service-worker registration;
- service-worker cache namespace.

The startup guard compares the executing JavaScript `APP_VERSION` with the HTML build marker before normal application initialization. Regression coverage verifies stale-cache cleanup preserves the executing/current version cache rather than the stale HTML cache.

## Physical reference evidence carried forward

Reference device: `RTL2838UHIDIR`  
Conservative tuner label: R820T/R820T2/R860 family.

Recorded receive/high-rate checks include:

- direct WebUSB connection;
- live sample reception;
- spectrum and waterfall;
- retune while receiving;
- gain and sample-rate changes;
- stop/restart;
- hot unplug/reconnect;
- 30-minute 1.024 Msps soak with zero visible drops;
- 60-minute 2.4 Msps target soak;
- 2.4 Msps receive plus capture;
- SharedArrayBuffer handoff;
- bounded long-run memory and queue behavior.

Earlier builds also produced on-air WFM/NFM/AM audio, but the current repaired AudioWorklet/output path is intentionally not promoted from that historical evidence without a new focused physical re-check.

## Browser smoke boundary

Recent artifact-environment Chromium runs have not reliably completed localhost navigation within the bounded smoke-test window. Therefore v0.8.2 does **not** claim a new full interactive Chromium end-to-end run from the artifact environment. The browser/module tests, build/runtime audits and prior historical browser evidence remain separate from target-machine operator review.

## Not yet verified

- repaired v0.8.1+ browser audio output on the physical reference system;
- on-air USB amateur reception;
- on-air LSB amateur reception;
- on-air CW reception and beat-pitch adjustment;
- practical HF direct-sampling sensitivity/input behavior in the new Amateur Radio workspace;
- focused medium-wave Broadcast AM workflow on the current repaired audio layer;
- on-air ADS-B aircraft decoding;
- broader live Scanner use;
- R828D physical hardware;
- exact R860 physical identification;
- multi-device / cross-browser / cross-operating-system matrix;
- exact upstream font/bitmap/theme/widget/native-application convergence in browser WebAssembly.

No pending item above should be relabeled hardware-tested or on-air verified until recorded evidence supports it.
