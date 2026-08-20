# Test plan — MAYHEM RTL v0.8.11

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

## Signal Analysis Suite tests

Automated:

- estimate a deterministic spectrum noise floor and find separated local peaks;
- Detector respects minimum-active time, hysteresis and release timing;
- Level history remains bounded and tracks mean/peak/minimum;
- Fox Hunt relative-strength mapping stays bounded;
- Looking Glass stitches multiple tuned FFT slices into one max-hold range;
- Signal Hunter range stepping starts at the range edge, advances by step and wraps deterministically;
- all seven Signal Analysis applications are generated as ready receive-only registry entries;
- Time Sink worker publication is rate-limited and point-bounded;
- Signal Hunter reuses the normal capture store rather than creating a second IQ recorder;
- project schema validates all Signal Analysis settings.

Physical:

- compare Level/Fox Hunt response while changing known signal level or antenna orientation;
- run Detector against a known intermittent carrier and verify one event per activity burst;
- run Search with multiple known signals in the instantaneous passband;
- run Looking Glass over a known active band and compare its stitched result to ordinary tuning;
- arm Signal Hunter at one frequency and in range-hop mode; confirm threshold crossing starts a local IQ capture, hopping pauses during capture and resumes after;
- open Time Sink on a known signal, inspect I/Q shape, change point count, then leave the tool and verify snapshot production is disabled;
- record that Looking Glass can miss short signals between retunes and that Signal Hunter v0.8.4 has no pre-trigger IQ.

## Regression tests

Retain coverage for WFM/NFM/AM fixtures, bounded AudioWorklet, Fast Fourier Transform, receive-only gating, hardware evidence metadata, receiver lifecycle, stale-session rejection, latest-request-wins commands, WebUSB device policy, Mayhem framebuffer/registry/navigation, stream planning, SharedArrayBuffer pool, governor, capture/replay, project migration, offline/service-worker behavior and no outbound runtime traffic.

## Reference hardware matrix

Record browser, operating system, receiver product, tuner, antenna/input, rate, frequency, duration, direct-sampling state and observed drops for physical validation. Do not generalize one reference configuration to all RTL-SDR hardware.


## Digital Decoder Suite tests

Automated deterministic checks must verify:

- Bell 202/103 and V.21/V.23 AFSK preset definitions match the audited Mayhem host definitions;
- CRC-16/X-25 (AX.25) and CRC-16/XMODEM (ACARS) match independent standard check values;
- AFSK text survives 32,768-sample processing chunks at 1.024 Msps;
- APRS deterministic IQ recovers a CRC-valid AX.25 frame, source/destination/info and basic uncompressed coordinates;
- ACARS deterministic IQ recovers a CRC-valid/parity-clean structured block through the IF-offset path;
- RTTY deterministic IQ recovers 45.45-baud 170-Hz-shift ITA2 text;
- Morse deterministic IQ survives worker-style per-block DC removal and recovers configured-speed text using its protected IF offset;
- all five applications are generated as ready receive-only registry entries and have explicit local Simulation Mode scenarios;
- speaker audio is optional and digital decode remains attached directly to worker IQ.

Physical/on-air review should then use known signals for each protocol and compare decoded output against an independent receiver/decoder where practical.

## POCSAG tests

Automated:

- standard sync and idle codewords decode cleanly;
- BCH corrects representative one- and two-data-bit errors;
- deterministic IQ pages decode at 512, 1200 and 2400 bit/s;
- inverted discriminator polarity is detected;
- decoder state survives 1.024 Msps worker-sized block boundaries;
- explicit POCSAG Simulation Mode yields a valid local page;
- registry marks POCSAG ready, receive-only and not dependent on speaker audio;
- project schema validates POCSAG frequency, step, bit-rate, monitor and RIC-filter settings.

Physical:

