# Contributing

1. Preserve source lineage, copyright notices, SPDX identifiers, and the pinned upstream commit used for each porting change.
2. Read the original implementation before replacing behavior.
3. Keep applications self-registering or generate browser metadata from the same registry source.
4. Never enable a control without a real underlying behavior.
5. Distinguish unit-tested, simulation-tested, replay-tested, hardware-tested, and on-air-unverified states.
6. Keep the browser target receive-only and local-first.
7. Add tests for state transitions, accepted-value propagation, stale callback rejection, errors, and recovery.
8. Run `npm test`, the dead-interface audit, and the screenshot review loop before proposing a user-facing version bump.

A hardware report should include exact receiver, tuner, browser, operating system, USB driver, sample rate, frequency, duration, transfer settings, dropped samples, antenna, and observed result. Avoid publishing device serial numbers unless necessary.
