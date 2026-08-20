# Test results

Version: **0.7.0**  
Upstream commit: `44736b9ca844732e18f35e86eb5beece1d9c2c57`  
Web RTL-SDR reference commit: `5699cec220cb0349e8f9144b7b71d3d03b5d9dbf`  
Executed: `2026-08-20T04:57:37Z`

## Verification boundary

Version 0.7.0 is the runtime-convergence release after the physically validated
v0.6 receiver/audio/performance milestone. Automated JavaScript/browser-module
tests, portable C DSP tests, receive-only C++ `RadioDevice` contract tests,
new native C++ Mayhem UI/registry tests, both WebAssembly builds, direct logical
framebuffer rendering, and the built-distribution no-network audit were executed
in the artifact environment.

Physical radio evidence is carried forward from the user's validated reference
`RTL2838UHIDIR` configuration. That evidence is intentionally scoped to that
reference setup and is not treated as a universal device/browser/operating-
system compatibility claim.

## Automated command

```bash
npm run build
npm test
```

## Result summary

- **35 JavaScript/browser-module tests passed.**
- Portable C DSP kernel tests passed.
- Receive-only C++ `RadioDevice` contract tests passed.
- New C++ upstream-shaped UI primitive tests passed.
- New C++ native `app::Registrar` registry tests passed.
- All 16 generated native application registration translation units compiled
  into the registry test.
- `dist/assets/dsp_core.wasm` compiled successfully.
- `dist/assets/mayhem_core.wasm` compiled successfully.
- `mayhem_core.wasm` imports no host functions in the freestanding release
  module and exports its static-constructor entry point.
- Browser and C++ registry order/identity match the one authoritative
  `src/app_registry.json` definition.
- Built-distribution outbound-runtime audit passed.
- No remote runtime URL literals or permissive connection policy were found by
  the release audit.

## v0.7 runtime-convergence coverage

Automated tests and build checks cover:

1. Upstream-compatible `ui::KeyEvent` ordinals: Right=0, Left=1, Down=2,
   Up=3, Select=4, Dfu=5, Back=6.
2. 8 × 16 logical character metrics.
3. RGB565 `Color` packing.
4. Rectangle containment/intersection behavior.
5. One generated C++ application translation unit per registry entry.
6. File-scope `app::Registrar` construction for all 16 applications.
7. Duplicate application-ID rejection in the C++ registry.
8. Registry category counts and transmit flags.
9. Non-zero deterministic registry hash.
10. WebAssembly/browser registry order agreement.
11. Home → Receive → Spectrum application push navigation.
12. Application → category → Home Back-pop navigation.
13. Exactly one consumable application-activation event per selection.
14. 240 × 320 WebAssembly framebuffer ownership.
15. Browser Canvas presenter/input-adapter boundary.
16. Actual frequency, rate, level, tuner-family, gain, automatic-gain state,
    dropped-sample count, error count and source-state mirroring into the C++
    logical display.
17. Native C++ runtime sources included in the checked-in `MB200_WEB=ON`
    Emscripten target.
18. One-source application-registry generation into browser metadata plus native
    C++ registrar translation units.

## Direct framebuffer review

The v0.7 C++ WebAssembly framebuffer was rendered directly and reviewed in
three states:

- `screenshots/MAYHEM-RTL-v0.7.0-core-home.png`
- `screenshots/MAYHEM-RTL-v0.7.0-core-receive.png`
- `screenshots/MAYHEM-RTL-v0.7.0-core-spectrum-app.png`

The reviewed frames show category-first Home navigation, Receive application
status, C++ application-stack activation, and mirrored live-radio metadata.

## Receiver/audio/performance regression retained

The automated release gate also retains coverage for:

- deterministic WFM, NFM and AM IQ-to-audio fixtures;
- bounded AudioWorklet ring structure;
- FFT carrier placement and input validation;
- receive-only transmit gating;
- live connected-idle → receiving → connected-idle transitions;
- automatic/high-rate/custom stream-plan bounds;
- adaptive performance-governor degradation and hysteretic recovery;
- fixed-slot SharedArrayBuffer ownership and acknowledgement before reuse;
- audio processing before optional spectrum-stride load shedding;
- Easy Mode essential receiver controls;
- project schema validation and migration;
- replay pacing after transferable-buffer detachment;
- stale-session rejection and latest-request-wins serialized control;
- restricted WebUSB identifiers and second-stage unrelated-device rejection;
- single-source user-visible semantic versioning;
- service-worker stale-JavaScript/version regression protection.

## Physical reference validation carried forward

Reference device: `RTL2838UHIDIR`  
Conservative tuner label: R820T/R820T2/R860 family.

The recorded v0.6 validation gate includes:

- direct WebUSB connection and initialization;
- physical live sample reception;
- live spectrum and waterfall;
- retune while receiving;
- gain changes;
- sample-rate changes;
- stop/restart;
- hot unplug/reconnect recovery;
- 30-minute 1.024 Msps soak with zero visible dropped samples;
- on-air WFM audio;
- on-air NFM audio;
- on-air AM audio;
- AudioContext lifecycle;
- 60-minute 2.4 Msps target soak;
- 2.4 Msps receive plus capture;
- SharedArrayBuffer stream path;
- sustained audio without unacceptable recurring underruns;
- bounded long-run memory/queue behavior.

These capabilities may be labeled hardware-tested/on-air verified for that
recorded reference configuration only.

## Browser smoke boundary for v0.7.0

No new full Chromium end-to-end localhost smoke run is claimed for this patch.
The artifact environment has previously blocked or timed out local browser
navigation. Earlier Chromium shell/simulation/capture/replay/offline/responsive
records remain historical regression evidence; v0.7's new runtime behavior is
covered here by direct WebAssembly rendering, native/module tests and built-
runtime audits. An ordinary interactive browser walkthrough on the target
machine remains appropriate before release-candidate status.

## Deliberately incomplete / not yet verified

Version 0.7.0 materially converges the runtime but does **not** claim the
following as complete:

- exact upstream `fixed_8x16` glyph byte table in browser WebAssembly;
- complete upstream bitmap/icon/theme resources in browser WebAssembly;
- complete upstream STL-based `ui_widget` / focus / menu / navigation
  translation units in the browser WebAssembly build;
- most native upstream application bodies; registry identity is native C++ but
  many functions still use browser-native panels or remain pending;
- direct native Mayhem application-to-WebUSB calls through a fully active
  `WebUsbRtlSdrRadio : radio::RadioDevice` Emscripten runtime;
- R828D physical hardware;
- exact R860 physical identification;
- wider device/browser/operating-system physical matrix;
- Frequency Scanner;
- Automatic Dependent Surveillance–Broadcast decoder fixture and on-air path.

See `UPSTREAM_RUNTIME_AUDIT.md` for the exact source-convergence boundary. No
pending capability above should be relabeled complete, hardware-tested or
on-air verified until recorded evidence supports it.
