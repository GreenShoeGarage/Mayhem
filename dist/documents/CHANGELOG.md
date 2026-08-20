# Changelog

## 0.8.11 — 2026-08-20

- Reorganized the left navigation into Start, Listen, Decode, Analyze, Review and Support task groups; collapsed desktop navigation now becomes a true icon-only rail.
- Simplified Easy Mode by hiding implementation-oriented tuner/rate/gain/queue/stream status plus Compatibility, Diagnostics and Settings from the primary path while preserving them in Advanced Mode.
- Rebuilt Home around operator tasks and one source summary instead of duplicated connection/simulation cards.
- Consolidated Receiver Start/Stop into one stateful control and hides manual gain while automatic gain is active.
- Replaced the flat Applications catalog with a searchable, task-filtered Receiver Library and separated unavailable transmit-only entries from normal receive workflows.
- Extended the Advanced inspector to the modern decoder workspaces and removed the Receiver-only reset action where it had no effect.
- Streamlined Signal Analysis navigation with a single horizontally scrollable tab row and added responsive cleanup for task/library layouts.
- Added six UI/UX regression tests; complete browser/module suite is now 108 tests.
- Kept project schema at 12, generated native application count at 42, and advanced all active version/cache/package surfaces to v0.8.11.
- No DSP/decoder feature or physical-validation claim changed in this release.

## 0.8.10 — 2026-08-20

- Added receive-only **SSTV RX** with continuous worker-IQ processing and a progressive 320 × 256 browser image canvas.
- Added explicit HF USB and VHF/FM SSTV input paths, including 14.230 MHz USB and 145.800 MHz FM presets plus Auto/manual input selection.
- Added the audited Scottie 1/2/DX, Martin 1/2 and SC2-180 mode table, automatic VIS detection, 1500–2300 Hz luminance mapping, line sync, fractional pixel timing, horizontal phase and slant correction.
- Promoted Martin 1 as the deterministic reference mode and added a complete 256-line image fixture plus USB-IQ/FM-IQ chunk-continuity coverage.
- Added local PNG and JSON metadata export and extended IQ capture/replay metadata with SSTV application/input/mode/VIS/phase/slant state.
- Fixed a worker integration defect that would otherwise reconfigure/reset SSTV once per IQ block; decoder state now persists across minute-scale transmissions.
- Added nine SSTV browser/module tests; complete browser/module suite is now 102 tests.
- Generated native application registry now contains 42 applications.
- Advanced project schema to 12 and all active version/cache/package surfaces to v0.8.10.
- Live/on-air SSTV remains explicitly pending physical validation.

## 0.8.9 — 2026-08-20

- Added receive-only **AIS RX** with simultaneous channel A/B 9600-bit/s NRZI/HDLC, CRC-16/X-25, and fixture-backed Class-A position reports.
- Added receive-only **Radiosonde RX**, promoting the Vaisala RS41-SG 4800-bit/s 2FSK path with XOR descrambling, per-block CRC-16/CCITT-FALSE, identity/battery and ECEF position conversion.
- Added passive **406 MHz Beacon RX** with long-frame biphase-L demodulation, BCH-1/BCH-2 validation, and a fixture-backed Standard Location PLB subset. No transmit path exists.
- Added a Tracking & Beacons workspace, deterministic Simulation Mode fixtures, local JSON/CSV export, and continuous worker-IQ processing for all three applications.
- Added a protected intermediate-frequency offset for 406 MHz carrier acquisition so blockwise DC removal cannot erase the beacon's long unmodulated carrier.
- Added six tracking/beacon regression tests; the complete browser/module suite is 93 tests.
- Generated native application registry now contains 41 applications.
- Advanced project schema to 11 and all active version/cache/package surfaces to v0.8.9.
- Retains the v0.8.6 reference baseline as user-validated while keeping v0.8.8/v0.8.9 additions explicitly fixture-tested/on-air-pending.

## 0.8.8 — 2026-08-20

