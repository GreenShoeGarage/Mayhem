# MAYHEM RTL notices

MAYHEM RTL is an independent browser-port project. It is not an official release of PortaPack Mayhem, HackRF, Ettus Research, RTL-SDR Blog or `mayhem-b200`.

The architecture and behavior of this development build are based on `wonderingStars/mayhem-b200` at commit `44736b9ca844732e18f35e86eb5beece1d9c2c57`. That project is a derivative of PortaPack Mayhem and identifies upstream copyright holders including Jared Boone / ShareBrained Technology, Furrtek, Kyle Reed, zxkmm and the PortaPack Mayhem contributors.

The v0.3.x convergence work adapts Mayhem B200 user-interface behavior into the freestanding WebAssembly core, including geometry/color conventions, painter semantics, application-registry identity/category behavior, category-first navigation and Mayhem key-event ordinals. Version 0.4.2 made `src/app_registry.json` the build-time source for both the C++ WebAssembly registry and browser compatibility registry. Version 0.5.0 consolidated the receiver workflow; version 0.6.0 added original browser-side stream planning, load-governor and bounded shared raw-sample handoff components; and version 0.7.0 added modular C++ runtime seams plus generated per-application file-scope `app::Registrar` translation units. Exact upstream fixed-font bytes, widget implementations, bitmap/theme resources, the complete upstream STL navigation/focus tree and most upstream native application bodies are not yet byte-for-byte compiled into this target.

The v0.4.x WFM/NFM/AM demodulation and AudioWorklet integration, the v0.5 receiver workflow consolidation, the v0.6 performance/streaming components, and the v0.8 Broadcast Radio/Scanner browser workflows are new browser-port implementations distributed under this project's GNU General Public License version 2.0-or-later terms. The v0.8 Mode S / ADS-B browser decoder is a browser-side port of the supported behavior audited in the pinned `mayhem-b200` ADS-B implementation and tests, including CRC, selected extended-squitter field decoding and Compact Position Reporting behavior; browser-specific IQ pulse detection, worker integration and structured presentation are new adapters.

The low-level browser RTL2832U transport is adapted from `jtarrio/webrtlsdr` version 3.0.6 at commit `5699cec220cb0349e8f9144b7b71d3d03b5d9dbf`, Copyright 2024 Jacobo Tarrío Barreiro and, for portions derived from earlier Google Radio Receiver work, Copyright 2013 Google Inc. Those portions are licensed under Apache License 2.0; required notices and license text are retained.

MAYHEM RTL as a combined project is distributed under GNU General Public License version 2.0 or later. See `LICENSE` and `THIRD_PARTY_LICENSES.md`.

No native `mayhem-b200` telemetry subsystem is compiled, copied or called by the browser target. The production distribution performs no application-generated outbound request after its static assets have loaded.

POCSAG receive/decode behavior in v0.8.3 was audited against the pinned mayhem-b200 POCSAG application and tests. The browser implementation is receive-only and retains the project GPL-2.0-or-later lineage.

The v0.8.4 Signal Analysis Suite additionally behavior-audits the public PortaPack Mayhem Looking Glass and Signal Hunter receiver sources at supplemental commit `6dadefe86fd7b012c69b153b7f40115531bd66e5`. Those upstream sources are GNU General Public License version 2.0-or-later. MAYHEM RTL's shared browser analysis primitives, serialized sweep/range-hop controllers, local capture integration and Time Sink snapshot adapter are independent browser-port implementations distributed under the same project GPL-2.0-or-later lineage.

The v0.8.5 Digital Decoder Suite behavior was audited against pinned `mayhem-b200` AFSK/APRS/ACARS/RTTY/Morse receiver sources and available tests. MAYHEM RTL implements its continuous worker-side browser adapters, IF-protection choices, local presentation/export, and deterministic fixture generators under the project GPL-2.0-or-later lineage; it does not claim byte-for-byte linkage of the complete native receiver application bodies.

The v0.8.8 Paging work behavior-audits the pinned `mayhem-b200` FLEX and Two-Tone receiver sources/tests. MAYHEM RTL implements browser-worker continuous-IQ adapters, local presentation/export, and deterministic fixture generation under the project GPL-2.0-or-later lineage; it does not claim byte-for-byte linkage of the complete native paging application bodies.


Version 0.8.9 adds receive-only behavior adaptations for AIS, Vaisala RS41-SG radiosonde and 406 MHz COSPAS-SARSAT beacon analysis based on the pinned Mayhem-derived sources/tests. The 406 MHz functionality is passive reception/analysis only and provides no beacon-transmission capability.


Version 0.8.10 adds a receive-only SSTV behavior adaptation based on the pinned Mayhem-derived SSTV source/tests. It adds no radio-transmit path. The browser-specific USB/FM input selection, continuous-worker adapter, progressive canvas, PNG/metadata export and capture/replay integration are MAYHEM RTL adaptations.

Version 0.8.11 is a browser-shell UI/UX cleanup. Its task-grouped navigation, task-first Home page, Receiver Library filtering, Easy/Advanced information-density rules and consolidated Receiver controls are original browser presentation/adaptation work. It adds no new upstream-derived decoder code and no transmit capability.
