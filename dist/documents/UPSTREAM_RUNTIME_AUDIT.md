# Upstream runtime audit — MAYHEM RTL v0.8.11

Pinned upstream: `wonderingStars/mayhem-b200@44736b9ca844732e18f35e86eb5beece1d9c2c57`

Version 0.8.11 retains the v0.8.10 receive/runtime behavior and is intentionally limited to browser-shell UI/UX cleanup. It adds no new upstream decoder lineage and does not change the existing application-to-WebUSB/runtime convergence boundary. Martin 1 remains the promoted deterministic SSTV reference mode; other audited SSTV mode definitions remain pending broader validation.

| Upstream area | Upstream source reviewed | Browser state | Truthful status |
|---|---|---|---|
| UI geometry / RGB565 Color / key ordinals | `src/ui/ui.hpp`, `src/ui/ui.cpp` | Matching geometry/packing/8×16 metrics/key ordinals in `src/mayhem/ui.*` | Adapted + compile-tested |
| Painter seam | `src/ui/ui_painter.*` | `src/mayhem/painter.*` draws through browser framebuffer adapter | Behavior-converged; exact font assets pending |
| Application registry | `src/apps/app_registry.*` | Per-app file-scope `app::Registrar` generated from one definition | Native registration semantics implemented |
| Home/category behavior | `src/apps/main_menu.cpp` | C++ Home → Category → Application push/pop | Behavior-converged |
| Analog audio mode model | `src/apps/analog_audio_app.cpp`, receiver model | Audited upstream configuration exposes AM variants, USB, LSB and CW; browser worker implements WFM/NFM/AM/USB/LSB/CW | Mode/product behavior aligned; browser DSP adapter is independently implemented and fixture-tested |
| Looking Glass reference behavior | PortaPack Mayhem `firmware/application/apps/ui_looking_glass_app.*` at supplemental commit `6dadefe86fd7b012c69b153b7f40115531bd66e5` | Browser serialized retune/dwell/fresh-FFT stitching and max-hold overview | Behavior-audited independent browser implementation |
| Signal Hunter reference behavior | PortaPack Mayhem `firmware/application/external/signal_hunter/ui_signal_hunter.*` at supplemental commit `6dadefe86fd7b012c69b153b7f40115531bd66e5` | Current/range-hop threshold watch + existing local post-trigger IQ capture | Behavior-audited independent browser implementation; pre-trigger pending |
| Level / Detector / Fox Hunt / Search / Time Sink | Mayhem receiver-family semantics + existing MAYHEM RTL reduced data products | Shared browser analysis primitives and bounded worker snapshot adapter | Independent browser implementations; physical review pending |
| POCSAG | `src/apps/pocsag_app.*`, `tests/test_pocsag.cpp` | Continuous worker IQ → FM discriminator → bit timing → sync/batch → BCH → RIC/message panel | Behavior-adapted subset with deterministic 512/1200/2400 fixtures and Simulation Mode; on-air pending |
| AFSK terminal | `src/apps/ui_afsk_rx.*`, `tests/test_afsk_rx.cpp` | Continuous worker IQ → NFM → audited Bell/V tone pairs → 7E1 text | Behavior-adapted browser implementation; deterministic IQ tested; on-air pending |
| APRS | `src/apps/ui_aprs_rx.*` | Bell 202 → NRZI → HDLC → AX.25 FCS/address/path/info/basic position | Behavior-adapted subset; deterministic IQ tested; on-air pending |
| ACARS | `src/apps/ui_acars_rx.*`, `tests/test_acars_rx.cpp` | Protected IF → AM → 1200/2400-Hz MSK → parity/framing/CRC/core fields | Behavior-adapted browser implementation; deterministic IQ tested; on-air pending |
| RTTY | `src/apps/ui_rtty_rx.*`, `tests/test_rtty_rx.cpp` | USB/LSB → 170-Hz tone pair → async 5-bit → ITA2 | Behavior-adapted subset; deterministic IQ tested; on-air pending |
| Morse | `src/apps/ui_morse_radio.*`, `tests/test_morse_radio.cpp` | Protected IF → CW envelope/timing → International Morse text | Browser timing implementation guided by audited behavior; deterministic IQ tested; on-air pending |
| ADS-B / Mode S | `src/apps/ui_adsb_rx.*`, upstream tests | Browser worker implements CRC, selected extended-squitter fields, CPR and tracking | Ported subset with deterministic fixtures; on-air pending |
| Browser radio state | `radio::RadioDevice` contract | Actual frequency/rate/level/tuner/gain/drop/error mirrored into core | Implemented state mirror; complete app-to-WebUSB C++ backend remains future full-Emscripten work |
| Exact fixed 8×16 font bytes | `src/ui/ui_font_fixed_8x16.*` | Fallback glyph renderer with upstream cell geometry | Pending exact asset import |
| Exact bitmap/theme assets | `src/ui/bitmaps.*`, `src/ui/theme.*` | Browser/core replacements | Pending exact asset import |
| Full widget/focus tree | `src/ui/ui_widget.*`, `ui_focus.*`, `ui_menu.*` | Modular seams exist; complete upstream STL tree not compiled in freestanding artifact | Pending full Emscripten convergence |
| Native application bodies | `src/apps/*` | Registry identity is native C++; Broadcast/Amateur/Scanner/ADS-B use browser/worker implementations | Partial application convergence |


