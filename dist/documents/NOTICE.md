# MAYHEM RTL notices

MAYHEM RTL is an independent browser-port project. It is not an official release
of PortaPack Mayhem, HackRF, Ettus Research, RTL-SDR Blog or `mayhem-b200`.

The architecture and behavior of this development build are based on
`wonderingStars/mayhem-b200` at commit
`44736b9ca844732e18f35e86eb5beece1d9c2c57`. That project is a derivative of
PortaPack Mayhem and identifies upstream copyright holders including Jared Boone
/ ShareBrained Technology, Furrtek, Kyle Reed, zxkmm and the PortaPack Mayhem
contributors.

Version 0.7.0 materially advances source convergence. The 240 × 320 core is no
longer implemented as one browser-port bridge file. UI geometry/color/key
primitives, framebuffer display, Painter, navigation and application registry
responsibilities are split into C++ modules under `src/mayhem/` following the
audited `mayhem-b200` responsibilities. The build now generates one C++
translation unit per application containing a file-scope `app::Registrar`, so
C++ application identity is populated through static registration semantics
rather than an included registry array.

The current freestanding browser Painter still uses a compact browser-port glyph
fallback inside the upstream 8 × 16 character cell. The exact upstream
`fixed_8x16` glyph bytes, full bitmap/icon/theme assets and complete STL-based
widget/focus implementation are not yet compiled byte-for-byte into this target.
Those boundaries are documented in `UPSTREAM_RUNTIME_AUDIT.md` and
`PORTING_MATRIX.md` rather than represented as complete.

The WFM/NFM/AM demodulation and AudioWorklet integration, the Easy Mode receiver
workflow, performance governor and bounded shared raw-sample handoff are
browser-port implementations distributed under this project's GNU General Public
License version 2.0-or-later terms. The recorded reference `RTL2838UHIDIR`
configuration has now been user-validated through the v0.6 on-air audio and
2.4 Msps performance gates; that evidence does not establish universal hardware
compatibility.

The low-level browser RTL2832U transport is adapted from `jtarrio/webrtlsdr`
version 3.0.6 at commit `5699cec220cb0349e8f9144b7b71d3d03b5d9dbf`,
Copyright 2024 Jacobo Tarrío Barreiro and, for portions derived from earlier
Google Radio Receiver work, Copyright 2013 Google Inc. Those portions are
licensed under Apache License 2.0; required notices and license text are retained.

MAYHEM RTL as a combined project is distributed under GNU General Public License
version 2.0 or later. See `LICENSE` and `THIRD_PARTY_LICENSES.md`.

No native `mayhem-b200` telemetry subsystem is compiled, copied or called by the
browser target. The production distribution performs no application-generated
outbound request after its static assets have loaded.
