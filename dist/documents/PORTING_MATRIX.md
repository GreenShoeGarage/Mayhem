# Porting matrix

Pinned upstream: `wonderingStars/mayhem-b200@44736b9ca844732e18f35e86eb5beece1d9c2c57`

| Component or responsibility | Browser classification | v0.8.2 state | Verification |
|---|---|---|---|
| `radio::RadioDevice` contract | Portable with browser backend | Interface/scaffold preserved; WebUSB transport active below browser seam | C++ contract + physical reference receive validation |
| Actual-value setters | Portable | Serialized browser control queue updates state after hardware acceptance | Unit + physical receive tested |
| RTL2832U WebUSB | Browser adapter | Validated identifiers, descriptor checks, tuner init/control, live streaming | Physical reference validated |
| Direct sampling | Browser adapter | Explicit input-path control used by Broadcast AM and Amateur HF below tuner floor | Unit-tested decision/control path; focused HF review pending |
| R820T/R820T2/R860 family | Browser adapter | Conservative family detection/reporting | Physical reference family validated; exact differentiation pending |
| R828D / Blog V4 profile | Browser adapter | Detection/input switching and zero-minimum low-frequency compatibility profile | Unit/source audited; separate hardware validation pending |
| WFM/NFM/AM demodulators | DSP + AudioWorklet | Implemented | Deterministic fixtures + prior on-air history; repaired current audio-output layer pending physical re-check |
| USB/LSB | Worker DSP + AudioWorklet | Complex sideband selection, SSB filter, RIT, audio AGC | Deterministic selected/opposite-sideband and RIT fixtures; on-air pending |
| CW | Worker DSP + AudioWorklet | Narrow complex filter + adjustable beat pitch + audio AGC | Deterministic beat-pitch fixture; on-air pending |
| Amateur Radio | Browser workflow on shared receiver | 160 m–70 cm presets, mode/filter/fine tune/RIT/AGC, HF input manager | Unit-tested; physical focused review pending |
| Broadcast Radio | Browser workflow on shared receiver | FM/AM presets, direct-sampling decision, channel stepping, station save | Unit-tested workflow; repaired current audio path pending physical review |
| Frequency Scanner | Portable control logic + browser panel | Serialized scan, threshold, hold, history, lockouts, CSV | Unit-tested; live range review pending |
| ADS-B decoder | Portable decoder + worker/browser panel | Mode S CRC, DF17/18, ID, altitude, velocity, CPR, tracker, JSON | Fixture/simulation-tested; on-air pending |
| ADS-B graticule | Browser structured panel | Local coordinate graticule | Static/unit reviewed; no remote maps |
| Raw IQ capture | Browser storage | Streaming Origin Private File System / Indexed Database | Browser workflow + physical receive/capture validated |
| Replay | Browser file adapter | Local block replay + modulation metadata restore | Unit/browser tested |
| Spectrum/waterfall | DSP + browser renderer | Implemented | Physical reference validated |
| Stream planner / SharedArrayBuffer | Browser performance adapter | Bounded profiles, shared fixed slots, transferable fallback | Unit + physical reference validated |
| AudioWorklet output | Browser audio adapter | Fixed ring + prebuffer/rebuffer diagnostics | Automated structure/behavior tested; repaired current output pending physical re-check |
| 240 × 320 framebuffer | Browser display adapter | C++/WebAssembly-owned | C++/WebAssembly tested |
| Application registry | Portable with linker care | JSON generates browser metadata + per-app native C++ Registrar units | Unit/C++ tested |
| Navigation | Portable behavior | C++ Home → Category → Application stack | Unit/C++ tested |
| Version ownership | Build/runtime | Semantic source + injected UI/cache version + runtime HTML/JS guard | Build + regression tested |
| Exact upstream font/bitmap/theme | Portable assets | Not byte-for-byte linked | Pending deeper Emscripten convergence |
| Full upstream widget/focus tree | Portable with browser adapter | Modular seam exists; complete STL runtime not linked in freestanding build | Pending full Emscripten convergence |
| Transmit applications | Blocked by receive-only hardware | Visible and locked | Unit-tested gating |
| PWA/offline shell | Browser adapter | Implemented with versioned network-first sensitive assets | Browser/static audit |
| Telemetry | Excluded | None | No-network audit |