## Digital Decoder behavior used in v0.8.8

The pinned AFSK tests enumerate the Bell 202/103 and V.21/V.23 tone/baud definitions and the host terminal's asynchronous 7E1 behavior. MAYHEM RTL ports those receive semantics into one continuous worker-side tone-pair/serial implementation.

The pinned APRS receiver provides the AX.25 FCS/address/path and APRS position semantics used as a reference. The v0.8.8 browser subset implements Bell 202/NRZI/HDLC, valid FCS, source/destination/path/text, and basic uncompressed coordinates; it does not yet claim every compressed/Mic-E/application-layer APRS format.

The pinned ACARS host receiver documents odd character parity, CRC-16/XMODEM, framing/core field positions, and the 2400-bit/s 1200/2400-Hz physical tones. MAYHEM RTL retains those protocol behaviors but uses a browser-specific IF offset before AM detection to avoid the RTL2832U DC notch.

RTTY follows the audited 45.45-baud, 170-Hz tone presets and ITA2/Baudot model. Morse uses the existing browser CW demodulator plus a configured-speed envelope/timing decoder; the 2 kHz protected IF is a browser/RTL-SDR adaptation discovered and regression-pinned during Simulation Source testing.

## Signal Analysis behavior used in v0.8.4

PortaPack Mayhem Looking Glass serially retunes spectrum slices, maps their bins into a wider display, tracks maximum power/frequency and supports marker/threshold-oriented inspection. MAYHEM RTL adapts that operator concept to the RTL-SDR's narrower instantaneous passband by using the existing serialized tune path plus a browser-side stitched max-hold accumulator. It does not claim simultaneous wideband capture.

PortaPack Mayhem Signal Hunter supports a single target or frequency-hopping operation, an energy threshold, hang timing and recording behavior. MAYHEM RTL adapts those concepts into current-frequency or configurable range-hop operation, dBFS threshold/cooldown behavior and reuse of the existing browser raw-IQ capture store. Version 0.8.4 intentionally records post-trigger IQ only.

The remaining Level, Detector, Fox Hunt, Search and Time Sink tools are browser-native compositions of the existing continuous receive statistics, FFT products, serialized tune control and bounded worker snapshots. Their names/workflow intent match the Mayhem receiver family, but they are not represented as byte-for-byte native application ports.

## Analog audio behavior used in v0.8.2

The pinned `analog_audio_app.cpp` exposes an AM-family configuration menu containing `DSB 9k`, `DSB 6k`, `USB`, `LSB`, and `CW`, alongside the upstream receiver model's NFM/WFM modes. MAYHEM RTL uses that audited organization as evidence that USB/LSB/CW belong in the analog receive family.

