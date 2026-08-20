# Test plan — MAYHEM RTL v0.8.2

## Release gates

Every release must run:

```bash
npm run build
npm test
```

The build must fail on active-version inconsistency, unresolved version tokens, JavaScript syntax failures, WebAssembly compile failures, registry-generation failures or mismatched package/configuration/CMake versions.

## Version consistency

Verify one active semantic version across package metadata, JavaScript configuration, CMake, visible header, About dialog, HTML runtime marker, version-addressed entry JavaScript/CSS, generated `version.json`, service-worker URL and service-worker cache.

Simulate/source-audit an HTML-versus-JavaScript mismatch and verify stale-cache cleanup preserves the executing `APP_VERSION`, not the stale HTML version. A persistent mismatch must stop startup visibly.

## Amateur Radio automated tests

- common HF/VHF/UHF band presets exist;
- conventional defaults choose LSB/USB/CW/NFM as intended without claiming regulatory authority;
- normal R8xx profiles select Q-branch direct sampling below their tuner floor;
- zero-minimum profiles do not request unnecessary direct sampling;
- USB and LSB recover the selected sideband tone;
- the opposite sideband is strongly rejected in the deterministic fixture;
- RIT corrects a known carrier offset without changing nominal tune;
- CW generates the selected beat pitch from a tuned carrier;
- USB/LSB/CW/Amateur Radio are receive-only registry entries;
- project schema validates new amateur/SSB/CW state.

## Amateur Radio physical review

- receive a known USB amateur signal;
- receive a known LSB amateur signal;
- tune speech accurately using 10/50/100 Hz steps and RIT;
- compare 1.8/2.1/2.4/2.7/3.0 kHz SSB filters;
- verify AGC choices do not clip or pump unacceptably;
- receive a known CW carrier/signal and adjust beat pitch;
- on the reference R8xx-class receiver, verify a suitable HF band engages the expected direct-sampling path;
- return above the tuner floor and verify normal tuner operation is restored;
- record antenna/input hardware used because direct-sampling sensitivity is hardware-dependent.

## Audio-output repair review

- tune a strong broadcast FM station in WFM;
- enable browser audio after a user gesture;
- confirm prebuffer transitions to active audio;
- verify rebuffer events do not climb continuously under stable reception;
- verify mute/unmute, volume, stop/restart and AudioContext resume;
- inspect Diagnostics frames/samples pushed, queue depth, worklet drops and push errors.

## Broadcast Radio tests

Automated: FM selects WFM and normal tuner; medium-wave AM selects AM and direct sampling when required; a zero-minimum profile does not unnecessarily enable direct sampling; channel stepping stays in the preset range.

Physical: hear a strong FM station; review medium-wave AM with a suitable antenna/front end; verify low-frequency input-path indication and station save.

## Scanner tests

Automated: deterministic sequence, range wrap, threshold hit/merge, hold, lockouts, lockout clearing and bounded history.

Physical: scan a known active range, adjust threshold above the noise floor, verify hold/stop/lockout/resume and inspect exported CSV.

## ADS-B tests

Automated: CRC-valid DF17 identification frame, callsign, known even/odd airborne CPR pair, expected position/altitude, 2.4 Msps IQ pulse fixture, explicit Simulation Mode and rejection of invalid parity.

Physical: configure 1090 MHz/2.4 Msps with an appropriate antenna, observe CRC-valid frames, verify aircraft table/position pairs and export JSON without remote map/network dependencies.

## Regression tests

Retain coverage for WFM/NFM/AM fixtures, bounded AudioWorklet, Fast Fourier Transform, receive-only gating, hardware evidence metadata, receiver lifecycle, stale-session rejection, latest-request-wins commands, WebUSB device policy, Mayhem framebuffer/registry/navigation, stream planning, SharedArrayBuffer pool, governor, capture/replay, project migration, offline/service-worker behavior and no outbound runtime traffic.

## Reference hardware matrix

Record browser, operating system, receiver product, tuner, antenna/input, rate, frequency, duration, direct-sampling state and observed drops for physical validation. Do not generalize one reference configuration to all RTL-SDR hardware.
