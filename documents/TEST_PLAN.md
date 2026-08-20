# Test plan

## Automated source and browser tests

- connection-state transition legality;
- duplicate connection and receive-loop rejection;
- monotonically increasing session identifiers;
- command serialization and latest-request-wins tuning;
- stale asynchronous callback rejection;
- capability and transmit gating;
- project-schema validation and migration;
- autosave state transitions;
- Fast Fourier Transform frequency-bin behavior;
- unsigned 8-bit interleaved IQ conversion;
- mock WebUSB accepted-value propagation;
- stream sequence-gap and drop accounting;
- replay pacing after transferable-buffer detachment;
- bounded diagnostic log behavior;
- no remote runtime dependency or permissive connection policy;
- service-worker asset completeness;
- controlled offline reload after service-worker installation.

## Workflow tests

The release process exercises cold start, Simulation Mode enter/exit, start/stop, tune, gain change, save station, streaming capture, capture-library review, stored-capture replay, project export/import, Easy/Advanced mode, sidebar collapse, wide/compact/tablet/mobile resize, diagnostics export, controlled offline reload, clear local data, and clean stop.

## Physical hardware matrix

Record exact browser, operating system, USB driver, receiver product, vendor/product identifiers, tuner label, antenna, frequency, requested and actual sample rates, block size, transfer depth, duration, samples, transfer failures, sequence gaps, ring drops, processing latency, and observed reception.

Representative targets:

- R820T or R820T2;
- R828D / RTL-SDR Blog V4;
- R860 where available;
- current stable Chrome and Edge on Windows and Linux;
- current Chromium on macOS where WebUSB access is available.

No hardware support state may move to `hardware-tested` from unit or simulation tests alone.
