# Test results — MAYHEM RTL v0.8.11

Date: 2026-08-20

## Release gate

Commands:

```text
npm run build
npm test
```

Result: **PASS**.

- 108/108 JavaScript/browser-module tests passed.
- Portable C Digital Signal Processing kernel tests passed.
- Receive-only C++ `RadioDevice` contract tests passed.
- C++ Mayhem UI primitive and native `app::Registrar` registry tests passed.
- Both WebAssembly assets built successfully.
- Production no-network audit passed.
- Generated native application registry contains 42 applications.

## v0.8.11 UI/UX cleanup coverage

- The navigation task groups and Receiver Library naming are regression-pinned.
- Easy Mode's advanced-only status and support controls are checked structurally.
- Home is verified to be task-first and free of the duplicate source-card controls removed in this release.
- The general Receiver is checked for one stateful Start/Stop control and automatic/manual gain visibility.
- Receiver Library search/task filters and transmit-only separation are checked.
- Advanced inspector routing is checked across the modern receive workspaces.
- No project-schema migration is introduced; schema remains 12.
- Generated native application registry remains 42 applications.

## v0.8.10 SSTV coverage

- The audited six-mode SSTV table and VIS parity behavior are deterministic.
- 1500 Hz maps to black and 2300 Hz maps to white.
- A complete 256-line Martin 1 frequency fixture reconstructs all 256 RGB scanlines progressively and checks known red/green/blue plane values.
- Martin 1 USB-IQ survives unsigned-8-bit quantization, worker-style per-block DC removal and ordinary 32,768-sample worker boundaries.
- Martin 1 FM-IQ reaches the same image decoder path.
- Worker integration is explicitly checked so SSTV decoder state is not reconfigured/reset once per IQ block.
- The browser shell exposes 14.230 MHz USB and 145.800 MHz FM presets, Auto/USB/FM input selection, Auto VIS, manual mode fallback, phase/slant controls, a progressive canvas, raw IQ capture, local PNG export and JSON metadata export.
- Simulation Mode contains a complete 256-line Martin 1 image fixture.
- SSTV capture metadata records application, input mode, image mode, VIS setting, phase and slant so a recorded SSTV IQ file can reopen into the SSTV replay workflow.

## Prior coverage retained

All prior v0.8.x regression gates remain active, including WFM/NFM/AM/USB/LSB/CW, Scanner, ADS-B, POCSAG, Signal Analysis, AFSK/APRS/ACARS/RTTY/Morse, TPMS/Weather, FLEX/Two-Tone, AIS, Vaisala RS41-SG, passive 406 MHz beacon reception, WebUSB state/identifier policy, project migration, SharedArrayBuffer/performance behavior, version/cache consistency, C/C++ contracts and the no-network distribution audit.

## Physical evidence boundary

The user reported the **v0.8.6 reference baseline validated**. That remains the explicitly recorded hardware baseline. v0.8.8/v0.8.9 additions and v0.8.10 SSTV are deterministic-fixture tested and are **not yet claimed as on-air validated**.

SSTV physical validation should cover both a known HF USB image source and a known VHF/FM image source, plus capture/replay of the same IQ.

## Known SSTV limitations

- Martin 1 is the promoted reference mode in v0.8.10. Scottie 1/2/DX, Martin 2 and SC2-180 mode/timing definitions are present but remain pending broader physical validation.
- Auto input mode intentionally uses a simple convention: USB below 30 MHz and FM above it. Manual selection is available for other operating conventions.
- Automatic tone centering, automatic slant estimation, aggressive lost-sync recovery and an image gallery/history remain candidates for v0.8.12.
- Live/on-air SSTV reception has not been demonstrated in this artifact environment.
- A fresh Chromium localhost smoke is not claimed when the artifact browser runtime cannot complete local navigation; module/native/WebAssembly and deterministic continuous-IQ tests are the release evidence here.
