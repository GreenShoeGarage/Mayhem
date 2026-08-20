# Porting matrix

Pinned upstream: `wonderingStars/mayhem-b200@44736b9ca844732e18f35e86eb5beece1d9c2c57`

| Component or responsibility | Browser classification | v0.7.0 state | Verification |
|---|---|---|---|
| `radio::RadioDevice` contract | Portable with browser backend | Native C++ contract preserved; live browser state is mirrored into Mayhem core; direct app-to-WebUSB call path remains future full Emscripten work | Contract-tested; live browser transport hardware-validated |
| Actual-value-returning setters | Portable | Implemented in browser WebUSB transport and serialized command queue | Mock-tested; reference-hardware tested |
| Device capability policy | Portable with RTL-SDR policy | Receive-only manifest and conservative caps implemented | Unit-tested; reference-hardware tested |
| Self-registering application registry | Portable with linker care | `src/app_registry.json` generates one C++ translation unit per app; each contains file-scope `app::Registrar`; WebAssembly static constructors populate C++ `AppRegistry` | Browser/Wasm order-tested; native C++ registry-tested |
| 240 × 320 logical framebuffer | Browser display adapter | C++ `Runtime` owns framebuffer; browser only presents pixels | WebAssembly-tested; direct framebuffer review |
| UI geometry / RGB565 Color / KeyEvent | Portable | Moved into `src/mayhem/ui.*` with audited upstream ordinals/packing/metrics | Native C++ compile/unit-tested |
| Painter | Portable with browser display | Moved into `src/mayhem/painter.*`; all logical UI drawing goes through browser `Display` adapter | WebAssembly-tested |
| Navigation stack | Portable with browser input | C++ Home → Category → Application push/pop stack; browser receives consumable activation events | WebAssembly navigation-tested |
| Exact upstream fixed 8 × 16 font bytes | Portable | **Pending exact byte-table import**; v0.7 uses 8 × 16 metrics with compact browser-port glyph fallback | Not claimed exact |
| Exact bitmap/icon set | Portable | Pending | Not claimed |
| Full upstream theme implementation | Portable | Small browser-core palette only | Pending full import |
| Complete upstream widget/focus/menu tree | Portable with Emscripten C++ runtime | Modular seams are ready; byte-for-byte STL-based translation units not yet linked in freestanding build | Pending full Emscripten convergence |
| Keyboard, pointer, wheel and touch input | Browser adapter | Canvas maps Mayhem key ordinals, encoder movement and logical pointer coordinates into C++ navigation | Unit-tested; prior browser smoke evidence |
| Native main loop | Replaced | Browser event loop / worker pipeline; `MB200_WEB=ON` target renders same C++ runtime | Build-target audited |
| Universal Hardware Driver backend | Excluded | Not compiled or bundled | Static audit |
| `sdrlink` / native remote server | Excluded | Not compiled or bundled | Static audit |
| Windows Graphics Device Interface / X Window System | Replaced | Canvas presentation of WebAssembly framebuffer | Browser path implemented |
| Windows Multimedia / Advanced Linux Sound Architecture | Replaced | AudioWorklet | Fixture-tested; user-validated on-air/reference hardware |
| WinHTTP telemetry subsystem | Excluded | No telemetry source or endpoint in distribution | No-network audit |
| Native filesystem | Replaced | Indexed Database and Origin Private File System | Browser path implemented |
| RTL2832U WebUSB control | Browser adapter | Validated Realtek identifiers, second-stage descriptor checks, R8xx control | Mock-tested; reference-hardware validated |
| R820T/R820T2/R860 family | Browser adapter | Conservative family reporting | Reference-hardware validated as family; exact differentiation pending |
| R828D / RTL-SDR Blog V4 profile | Browser adapter | Detection and switching profile implemented | Hardware-unverified |
| Raw unsigned 8-bit IQ receive | Browser adapter | Bounded transfer pump; transferable/shared worker handoff | 1.024 and 2.4 Msps user-validated on reference hardware |
| SharedArrayBuffer handoff | Browser adapter | Fixed-slot raw-sample pool with worker acknowledgement | Unit-tested; reference-hardware validated |
| Byte-to-complex conversion | Portable DSP kernel | Local WebAssembly kernel | Unit-tested |
| Spectrum / waterfall | Portable with browser renderer | Implemented | Reference-hardware validated |
| WFM audio | Portable DSP + AudioWorklet | Implemented | Fixture-tested; user-validated on-air/reference hardware |
| NFM audio | Portable DSP + AudioWorklet | Implemented | Fixture-tested; user-validated on-air/reference hardware |
| AM audio | Portable DSP + AudioWorklet | Implemented | Fixture-tested; user-validated on-air/reference hardware |
| Frequency scanner | Portable control/application logic | Pending | Not claimed |
| Raw capture | Browser storage adapter | Streaming capture implemented | Simulation/browser workflow tested; 2.4 Msps receive+capture user-validated |
| Replay | Browser file adapter | Local block replay implemented | Unit/browser workflow tested |
| ADS-B receiver | Portable decoder + structured panel | Manifest entry and fixture target only | Pending decoder |
| Map panels | Browser structured panel | Local graticule design recorded | Pending |
| Transmit applications | Blocked by receive-only hardware | Visible, locked, explanatory in browser and C++ registry | Unit-tested gating |
| Bias tee | Browser adapter, device-specific | Advanced-only, default off, warning required | Hardware-unverified |
| Direct sampling | Browser adapter, device-specific | Advanced-only | Hardware-unverified |
| Progressive Web Application | Browser adapter | Implemented | Offline reload historically browser-tested |
| Cross-origin isolation | Hosting responsibility | Headers supplied; shared path activates only when supported | Header/preflight audit; reference shared path validated |
