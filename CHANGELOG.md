# Changelog

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
