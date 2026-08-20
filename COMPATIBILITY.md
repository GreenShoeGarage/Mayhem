# Compatibility

Version: **MAYHEM RTL v0.8.11**

## Browsers

Version 0.8.11 is a UI/UX-only release: it does not change browser, radio, tuner, protocol, or project-schema compatibility.

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

## Signal Analysis Suite

Level, Detector, Fox Hunt, Search, Looking Glass, Signal Hunter and Time Sink work with live reception and applicable simulation/replay contexts. Looking Glass and Signal Hunter range-hop modes require a tunable live/simulation source; replay cannot retune outside the capture context. Looking Glass is serial rather than simultaneous wideband reception. Signal Hunter v0.8.4 records post-trigger IQ only. Time Sink publishes bounded downsampled snapshots, not a continuous replacement for raw capture.

The Level and Fox Hunt readouts are relative dBFS measurements unless the operator supplies independently calibrated hardware and correction data. No direction-of-arrival or calibrated field-strength claim is made.

## Digital Decoder Suite

AFSK, APRS, ACARS, RTTY and Morse are deterministic-IQ/fixture tested in v0.8.5 and remain **on-air pending**. AFSK/APRS/ACARS use the ordinary tuner path at their default VHF frequencies. RTTY and Morse can request the same HF direct-sampling path used by Amateur Radio when the selected channel lies below the detected tuner floor and the device profile permits Q-branch direct sampling.

APRS v0.8.5 decodes AX.25 address/path/text plus basic uncompressed latitude/longitude; compressed position, Mic-E and higher-level APRS message semantics are not yet claimed. ACARS uses a deliberate small IF offset to avoid the center-frequency DC notch. Morse uses a fixed 2 kHz decoder IF offset and requires operator-set WPM/threshold in this first release.

## POCSAG

The POCSAG receiver supports automatic or fixed 512/1200/2400 bit/s decoding from the continuous worker IQ stream. It is simulation/fixture tested; on-air verification remains pending. Paging frequencies vary by country, region and operator. Decoded content remains local and may be sensitive. The optional FSK monitor requires AudioWorklet; decoding itself does not.

## ADS-B

The ADS-B browser decoder expects 1090 MHz and at least 2.0 Msps; the focused workflow configures 2.4 Msps. Fixture verification covers Mode S CRC-valid extended squitter, callsign, supported altitude/velocity, global airborne Compact Position Reporting and IQ-level pulse recovery. On-air aircraft reception remains a separate verification state.

## Shared-memory path

When cross-origin isolation and SharedArrayBuffer are available, the shared fixed-slot raw-input pool activates automatically. The transferable-buffer path remains the compatibility fallback.

## Receive-only boundary

Broadcast Radio, Amateur Radio, Scanner, the seven Signal Analysis Suite applications, AFSK, APRS, ACARS, RTTY, Morse, POCSAG, ADS-B and the general Receiver are receive-only. Transmit applications remain visible but locked.


## v0.8.11 interface compatibility

The grouped navigation, Receiver Library search/filter controls, task-first Home page, stateful Receiver Start/Stop button and Easy/Advanced visibility rules are browser-shell changes only. Existing route identifiers, capture formats, project schema 12, decoder settings and receive-only application availability remain compatible with v0.8.10.

## v0.8.10 Slow-Scan Television

| Application | Browser state | Evidence | Remaining boundary |
|---|---|---|---|
| SSTV RX | Ready, receive-only | Complete Martin 1 320×256 deterministic image; USB/FM IQ through quantization/DC removal/chunk boundaries; VIS and progressive canvas integration | Live/on-air validation; v0.8.12 robustness; broader Scottie/other-mode validation |

HF SSTV can use the existing RTL2832U Q-branch direct-sampling path when the selected frequency is below an R8xx tuner floor. The 14.230 MHz preset resolves to USB; the 145.800 MHz ISS-style preset resolves to FM. Auto is a convenience heuristic, not a band-plan database.

## v0.8.8 Paging applications

| Application | Browser state | Evidence | Remaining boundary |
|---|---|---|---|
| FLEX RX | Ready, receive-only | 1600 2FSK deterministic IQ / BCH / Phase-A page fixture | On-air validation; 3200/6400/4FSK/full vectors |
| Two-Tone RX | Ready, receive-only | Motorola/EIA A/B deterministic IQ fixture | On-air validation; no agency identity inference |

The v0.8.6 reference baseline is recorded as user-validated; the two v0.8.8 applications remain fixture-tested until separate physical evidence is recorded.

## v0.8.9 Tracking & Beacons applications

| Application | Browser state | Evidence | Remaining boundary |
|---|---|---|---|
| AIS RX | Ready, receive-only | Dual-channel A/B deterministic IQ; CRC-16/X-25; Class-A type 1/2/3 structured positions | On-air marine validation; broader message catalog |
| Radiosonde RX | Ready, receive-only | Vaisala RS41-SG deterministic continuous IQ; descramble; block CRC; ID/battery/ECEF position | On-air sonde validation; Meteomodem/additional families |
| 406 MHz Beacon RX | Ready, passive receive-only | Deterministic long-frame biphase-L burst; BCH-1/BCH-2; Standard Location PLB fixture | Lawful physical validation; broader protocol catalog |

The v0.8.6 reference baseline remains recorded as user-validated. v0.8.8 paging and v0.8.9 tracking/beacon additions remain fixture-tested until separate physical evidence is recorded.
