# Porting matrix

Pinned upstream: `wonderingStars/mayhem-b200@44736b9ca844732e18f35e86eb5beece1d9c2c57`

| Component or responsibility | Browser classification | v0.8.11 state | Verification |
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
| Signal level / Detector / Fox Hunt | Browser analysis on reduced telemetry | Relative dBFS history, threshold/hysteresis eventing, relative strength trend | Unit-tested; physical workflow review pending |
| Search | Browser analysis on reduced FFT | Current-passband separated peak finder with tune/marker actions | Deterministic spectrum tested; live review pending |
| Looking Glass | Browser sweep controller + reduced FFT | Serialized retune/dwell/fresh-slice stitched max hold | Accumulator/unit-tested; physical sweep review pending |
| Signal Hunter | Browser control + existing capture store | Single/range-hop energy trigger, cooldown, post-trigger local IQ capture | Range sequencing/capture integration tested; physical trigger review pending |
| Time Sink | Worker reduced-data adapter + browser canvas | Rate-limited bounded downsampled I/Q snapshots | Bounded worker contract tested; physical waveform review pending |
| POCSAG receive | Portable decoder + browser structured panel | Continuous worker-side 2FSK decoder, BCH, RIC/function, alpha/numeric, filtering/export, optional monitor | 512/1200/2400 deterministic IQ + Simulation Mode tested; on-air pending |
| AFSK receive | Portable decoder + browser text panel | Continuous NFM → tone-pair → asynchronous 7E1 terminal decoder with Bell/V presets | Deterministic IQ/chunk tested; on-air pending |
| APRS receive | Portable decoder + browser structured panel | Bell 202 → NRZI → HDLC → AX.25 FCS/address/path/text/basic position | Deterministic IQ tested; on-air pending |
| ACARS receive | Portable decoder + browser structured panel | IF-shifted AM → 1200/2400-Hz MSK tones → parity/framing/CRC/fields | Deterministic IQ tested; on-air pending |
| RTTY receive | Portable decoder + browser text panel | USB/LSB → 170-Hz-shift tone pair → 45.45-baud ITA2 | Deterministic IQ tested; on-air pending |
| Morse receive | Portable decoder + browser text panel | 2-kHz protected IF → CW filter/envelope → configured-speed Morse timing | Deterministic IQ + worker-style DC removal tested; on-air pending |
| ADS-B decoder | Portable decoder + worker/browser panel | Mode S CRC, DF17/18, ID, altitude, velocity, CPR, tracker, JSON | Fixture/simulation-tested; on-air pending |
| FLEX receive | Portable decoder + worker/browser panel | 1600 2FSK sync/FIW/BCH/Phase-A alphanumeric vertical slice | Deterministic continuous-IQ fixture; on-air pending |
| Two-Tone receive | Worker NFM/audio analysis + browser panel | Motorola/EIA Goertzel bank + sequential A/B state | Deterministic continuous-IQ fixture; on-air pending |
| AIS receive | Portable decoder + dual worker branches | 161.975/162.025 MHz, 9600 NRZI/HDLC/CRC, type 1/2/3 structured position | Deterministic quantized/chunked IQ; on-air pending |
| Radiosonde receive | Portable decoder + worker/browser panel | Vaisala RS41-SG 4800 2FSK, descramble, CRC, ID/battery/ECEF position | Deterministic quantized/chunked IQ; on-air pending |
| 406 MHz beacon receive | Portable receive-only decoder + worker/browser panel | Protected-IF carrier/biphase-L, BCH-1/BCH-2, Standard Location PLB slice | Deterministic quantized/chunked IQ; lawful on-air/test-source validation pending |
| ADS-B graticule | Browser structured panel | Local coordinate graticule | Static/unit reviewed; no remote maps |
| Raw IQ capture | Browser storage | Streaming Origin Private File System / Indexed Database | Browser workflow + physical receive/capture validated |
| Replay | Browser file adapter | Local block replay + modulation metadata restore | Unit/browser tested |
| Spectrum/waterfall | DSP + browser renderer | Implemented | Physical reference validated |
| Stream planner / SharedArrayBuffer | Browser performance adapter | Bounded profiles, shared fixed slots, transferable fallback | Unit + physical reference validated |
| AudioWorklet output | Browser audio adapter | Fixed ring + prebuffer/rebuffer diagnostics | Automated structure/behavior tested; repaired current output pending physical re-check |
| 240 × 320 framebuffer | Browser display adapter | C++/WebAssembly-owned | C++/WebAssembly tested |
| Application registry | Portable with linker care | JSON generates browser metadata + per-app native C++ Registrar units | Unit/C++ tested |
| Navigation | Portable behavior | C++ Home → Category → Application stack | Unit/C++ tested |
| Browser shell navigation | Browser-owned adapter | Start/Listen/Decode/Analyze/Review/Support grouping with icon-only collapsed rail | UI/UX regression tested |
| Receiver Library | Browser-owned registry presentation | Search + Featured/Listen/Decode/Analyze/Review/System/Unavailable/All filters over existing application registry | UI/UX regression tested |
| Easy/Advanced information density | Browser-owned presentation | Easy hides implementation/support detail; Advanced restores it without changing runtime ownership | UI/UX regression tested |
| Version ownership | Build/runtime | Semantic source + injected UI/cache version + runtime HTML/JS guard | Build + regression tested |
| Exact upstream font/bitmap/theme | Portable assets | Not byte-for-byte linked | Pending deeper Emscripten convergence |
| Full upstream widget/focus tree | Portable with browser adapter | Modular seam exists; complete STL runtime not linked in freestanding build | Pending full Emscripten convergence |
| Transmit applications | Blocked by receive-only hardware | Visible and locked | Unit-tested gating |
| PWA/offline shell | Browser adapter | Implemented with versioned network-first sensitive assets | Browser/static audit |
| Telemetry | Excluded | None | No-network audit |

| SSTV continuous receive path | Browser worker adaptation | Martin 1 promoted; six audited mode definitions present | Complete image + USB/FM IQ fixtures |
| SSTV progressive image/display | Browser-owned | 320×256 RGB canvas, phase/slant, PNG/metadata export | Structural + deterministic image tests |
