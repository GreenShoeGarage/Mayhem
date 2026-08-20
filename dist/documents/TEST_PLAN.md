# Test plan

## Release-gate automation

Every user-facing build must run:

```bash
npm run build
npm test
```

The release gate covers JavaScript/browser modules, portable C DSP,
receive-only C++ `RadioDevice` contracts, v0.7 Mayhem UI/registry native C++
tests, and the built-distribution no-network audit.

## v0.7 runtime-convergence tests

### Upstream-shaped UI primitives

Native C++ tests must verify:

- `ui::KeyEvent` ordinals remain Right=0, Left=1, Down=2, Up=3, Select=4,
  Dfu=5, Back=6;
- logical character metrics remain 8 × 16;
- RGB565 `Color` packing matches expected values;
- rectangle containment and intersection semantics remain stable.

### Native application registration

The build must generate one C++ translation unit per `src/app_registry.json`
entry. Each source must contain a file-scope `app::Registrar`.

Native and WebAssembly tests must verify:

- 16 registered applications;
- no duplicate IDs;
- browser and C++ registry order/identity match the one build definition;
- transmit entries carry `RequiresTx`;
- category counts are correct;
- registry hash is non-zero.

### Navigation stack

WebAssembly tests must exercise:

```text
Home → Receive category → Spectrum application → Back → category → Back → Home
```

The application selection must produce exactly one consumable browser activation
event while leaving the C++ application frame on the logical stack until Back is
pressed.

### Radio-state mirror

WebAssembly must accept and render without error:

- actual center frequency;
- actual sample rate;
- receive level;
- tuner-family code;
- automatic/manual gain state;
- actual gain;
- dropped samples;
- radio errors;
- live/simulation/replay source state.

### Browser presenter boundary

Static/module tests must confirm that browser Canvas code presents WebAssembly
pixels and maps input, but does not maintain a second Mayhem menu/navigation
implementation.

## v0.5 receiver workflow regression

Confirm Easy Mode retains the essential receiver controls in the main workspace:
frequency, tuning step, modulation, gain, receiver start/stop, audio,
capture, and station save. Advanced controls must remain suppressed in Easy Mode
without creating a second receiver state.

## v0.6 hardware validation — completed reference gate

The user has validated the recorded reference `RTL2838UHIDIR` configuration for:

- 30-minute 1.024 Msps soak with zero visible drops;
- on-air WFM/NFM/AM audio;
- AudioContext lifecycle;
- 60-minute 2.4 Msps target soak;
- 2.4 Msps receive plus capture;
- SharedArrayBuffer path;
- sustained audio without unacceptable recurring underruns;
- bounded long-run memory/queue behavior.

These results remain reference-configuration evidence rather than a wider
compatibility claim.

## Stream-planning / shared pool / performance-governor regression

Retain automated tests for:

- low/high automatic plan selection;
- custom plan bounds;
- fixed shared-slot ownership;
- acknowledgement before slot reuse;
- visualization load shedding before accepted-block audio work;
- governor degradation and hysteretic recovery.

## Audio receiver regression

Deterministic IQ fixtures remain mandatory for WFM, NFM, and AM even after
physical validation. Never replace repeatable fixture evidence with only an
on-air listening claim.

## Regression workflows

Retain tests for:

- cold start;
- Simulation Mode;
- connection denial/retry;
- start/stop;
- tune while receiving;
- sample-rate and gain change;
- capture/replay;
- project import/export and schema migration;
- hot unplug/reconnect;
- PWA update deferral;
- version consistency;
- no application-generated outbound traffic;
- transmit gating.
