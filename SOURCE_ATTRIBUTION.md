# Source attribution

MAYHEM RTL is an independent browser derivative of `wonderingStars/mayhem-b200`, pinned at:

`44736b9ca844732e18f35e86eb5beece1d9c2c57`

That project is itself derived from PortaPack Mayhem / PortaPack firmware. See
`NOTICE.md` and the preserved GNU General Public License notices.

## Audited Mayhem / mayhem-b200 concepts and source

The browser port follows the audited upstream architecture for:

- `radio::RadioDevice` abstraction;
- receive-only capability policy;
- 240 × 320 logical UI geometry;
- RGB565 `ui::Color` packing;
- 8 × 16 logical character metrics;
- Mayhem `KeyEvent` ordinals;
- Painter/display abstraction;
- category-first Home navigation;
- file-scope `app::Registrar` application-registration ownership;
- spectrum/rendering behavior where applicable;
- receiver-model and DSP behavior as ports are completed.

Version 0.7.0 splits the former monolithic WebAssembly bridge into browser-port
modules under `src/mayhem/` corresponding to those audited responsibilities.
These files preserve the source lineage and are distributed under GNU General
Public License version 2.0 or later.

The freestanding browser runtime still does **not** claim byte-for-byte inclusion
of the complete upstream fixed-font data, bitmap/theme resources, STL-based
widget/focus implementation, or all native application bodies. See
`UPSTREAM_RUNTIME_AUDIT.md` for the exact boundary.

## WebUSB RTL-SDR reference

Low-level RTL2832U/R8xx browser access was adapted from and audited against
`@jtarrio/webrtlsdr` / `jtarrio/webrtlsdr`, pinned at:

`5699cec220cb0349e8f9144b7b71d3d03b5d9dbf`

Those adapted portions retain Apache License 2.0 notices; see
`LICENSE.Apache-2.0` and `THIRD_PARTY_LICENSES.md`.

## Original MAYHEM RTL browser components

Original browser-port work includes, among other modules:

- Green Shoe application shell;
- project state and migration;
- capture/replay browser storage adapters;
- diagnostics and no-network audits;
- processing worker integration;
- browser WFM/NFM/AM demodulation kernels and AudioWorklet output adapter;
- cross-language registry generator;
- freestanding fixed-storage browser form of `AppRegistry` and navigation stack;
- browser framebuffer `Display` adapter;
- v0.5 Easy Mode receiver control deck;
- v0.6 rate-aware stream planner;
- v0.6 adaptive visualization governor;
- v0.6 fixed-slot SharedArrayBuffer raw-sample pool;
- browser deployment/PWA/update handling.

These components are distributed under the project's GNU General Public License
version 2.0 or later terms unless a file states another compatible license.