- Added receive-only **FLEX RX** with continuous-IQ FLEX 1600 2FSK sync/FIW/BCH/Phase-A alphanumeric fixture coverage.
- Added receive-only **2-Tone RX** with the audited Motorola/EIA tone table, 40 ms tone-energy windows, sequential A/B detection, and duration reporting.
- Added a shared Paging workspace with tuning, deterministic simulation fixtures, local result history, JSON export, and CSV export.
- Added processing-worker/client paging events and state-preserving decoding across normal worker block boundaries.
- Added native/browser registry entries for FLEX and Two-Tone; generated native application count is 38.
- Added four paging regression tests; the complete browser/module suite is 87 tests.
- Advanced project schema to 10 and all active version/cache/package surfaces to v0.8.8.
- Records the v0.8.6 baseline as user-validated while keeping the new v0.8.8 paging paths explicitly fixture-tested/on-air-pending.

## 0.8.6 — 2026-08-20

- Added shared Sub-GHz Telemetry worker path with adaptive OOK magnitude slicing, hysteresis, pulse/gap duration recovery, and state continuity across sample blocks.
- Added TPMS RX workspace with 315/433.92 MHz presets, initial Schrader-style OOK/Manchester fixture-backed decoding, recent sensor aggregation, and JSON/CSV export.
- Added Weather Sensors workspace with initial Nexus TH fixture-backed decoding for ID, temperature, humidity, channel, and battery state.
- Added deterministic pulse and quantized-IQ fixtures, including worker-sized chunk-boundary coverage.
- Added TPMS and Weather to the native application registry as receive-only simulation-tested applications.
- Advanced project schema to 9.
- Advanced package, lockfile, JavaScript, CMake, HTML, version.json, and service-worker cache version to v0.8.6.
- Explicitly does not claim the full upstream weather protocol catalog or 19.2 kbit/s FSK TPMS path yet; those remain planned consumers of the shared telemetry architecture.

## 0.8.5 — 2026-08-20

- Added the five-application Digital Decoder Suite: AFSK Terminal, APRS, ACARS, RTTY and Morse.
- Added shared worker-side tone-pair, asynchronous serial, HDLC/NRZI, CRC, ITA2 and Morse timing primitives without creating a second raw-IQ transport.
- Added Bell 202/103 and V.21/V.23 AFSK profiles with 7E1 terminal framing and optional mark/space reversal.
- Added APRS Bell 202 → NRZI → HDLC de-stuffing → AX.25 FCS/address/path/text decoding plus basic uncompressed position extraction.
- Added ACARS 2400 bit/s AM/MSK recovery, odd parity, block framing, CRC-16/XMODEM and structured registration/label/block/message/flight/text output.
- Added an ACARS IF-offset receive path so the desired AM carrier survives RTL2832U DC correction before local digital translation.
- Added RTTY 45.45 baud / 170 Hz shift USB/LSB reception with US/EU tone presets, polarity reversal and ITA2/Baudot letters/figures handling.
- Added configured-speed Morse/CW envelope decoding with adjustable WPM, beat pitch and threshold; a fixed 2 kHz decoder IF offset protects the CW carrier from per-block DC removal.
- Added deterministic I/Q generators and explicit Simulation Mode scenarios for all five decoders, plus local JSON/CSV export and optional speaker monitoring.
- Advanced project schema to version 8 and generated native/browser registry count to 34.
- Added nine Digital Decoder browser/module tests; complete browser/module suite is now 78 tests.
- Advanced package, lockfile, JavaScript, CMake, HTML, `version.json`, and service-worker cache version to v0.8.5 while preserving the runtime mixed-version guard.
- Kept all five new decoder applications at fixture-tested/on-air-pending status until physical evidence is recorded.

## 0.8.4 — 2026-08-20

