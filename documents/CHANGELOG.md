# Changelog

## 0.2.0 — 2026-08-20

- Promoted the build after the first successful physical RTL-SDR bring-up: an `RTL2838UHIDIR` receiver with an R820T/R820T2/R860-family tuner produced live spectrum and waterfall data at 1.024 million samples per second with zero visible dropped samples during the observed session.
- Added a prominent **RTL-SDR connected — receiver stopped** state with a direct **Start Receiver** action so connection is no longer easy to mistake for active sample streaming.
- Added a live stream-status banner showing effective sample rate, elapsed time, and reported dropped samples.
- Added first-class hardware-verification evidence to Diagnostics and diagnostic exports, while keeping sustained soak testing and the multi-device matrix explicitly pending.
- Updated compatibility messaging to distinguish initial physical bring-up from full hardware qualification.
- Bumped Progressive Web Application cache, visible version, package version, and About text to v0.2.0.

### Verification status

Initial physical WebUSB bring-up is confirmed on one receiver. The 30-minute 1.024 million-samples-per-second soak, retune/gain/sample-rate changes while receiving, stop/restart, hot-unplug/reconnect, R828D/RTL-SDR Blog V4 validation, R860-specific validation, and wider browser/operating-system matrix remain pending.

## 0.1.0 — 2026-08-20

- Pinned `mayhem-b200` at `44736b9ca844732e18f35e86eb5beece1d9c2c57`.
- Added the Green Shoe browser shell, startup preflight, explicit Simulation Mode, project autosave, import/export, diagnostics, compatibility manifest, spectrum, waterfall, local capture, and replay foundations.
- Added a direct, receive-only WebUSB RTL2832U transport derived from the low-level design of `@jtarrio/webrtlsdr` 3.0.6.
- Added a bounded processing worker, local WebAssembly sample-conversion core, connection state machine, stale-callback rejection, command serialization, and stream counters.
- Added Progressive Web Application assets, service worker, restrictive security headers, deployment examples, tests, and release packaging.
- Removed all telemetry and remote runtime dependencies from the browser target.
- Fixed worker startup by converting module `URL` objects to cloneable strings at the worker message boundary.
- Fixed local-replay pacing so transfer of an `ArrayBuffer` to the processing worker cannot collapse the next-block delay to zero.
- Added a replay-pacing regression test that deliberately detaches the transferred sample buffer.
- Improved compact and mobile layouts, including responsive metric cards and a mobile navigation drawer that starts closed and closes after navigation.
- Removed an unsupported Permissions Policy token that caused a Chromium security warning.

### Verification status

Automated tests, explicit simulation, streaming local capture, stored-capture replay, offline reload, wide/compact/tablet/mobile rendering, and the same-origin network boundary were verified in Chromium. Physical RTL-SDR hardware behavior remains unverified by this build environment.