- tune a known local POCSAG paging channel with a suitable antenna;
- verify sync/batch counters advance before calling decode successful;
- verify at least one valid RIC/function and message or address-only page on-air;
- compare Auto against a known fixed bit rate where possible;
- exercise normal/inverted polarity handling if a receiver path reverses the discriminator;
- optionally enable FSK monitor audio and confirm it does not affect decoder continuity;
- export JSON/CSV and verify no decoded paging content leaves the browser automatically.

## v0.8.8 Paging tests

Automated:
- FLEX BCH encode/correct and sync recognition;
- FLEX 1600 2FSK continuous IQ across 32,768-sample blocks;
- expected capcode/alphanumeric Phase-A page recovery;
- Two-Tone Motorola/EIA tone-bank detection across worker blocks;
- A/B sequence and duration recovery;
- receive-only registry exposure and version/schema migration.

Physical:
- tune a known active FLEX 1600 2FSK channel and confirm valid sync/page evidence without assuming privacy-sensitive content is public;
- receive a known Two-Tone dispatch/test sequence and compare detected A/B frequencies and durations to an independent reference;
- verify stop/restart, retune, capture, hot-unplug/reconnect, and local export while each paging app is active.

## v0.8.9 Tracking & Beacons tests

Automated gates:

- validate CRC-16/X-25 and CRC-16/CCITT-FALSE against independent check values;
- feed AIS fixtures through unsigned-8-bit quantization, per-worker-block DC removal and 32,768-sample chunking; require the expected Class-A MMSI/position and no CRC errors;
- feed an RS41-SG fixture through the same chunked worker boundary and require identity, frame, battery, ECEF-derived position and all promoted block CRCs;
- feed a full 160 ms-carrier 406 MHz long-frame fixture through the worker-equivalent path and require both BCH fields plus the known Standard Location PLB fields;
- corrupt a protected beacon bit and require rejection;
- assert all three applications are receive-only and that the 406 MHz application cannot transmit.

Focused physical validation after release:

- compare AIS A/B output against an independent receiver/decoder on known traffic;
- compare RS41 output against an independent radiosonde decoder on a known launch or recorded RF capture;
- validate 406 MHz only with lawful test equipment, shielded/test sources, or recordings; never intentionally activate an emergency beacon merely for software testing;
- verify retune, stop/restart, capture/replay, hot-unplug/reconnect and local export while each new application is active.



## v0.8.11 UI/UX cleanup tests

- The primary rail exposes the Start, Listen, Decode, Analyze, Review and Support task groups and labels the former Applications route as Receiver Library.
- The collapsed desktop rail hides text labels and preserves icon navigation without relying on overflow clipping.
- Easy Mode hides system-oriented status fields and advanced support routes while leaving the primary receive workflow available.
- Home contains one source summary and task-first routing without duplicated Connect/Simulation source cards.
- The general Receiver exposes one stateful Start Receiver / Stop Receiver button and hides the manual gain control while automatic gain is selected.
- Receiver Library exposes search and task filters and keeps transmit-required applications out of ordinary receive-focused filters.
- Advanced inspector routing covers POCSAG, Paging, Digital, Sub-GHz Telemetry, Tracking, SSTV and ADS-B rather than falling back to a generic Start panel.
- Project schema remains 12; cleanup must not create a migration solely for presentation state.

## v0.8.10 SSTV tests

1. Verify all six audited mode entries and VIS parity codes.
2. Pin 1500 Hz to black and 2300 Hz to white.
3. Reconstruct a complete 256-line Martin 1 deterministic image and compare known RGB planes.
4. Run Martin 1 USB IQ through unsigned-8-bit quantization, worker-style per-block DC removal and 32,768-sample chunks.
5. Run the equivalent FM IQ path.
6. Verify the processing worker does not reconfigure/reset SSTV once per sample block.
7. Verify the SSTV shell exposes HF USB / ISS FM presets, Auto VIS, phase/slant, progressive canvas, PNG/metadata export and IQ capture.
8. Verify Simulation Mode carries a complete 256-line Martin 1 image.
9. Physical validation: compare a known HF USB Martin 1 source and a known VHF/FM SSTV source against an independent decoder, then capture/replay the same IQ and compare the reconstructed image.
