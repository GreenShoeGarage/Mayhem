# Compatibility

Version: **MAYHEM RTL v0.8.2**

## Browsers

Live radio requires a Chromium-based browser with Web Universal Serial Bus (WebUSB) support and a secure context. Simulation and replay can work without WebUSB when the required WebAssembly, worker and storage capabilities exist.

Audio requires AudioWorklet and an explicit user gesture. The repaired v0.8.1+ audio-output layer still needs a focused physical re-check on the reference configuration.

## Receiver families

Target hardware includes RTL2832U receivers with R820T, R820T2, R828D (including the RTL-SDR Blog V4 switching profile), and R860 where compatible with the audited R8xx behavior.

The reference physical record is `RTL2838UHIDIR`, conservatively reported as the R820T/R820T2/R860 family.

## Amateur Radio / HF

The Amateur Radio workspace supports USB, LSB, CW, AM and NFM in software.

Whether a requested HF frequency can be physically received depends on the connected receiver. For profiles with a normal tuner floor near 28.8 MHz, lower HF presets request the RTL2832U Q-branch direct-sampling path when available. A profile advertising a suitable low-frequency input can remain on its normal path. Other hardware may require an external upconverter.

USB/LSB/CW are deterministic-fixture tested in v0.8.2; on-air validation remains pending.

## Broadcast Radio

FM broadcast uses the normal tuner path around 87.5–108 MHz and WFM. Medium-wave AM uses 530–1710 kHz and may require direct sampling on ordinary R8xx profiles. Common 10 kHz and 9 kHz AM steps are offered without claiming a worldwide channel plan.

## Scanner

The Scanner works with a live, simulation or compatible replay source whose tuning context covers the selected range. Live tuning is serialized through the common radio command queue.

## ADS-B

The ADS-B browser decoder expects 1090 MHz and at least 2.0 Msps; the focused workflow configures 2.4 Msps. Fixture verification covers Mode S CRC-valid extended squitter, callsign, supported altitude/velocity, global airborne Compact Position Reporting and IQ-level pulse recovery. On-air aircraft reception remains a separate verification state.

## Shared-memory path

When cross-origin isolation and SharedArrayBuffer are available, the shared fixed-slot raw-input pool activates automatically. The transferable-buffer path remains the compatibility fallback.

## Receive-only boundary

Broadcast Radio, Amateur Radio, Scanner, ADS-B and the general Receiver are receive-only. Transmit applications remain visible but locked.
