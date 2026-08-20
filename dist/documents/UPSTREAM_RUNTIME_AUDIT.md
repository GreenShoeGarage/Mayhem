# Upstream runtime audit — MAYHEM RTL v0.8.2

Pinned upstream: `wonderingStars/mayhem-b200@44736b9ca844732e18f35e86eb5beece1d9c2c57`

Version 0.8.2 adds the Amateur Radio/SSB/CW browser functionality on the modular runtime-convergence seams established previously. It does not claim that every upstream UI or application translation unit is byte-for-byte linked into WebAssembly.

| Upstream area | Upstream source reviewed | Browser state | Truthful status |
|---|---|---|---|
| UI geometry / RGB565 Color / key ordinals | `src/ui/ui.hpp`, `src/ui/ui.cpp` | Matching geometry/packing/8×16 metrics/key ordinals in `src/mayhem/ui.*` | Adapted + compile-tested |
| Painter seam | `src/ui/ui_painter.*` | `src/mayhem/painter.*` draws through browser framebuffer adapter | Behavior-converged; exact font assets pending |
| Application registry | `src/apps/app_registry.*` | Per-app file-scope `app::Registrar` generated from one definition | Native registration semantics implemented |
| Home/category behavior | `src/apps/main_menu.cpp` | C++ Home → Category → Application push/pop | Behavior-converged |
| Analog audio mode model | `src/apps/analog_audio_app.cpp`, receiver model | Audited upstream configuration exposes AM variants, USB, LSB and CW; browser worker implements WFM/NFM/AM/USB/LSB/CW | Mode/product behavior aligned; browser DSP adapter is independently implemented and fixture-tested |
| ADS-B / Mode S | `src/apps/ui_adsb_rx.*`, upstream tests | Browser worker implements CRC, selected extended-squitter fields, CPR and tracking | Ported subset with deterministic fixtures; on-air pending |
| Browser radio state | `radio::RadioDevice` contract | Actual frequency/rate/level/tuner/gain/drop/error mirrored into core | Implemented state mirror; complete app-to-WebUSB C++ backend remains future full-Emscripten work |
| Exact fixed 8×16 font bytes | `src/ui/ui_font_fixed_8x16.*` | Fallback glyph renderer with upstream cell geometry | Pending exact asset import |
| Exact bitmap/theme assets | `src/ui/bitmaps.*`, `src/ui/theme.*` | Browser/core replacements | Pending exact asset import |
| Full widget/focus tree | `src/ui/ui_widget.*`, `ui_focus.*`, `ui_menu.*` | Modular seams exist; complete upstream STL tree not compiled in freestanding artifact | Pending full Emscripten convergence |
| Native application bodies | `src/apps/*` | Registry identity is native C++; Broadcast/Amateur/Scanner/ADS-B use browser/worker implementations | Partial application convergence |

## Analog audio behavior used in v0.8.2

The pinned `analog_audio_app.cpp` exposes an AM-family configuration menu containing `DSB 9k`, `DSB 6k`, `USB`, `LSB`, and `CW`, alongside the upstream receiver model's NFM/WFM modes. MAYHEM RTL uses that audited organization as evidence that USB/LSB/CW belong in the analog receive family.

The browser implementation is not a textual copy of that complete native application. It uses worker-side complex filtering, digital RIT, CW beat generation and browser AudioWorklet output appropriate to the RTL-SDR/WebUSB target. Deterministic fixtures verify the selected browser behavior.

## ADS-B source behavior used in v0.8

The browser decoder follows audited `mayhem-b200` Mode S behavior for its supported subset, including the 24-bit CRC polynomial, identification character mapping, supported altitude extraction, velocity parsing and global airborne CPR pairing. Browser-specific sample/pulse detection and structured presentation are browser adapters.

## Why the freestanding core still differs

The static build uses stock Clang freestanding `wasm32` modules. The exact upstream host widget tree depends on the C++ standard library. The repository retains `MB200_WEB=ON` as the eventual complete Emscripten source-convergence target and keeps that boundary explicit.
