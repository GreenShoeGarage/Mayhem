# Changelog

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
