# Porting matrix

Pinned upstream: `wonderingStars/mayhem-b200@44736b9ca844732e18f35e86eb5beece1d9c2c57`

| Component or responsibility | Browser classification | v0.2.0 state | Verification |
|---|---|---|---|
| `radio::RadioDevice` contract | Portable with browser backend | Interface preserved; C++ bridge scaffolded | Source-audited, compile-tested |
| Actual-value-returning setters | Portable | Implemented in JavaScript transport and command queue | Mock-tested |
| Device capability policy | Portable with RTL-SDR policy | Receive-only manifest and conservative caps implemented | Unit-tested |
| Self-registering application registry | Portable with linker care | Upstream model recorded; full registry linkage pending | Source-audited |
| 240 × 320 logical framebuffer | Browser display adapter | Crisp canvas target and input mapping present; upstream painter linkage pending | Browser-rendered target only |
| Keyboard, pointer, wheel and touch input | Browser adapter | Implemented for shell and port-target canvas | Unit/manual smoke test |
| Native main loop | Replaced | Browser event loop and worker pipeline | Automated smoke test |
| Universal Hardware Driver backend | Excluded from browser target | Not compiled or bundled | Static audit |
| `sdrlink` / native remote server | Excluded | Not compiled or bundled | Static audit |
| Windows Graphics Device Interface / X Window System | Replaced | Canvas 2D rendering | Browser smoke test |
| Windows Multimedia / Advanced Linux Sound Architecture | Replaced | AudioWorklet scaffold; audio apps disabled | Not yet verified |
| WinHTTP telemetry subsystem | Excluded | No telemetry source or endpoint in distribution | No-network audit |
| Native filesystem | Replaced | Indexed Database and Origin Private File System | Browser API path implemented |
| RTL2832U WebUSB control | Browser adapter | Implemented for validated Realtek identifiers | Initial physical bring-up successful; soak/matrix pending |
| R820T/R820T2/R860 family | Browser adapter | R8xx-compatible detection and control | Initial family-level physical bring-up successful; exact tuner differentiation and wider coverage pending |
| R828D / RTL-SDR Blog V4 profile | Browser adapter | Detection and input-switching profile implemented | Hardware-unverified |
| Raw unsigned 8-bit IQ receive | Browser adapter | Bounded transfer pump and worker ingestion | Live hardware receive observed at 1.024 Msps; sustained soak pending |
| Byte-to-complex conversion | Portable DSP kernel | Local WebAssembly kernel plus JavaScript fallback | Unit-tested |
| Spectrum / waterfall | Portable with browser renderer | Implemented | Simulation-tested and live hardware-observed |
| Wideband Frequency Modulation audio | Portable DSP + AudioWorklet | Port pending; launcher visible and locked | Not claimed |
| Narrowband Frequency Modulation audio | Portable DSP + AudioWorklet | Port pending; launcher visible and locked | Not claimed |
| Amplitude Modulation audio | Portable DSP + AudioWorklet | Port pending; launcher visible and locked | Not claimed |
| Frequency scanner | Portable control/application logic | Port pending | Not claimed |
| Raw capture | Browser storage adapter | Streaming storage implemented | Simulation and Chromium workflow tested |
| Replay | Browser file adapter | Local block replay implemented with transferable-buffer-safe pacing | Unit and Chromium workflow tested |
| Automatic Dependent Surveillance–Broadcast receiver | Portable decoder + structured panel | Manifest entry and fixture target only | Decoder pending |
| Map panels | Browser structured panel | Local graticule design recorded | Pending |
| Transmit applications | Blocked by receive-only hardware | Visible, locked, explanatory | Unit-tested gating |
| Bias tee | Browser adapter, device-specific | Advanced-only, default off, warning required | Hardware-unverified |
| Direct sampling | Browser adapter, device-specific | Advanced-only | Hardware-unverified |
| Progressive Web Application | Browser adapter | Implemented | Controlled offline reload tested in Chromium |
| Cross-origin isolation | Hosting responsibility | Headers supplied; compatibility build does not require shared memory | Header and Chromium preflight audit |