- Added the seven-workflow Signal Analysis Suite: Level, Detector, Fox Hunt, Search, Looking Glass, Signal Hunter and Time Sink.
- Added shared noise-floor estimation, FFT peak separation, bounded level history, activity hysteresis/timing, relative-strength mapping, wideband sweep accumulation and deterministic range-hop sequencing.
- Added serialized Looking Glass multi-tune sweeping with fresh-slice stitching and max-hold overview.
- Added Signal Hunter current-frequency/range-hop modes with threshold/cooldown behavior and automatic local post-trigger IQ capture using the existing capture store; hopping pauses during capture and resumes afterward.
- Added a bounded, rate-limited worker I/Q snapshot path for Time Sink without creating a second continuous raw-sample pipeline.
- Added receive-only native/browser registry entries for all seven applications; generated registry count is now 29.
- Advanced project schema to version 7 for Signal Analysis settings.
- Added deterministic Signal Analysis tests and retained the complete radio/audio/POCSAG/ADS-B/Scanner/version/no-network regression suite.
- Audited Looking Glass and Signal Hunter behavior against PortaPack Mayhem supplemental reference commit `6dadefe86fd7b012c69b153b7f40115531bd66e5`.
- Advanced all active package/CMake/HTML/JavaScript/version-metadata/service-worker version sources to v0.8.4.
- Kept physical validation of the seven new workflows explicit as pending; no calibrated RF-power, direction-of-arrival, simultaneous-wideband, or pre-trigger-IQ claims are made.

## 0.8.3 — 2026-08-20

- Added a first-class POCSAG Pager Receiver workspace and receive-only registry entry.
- Added continuous worker-side POCSAG 2FSK decoding at automatic or fixed 512/1200/2400 bit/s.
- Added sync/idle recognition, inverted-polarity support, BCH(31,21) correction, RIC/function extraction, alpha/numeric page decoding, bounded recent-message storage, RIC filters, JSON/CSV export, and decoder diagnostics.
- Added an optional FSK audio monitor; decoding remains independent of browser audio output.
- Added a deterministic POCSAG IQ generator and explicit Simulation Mode scenario.
- Added automated POCSAG tests for standard codewords, one/two-bit BCH correction, all three bit rates, inverted polarity, 1.024 Msps chunk continuity, Simulation Mode, and registry gating.
- Advanced project schema to version 6 for POCSAG settings.
- Preserved the v0.8.2 runtime/header/service-worker version-consistency guard and advanced every active version source to v0.8.3.
- Kept on-air POCSAG reception explicitly pending physical verification.

## 0.8.2 — 2026-08-20

- Added a dedicated **Amateur Radio** receive workspace with common 160 m through 70 cm tuning presets.
- Added Upper Sideband (USB), Lower Sideband (LSB), and Continuous Wave (CW) worker-side demodulation.
- Added complex sideband-select filtering with deterministic opposite-sideband rejection fixtures.
- Added 10/50/100/500 Hz fine tuning, selectable SSB voice filters, Receiver Incremental Tuning (RIT), adjustable SSB low cut, and Off/Fast/Medium/Slow audio Automatic Gain Control (AGC).
- Added CW narrow filters and adjustable 400–1000 Hz beat pitch with a 700 Hz default.
- Added an HF input manager that selects RTL2832U Q-branch direct sampling below the connected tuner floor when supported and restores the normal tuner path above that floor.
- Added USB/LSB/CW/Amateur Radio entries to the single generated browser/C++ application registry; the native C++ registry now contains 21 entries.
- Advanced project schema to version 5 and persisted SSB/CW/RIT/AGC/direct-sampling state in projects, stations, captures and replay metadata.
- Fixed live Amateur Radio band changes so a required direct-sampling hardware transition is applied before project state can mask the change.
- Fixed the Saved Stations table header so the new modulation column has a matching **Mode** heading.
- Strengthened active-version ownership: version-addressed entry JavaScript/CSS/manifest assets, an HTML runtime-version marker, a versioned service-worker URL, `updateViaCache: "none"`, and a startup HTML-versus-JavaScript version guard.
- Fixed stale-cache recovery to preserve the executing/current `APP_VERSION` cache instead of the stale HTML version cache.
- Corrected documentation that still identified v0.8.0/v0.8.1 as the active release.
- Conservatively keeps the repaired v0.8.1+ browser audio-output path pending focused physical re-validation; USB/LSB/CW remain fixture-tested until on-air evidence is recorded.
- Expanded the automated JavaScript/browser-module suite to 54 passing tests, plus the existing C/C++ contracts and no-network audit.

## 0.8.1 — 2026-08-20

