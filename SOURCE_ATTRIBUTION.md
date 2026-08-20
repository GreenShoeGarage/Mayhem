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
- Mode S / ADS-B parsing behavior for the supported browser subset;
- POCSAG receive/decode behavior from `src/apps/pocsag_app.*` and the pinned upstream POCSAG tests, including 512/1200/2400 bit/s timing, sync/idle words, BCH correction, RIC/function layout and alpha/numeric assembly;
- AFSK/APRS/ACARS/RTTY/Morse receive behavior from the pinned `src/apps/ui_*_rx.*` / `ui_morse_radio.*` sources and their available tests, including audited modem tone tables, AX.25 FCS/framing, ACARS parity/CRC/field layout, RTTY tone/ITA2 behavior and Morse receive semantics.

The current freestanding browser WebAssembly bridge is original browser-port code and does **not** claim that the complete upstream widget/font/icon/application translation units are linked.


## Supplemental PortaPack Mayhem receiver behavior references

For the v0.8.4 Signal Analysis Suite, MAYHEM RTL also behavior-audited the public PortaPack Mayhem firmware at supplemental reference commit:

`6dadefe86fd7b012c69b153b7f40115531bd66e5`

Specifically reviewed were:

- `firmware/application/apps/ui_looking_glass_app.*` for serial spectrum sweeping, wide-range bin mapping/max-hold and marker-oriented inspection;
- `firmware/application/external/signal_hunter/ui_signal_hunter.*` and its baseband processor for single/frequency-hop target operation, energy threshold/hang behavior and recording workflow.

These references are used for behavioral alignment. The v0.8.4 browser analysis engine, reduced-data adapters, range-hop controller, capture integration and canvases are independent MAYHEM RTL code and do not claim byte-for-byte source convergence.

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
- browser POCSAG continuous-IQ decoder, pager workspace, RIC filtering/export and deterministic simulation fixture;
- v0.8.4 shared Signal Analysis primitives, seven analysis workspaces, serialized Looking Glass sweep, range-hop Signal Hunter capture integration and bounded Time Sink worker snapshots;
- v0.8.5 continuous worker-side AFSK/APRS/ACARS/RTTY/Morse decoder adapters, browser-specific ACARS/Morse IF protection, structured/text views, local exports and deterministic IQ fixture generators;
- browser deployment/PWA/version-recovery handling.

These components are distributed under the project's GNU General Public License version 2.0 or later terms unless a file states another compatible license.

The v0.8.8 Paging work behavior-audits the pinned `mayhem-b200` FLEX and Two-Tone receiver sources/tests. MAYHEM RTL implements browser-worker continuous-IQ adapters, local presentation/export, and deterministic fixture generation under the project GPL-2.0-or-later lineage; it does not claim byte-for-byte linkage of the complete native paging application bodies.


## v0.8.9 behavior-audited receiver lineage

The v0.8.9 AIS, Vaisala RS41-SG radiosonde, and 406 MHz distress-beacon receive behavior was audited against the pinned `wonderingStars/mayhem-b200` sources/tests, which preserve their PortaPack Mayhem lineage and GPL-2.0-or-later notices. MAYHEM RTL implements browser-worker adapters and deterministic fixtures; it does not claim the complete native application bodies are byte-for-byte linked.


## v0.8.10 SSTV behavior-audited lineage

The SSTV mode table, VIS conventions, tone/pixel mapping, line timing, phase/slant behavior and reference tests were behavior-audited against pinned `wonderingStars/mayhem-b200` commit `44736b9ca844732e18f35e86eb5beece1d9c2c57`, especially `src/apps/ui_sstvrx.{hpp,cpp}` and `tests/test_sstvrx.cpp`, which retain their PortaPack Mayhem lineage and GPL-2.0-or-later notices. MAYHEM RTL supplies its own continuous browser-worker adapter, USB/FM input selection, progressive canvas and local export/capture integration.


## v0.8.11 UI/UX cleanup

Version 0.8.11 adds no new protocol or DSP lineage. The grouped navigation, task-first Home workflow, searchable Receiver Library, Easy/Advanced visibility policy, consolidated Receiver controls and inspector routing are MAYHEM RTL browser-shell adaptations over the existing application registry and controllers.
