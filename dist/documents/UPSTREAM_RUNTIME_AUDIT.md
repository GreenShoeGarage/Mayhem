# Upstream runtime audit — MAYHEM RTL v0.7.0

Pinned upstream: `wonderingStars/mayhem-b200@44736b9ca844732e18f35e86eb5beece1d9c2c57`

Version 0.7.0 is a convergence pass. It does not claim that every upstream UI
translation unit is byte-for-byte linked into WebAssembly. It records exactly
which upstream behaviors were moved behind C++ browser-port seams and which
source assets remain pending.

| Upstream area | Upstream source reviewed | v0.7 browser state | Truthful status |
|---|---|---|---|
| UI geometry / RGB565 Color / KeyEvent ordinals | `src/ui/ui.hpp`, `src/ui/ui.cpp` | Browser core uses matching geometry, Color packing, 8×16 metrics and key ordinals in `src/mayhem/ui.*` | Adapted from upstream behavior; compile-tested |
| Painter drawing seam | `src/ui/ui_painter.hpp`, `src/ui/ui_painter.cpp` | `src/mayhem/painter.*` renders only through the browser framebuffer `Display` adapter | Behavior-converged; exact upstream text/font dependency still pending |
| Display abstraction | `src/ui/display.*` | Browser-specific framebuffer display adapter owns fill/line/rectangle operations | Browser replacement |
| Application registry | `src/apps/app_registry.hpp`, `src/apps/app_registry.cpp` | Each generated C++ app translation unit contains a file-scope `app::Registrar`; static constructors populate `AppRegistry` | Native registration semantics implemented; fixed storage replaces STL in freestanding core |
| Home/category behavior | `src/apps/main_menu.cpp` | Home → category → application push/pop flow lives in C++ `NavigationStack` | Behavior-converged |
| Browser input | upstream `ui::KeyEvent`, encoder/touch conventions | Canvas maps keyboard, wheel and pointer to the C++ stack | Implemented and tested |
| Live radio evidence inside Mayhem core | `radio::RadioDevice` behavioral contract | Browser mirrors actual frequency/rate/level/tuner/gain/drop/error state into the C++ runtime | Implemented as state mirror; direct app-to-WebUSB `RadioDevice` calls remain future full-Emscripten work |
| Exact `fixed_8x16` glyph bytes | `src/ui/ui_font_fixed_8x16.*` | Current Painter uses the upstream 8×16 cell metrics with a compact browser-port glyph fallback | **Pending exact asset import** |
| Exact bitmap/icon assets | `src/ui/bitmaps.*` | Browser shell icons and C++ text labels remain | **Pending exact asset import** |
| Full theme implementation | `src/ui/theme.*` | Browser C++ core uses a small fixed Mayhem-style palette | **Pending full source import** |
| Full widget/focus tree | `src/ui/ui_widget.*`, `src/ui/ui_focus.*`, `src/ui/ui_menu.*` | v0.7 has modular C++ Painter/Navigation/AppRegistry seams but not the complete upstream STL-based widget tree | **Pending full Emscripten source convergence** |
| Native application translation units | `src/apps/*` | Registry identity is native C++ per app, while most actual application bodies still use browser-native panels or remain pending | Partial |

## Why the freestanding core still differs from the full upstream host port

The checked-in release artifact is built in the current development environment
with stock `clang --target=wasm32 -nostdlib`. The exact upstream host widget tree
uses C++ standard-library types such as `std::vector`, `std::string`,
`std::function`, and `std::unique_ptr`. The project retains an `MB200_WEB=ON`
Emscripten target for that complete convergence path. Version 0.7.0 deliberately
moves the browser core into the same modular boundaries first rather than
copying the upstream widget code and pretending it is compiled when the
required Emscripten C++ runtime is not present in the artifact environment.

## v0.7 acceptance evidence

- The WebAssembly core contains 16 applications populated by static
  constructors from individual file-scope `Registrar` translation units.
- Browser and WebAssembly registry order match the one JSON build definition.
- Application selection pushes a C++ application frame and back navigation pops
  app → category → Home.
- Upstream-compatible UI key ordinals and RGB565 Color packing are covered by
  native C++ tests.
- Actual tuner/gain/drop/error state can be mirrored into the C++ logical
  display.
- The same C++ runtime sources are part of the checked-in `MB200_WEB=ON` target.
