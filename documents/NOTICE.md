# MAYHEM RTL notices

MAYHEM RTL is an independent browser-port project. It is not an official release of PortaPack Mayhem, HackRF, Ettus Research, RTL-SDR Blog, or `mayhem-b200`.

The architecture and behavior of this development build are based on `wonderingStars/mayhem-b200` at commit `44736b9ca844732e18f35e86eb5beece1d9c2c57`. That project is a derivative of PortaPack Mayhem and identifies upstream copyright holders including Jared Boone / ShareBrained Technology, Furrtek, Kyle Reed, zxkmm, and the PortaPack Mayhem contributors.

The low-level browser RTL2832U transport is adapted from `jtarrio/webrtlsdr` version 3.0.6 at commit `5699cec220cb0349e8f9144b7b71d3d03b5d9dbf`, Copyright 2024 Jacobo Tarrío Barreiro and, for portions derived from the earlier Google Radio Receiver work, Copyright 2013 Google Inc. Those portions are licensed under Apache License 2.0; the required notice and license are retained.

MAYHEM RTL as a combined project is distributed under GNU General Public License version 2.0 or later. See `LICENSE` and `THIRD_PARTY_LICENSES.md`.

No native `mayhem-b200` telemetry subsystem is compiled, copied, or called by the browser target. The production distribution performs no application-generated outbound request after its static assets have loaded.
