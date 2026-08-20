# Source attribution

MAYHEM RTL is an independent browser derivative of `wonderingStars/mayhem-b200`, pinned at:

`44736b9ca844732e18f35e86eb5beece1d9c2c57`

That project is itself derived from PortaPack Mayhem / PortaPack firmware. See `NOTICE.md` and the preserved GNU General Public License notices.

## Audited Mayhem / mayhem-b200 concepts

The browser port follows audited upstream architecture and behavior for:

- `radio::RadioDevice` abstraction;
- receive-only capability policy;
- 240 × 320 logical UI geometry;
- Mayhem key ordinals and category navigation behavior;
- application registry concepts;
- spectrum/rendering behavior where applicable;
- analog receive-mode organization, including the audited upstream USB/LSB/CW configuration in `src/apps/analog_audio_app.cpp`;
- Mode S / ADS-B parsing behavior for the supported browser subset.

The current freestanding browser WebAssembly bridge is original browser-port code and does **not** claim that the complete upstream widget/font/icon/application translation units are linked.

## WebUSB RTL-SDR reference

Low-level RTL2832U/R8xx browser access was adapted from and audited against `@jtarrio/webrtlsdr` / `jtarrio/webrtlsdr`, pinned at:

`5699cec220cb0349e8f9144b7b71d3d03b5d9dbf`

Those adapted portions retain Apache License 2.0 notices; see `LICENSE.Apache-2.0` and `THIRD_PARTY_LICENSES.md`.

## Original MAYHEM RTL browser components

Original browser-port work includes, among other modules:

- Green Shoe application shell;
- project state/migration;
- capture/replay storage adapters;
- diagnostics and no-network audits;
- processing worker integration;
- browser WFM/NFM/AM demodulation and AudioWorklet output adapter;
- v0.8.2 worker-side USB/LSB complex sideband filtering, Receiver Incremental Tuning, CW beat generation and audio Automatic Gain Control;
- v0.8.2 Amateur Radio band/input-path workflow;
- single-source registry generation pipeline;
- rate-aware stream planner, adaptive visualization governor and SharedArrayBuffer raw-sample pool;
- modular C++/WebAssembly navigation and native file-scope registration bridge;
- Broadcast Radio workflow and Frequency Scanner;
- browser Mode S / ADS-B IQ detector, supported extended-squitter parser, tracker, structured panel and local graticule;
- browser deployment/PWA/version-recovery handling.

These components are distributed under the project's GNU General Public License version 2.0 or later terms unless a file states another compatible license.