The browser implementation is not a textual copy of that complete native application. It uses worker-side complex filtering, digital RIT, CW beat generation and browser AudioWorklet output appropriate to the RTL-SDR/WebUSB target. Deterministic fixtures verify the selected browser behavior.

## ADS-B source behavior used in v0.8

The browser decoder follows audited `mayhem-b200` Mode S behavior for its supported subset, including the 24-bit CRC polynomial, identification character mapping, supported altitude extraction, velocity parsing and global airborne CPR pairing. Browser-specific sample/pulse detection and structured presentation are browser adapters.

## Why the freestanding core still differs

The static build uses stock Clang freestanding `wasm32` modules. The exact upstream host widget tree depends on the C++ standard library. The repository retains `MB200_WEB=ON` as the eventual complete Emscripten source-convergence target and keeps that boundary explicit.


## POCSAG source behavior used in v0.8.3

The pinned Mayhem host POCSAG implementation documents 2FSK at nominal ±4.5 kHz, 512/1200/2400 bit/s, the `0x7CD215D8` synchronization word, `0x7A89C197` idle word, BCH(31,21)+parity correction, RIC frame-bit reconstruction, and alpha/numeric payload assembly. Its UI source also documents a host-port limitation: a sliding spectrum snapshot is not a gap-free source for POCSAG. MAYHEM RTL therefore adapts the decoder behavior to the browser processing worker's continuous IQ path rather than copying that snapshot limitation.

The v0.8.8 Paging work behavior-audits the pinned `mayhem-b200` FLEX and Two-Tone receiver sources/tests. MAYHEM RTL implements browser-worker continuous-IQ adapters, local presentation/export, and deterministic fixture generation under the project GPL-2.0-or-later lineage; it does not claim byte-for-byte linkage of the complete native paging application bodies.

## v0.8.9 tracking/beacon behavior audit

The AIS implementation was behavior-audited against the pinned `mayhem-b200` AIS application/tests: CRC-16/X-25, NRZI, HDLC bit stuffing, message-length rules and structured position fields. The browser adapter runs two digital channel branches from a 162.000 MHz center and currently promotes fixture-backed message types 1/2/3.

The radiosonde implementation was behavior-audited against the pinned sonde packet/decoder source/tests. v0.8.9 promotes the Vaisala RS41-SG subset: 4800 bit/s 2FSK, on-air sync, the upstream 64-byte XOR mask, CRC-16/CCITT-FALSE block checks, identity/battery fields and ECEF position conversion. Meteomodem and broader sonde support are not claimed in this release.

The 406 MHz implementation was behavior-audited against the pinned EPIRB receiver/tests: 160 ms carrier acquisition, 400 bit/s biphase-L data (800 baud chips), normal/self-test sync, 112/144-bit frame sizing, BCH-1/BCH-2 and location parsing. MAYHEM RTL exposes only passive reception/analysis; no transmission path is ported or generated.


## v0.8.10 SSTV behavior audit

Audited files at the pinned host commit include `src/apps/ui_sstvrx.hpp`, `src/apps/ui_sstvrx.cpp`, `tests/test_sstvrx.cpp` and the SSTV registry/provider seams. The browser keeps the mode/VIS/timing behavior but replaces the host's documented periodic spectrum-snapshot limitation with MAYHEM RTL's existing gap-free worker IQ stream. The browser also distinguishes HF USB SSTV from VHF FM SSTV, progressively paints lines to a canvas, and exports PNG/JSON locally.

The deterministic release gate promotes Martin 1 only. Scottie 1/2/DX, Martin 2 and SC2-180 remain present as manual/experimental mode definitions until additional evidence is recorded.


## v0.8.11 browser-shell cleanup

No new upstream application body is claimed in v0.8.11. The task-grouped rail, task-first Home page, searchable/filterable Receiver Library, Easy/Advanced information-density policy, consolidated Receiver Start/Stop control and expanded Advanced inspector routing are browser-owned shell changes layered over the existing registry/routes. Native `app::Registrar` identity/category behavior and the C++ Home → Category → Application runtime remain unchanged underneath that browser presentation.