- Fixed the physical no-audio/continuous-underrun failure reported in v0.8.0 by adding a bounded 120 ms AudioWorklet prebuffer.
- Changed underrun reporting to one rebuffer event per starvation episode instead of counting every silent render quantum.
- Explicitly configured the AudioWorkletNode as a zero-input source with one stereo output.
- Removed duplicate metadata cloning of the same transferred Float32 audio buffer.
- Added audio queue depth, buffering state, rebuffer count, pushed frame/sample count, worklet drops and push errors to runtime diagnostics.
- Added worker audio-frame/sample production counters.
- Broadcast Radio now forces its FM/AM preset when opened/connected and opens squelch by default.
- Added a full-Receiver warning when the operator tunes the 87.5–108 MHz FM broadcast band with NFM or AM selected.
- Expanded the full receiver squelch control to -140 dBFS.
- Conservatively moved WFM/NFM/AM physical audio verification back to pending until v0.8.1 is rechecked on the reference hardware.
- Bumped active runtime, CMake, version metadata and service-worker cache to v0.8.1.
- Expanded automated browser/module coverage to 46 passing tests.

## 0.8.0 — 2026-08-20

- Added a dedicated **Broadcast Radio** workflow for broadcast Frequency Modulation (FM) and medium-wave Amplitude Modulation (AM).
- Added FM band presets (87.5–108 MHz), WFM mode, 100/200 kHz stepping, audio enable/mute/volume and station save from one focused listener screen.
- Added AM band presets (530–1710 kHz), 10/9 kHz stepping, AM demodulation and tuner-capability-aware direct sampling for ordinary R8xx receivers below their normal tuner floor.
- Added normal low-frequency tuner/input handling for receiver profiles that advertise a zero-Hertz minimum, including the RTL-SDR Blog V4-class compatibility path.
- Updated WebUSB connection initialization so requested direct-sampling mode is applied before the first low-frequency tune.
- Added a serialized Frequency Scanner with configurable start/end/step/dwell/threshold/hold, bounded result history, frequency lockouts, lockout clearing and CSV export.
- Added a local Mode S / Automatic Dependent Surveillance–Broadcast (ADS-B) decoder with CRC-24 validation, DF17/DF18 extended-squitter parsing, callsign, altitude, velocity, global airborne Compact Position Reporting (CPR), aircraft tracking and local JSON export.
- Added a 1090 MHz / 2.4 Msps ADS-B receiver workflow and local coordinate graticule with no external map tiles.
- Added a valid IQ-level ADS-B Simulation Mode fixture using known CRC-valid frames.
- Added worker-side ADS-B decoding without moving the critical sample-processing loop into animation rendering.
- Added Broadcast Radio, Scanner and ADS-B primary-navigation entries and registered them as receive-only applications.
- Advanced project schema to version 4 for broadcast/scanner state.
- Added version-consistency build guards across package version, JavaScript configuration, CMake, header/About UI, generated version metadata and service-worker cache.
- Fixed route-aware Connect handlers so browser `MouseEvent.view` can never be mistaken for an application route.
- Removed older release labels from active runtime messages; historical test filenames remain historical evidence only.
- Expanded the automated browser/module suite to 44 passing tests, plus existing C/C++ tests and no-network audit.

## 0.7.0 — 2026-08-20

- Established the modular C++/WebAssembly runtime-convergence architecture.
- Added upstream-shaped UI primitives, display/painter seams, native file-scope `app::Registrar` application registration and C++ Home/category/application navigation.
- Mirrored actual tuner/gain/drop/error state into the Mayhem logical display.

## 0.6.0 — 2026-08-20

- Added rate-aware stream planning, bounded processing queues, adaptive visualization load shedding and SharedArrayBuffer raw-sample handoff.
- Retained transferable-buffer fallback.
- Advanced project schema to version 3.

## 0.5.0 — 2026-08-20

- Consolidated the everyday receiver workflow into Easy Mode.

## 0.4.2 — 2026-08-20

- Completed WFM/NFM/AM worker-side audio demodulation and bounded AudioWorklet output.

## 0.3.x — 2026-08-20

- Established C++ WebAssembly-owned 240 × 320 framebuffer/navigation and consistent active-version/service-worker behavior.

## 0.1.0 — 2026-08-20

- Established the browser shell, WebUSB transport, bounded worker pipeline, spectrum/waterfall, simulation, capture/replay, project state, diagnostics, offline PWA, security headers, licensing and release packaging.
