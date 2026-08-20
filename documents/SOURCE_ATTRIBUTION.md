# Source attribution

## Primary architecture source

- Project: `wonderingStars/mayhem-b200`
- Pinned commit: `44736b9ca844732e18f35e86eb5beece1d9c2c57`
- License lineage: GNU General Public License, version 2.0 or later for the host-port source files; the upstream repository also preserves PortaPack Mayhem notices.

MAYHEM RTL preserves the following design decisions from the pinned source:

- the `radio::RadioDevice` abstraction;
- actual-value-returning radio setters;
- capability-driven application gating;
- the 240 × 320 logical display target;
- self-registering applications as the intended single source of truth;
- receive model, diagnostics, and stream-statistics concepts.

This first development build does not yet include or claim a complete compilation of the upstream Mayhem application suite. The browser shell and transport are a port foundation for that work.

## Browser RTL-SDR transport source

- Project: `jtarrio/webrtlsdr`
- Version: 3.0.6
- Pinned commit: `5699cec220cb0349e8f9144b7b71d3d03b5d9dbf`
- License: Apache License 2.0

The local low-level transport adapts RTL2832U control-transfer, R8xx tuner, tuning, gain, sample-rate, direct-sampling, bias-tee, buffer-reset, and bulk-read behavior. It does not use the separate high-level demodulation pipeline.

## Local modifications

- JavaScript modules replace TypeScript-only type annotations.
- Device descriptor validation, connection-session identifiers, bounded transfer scheduling, command serialization, diagnostics, and truthful browser-state reporting are added.
- Tuner identity is reported conservatively as a family when the hardware protocol cannot distinguish a precise part.
- No telemetry, analytics, remote maps, remote fonts, remote scripts, or silent network requests are present.
