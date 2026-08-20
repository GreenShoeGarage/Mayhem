# Security

MAYHEM RTL is a receive-only local application.

- Content Security Policy restricts scripts, styles, workers, media, and connections to the same origin and required local object URLs.
- Dynamic code evaluation is not used.
- USB permission is restricted to the application origin by Permissions Policy.
- The application refuses unknown USB identifiers and validates interface and endpoint shape before vendor commands.
- Imported JSON is parsed as data, schema-validated, size-limited, and never executed.
- User notes, filenames, device strings, and decoded text are inserted with text APIs rather than unsafe HTML assignment.
- The app requests no camera, microphone, geolocation, notifications, background synchronization, or unrelated USB access.
- Bias-tee control is off by default, Advanced Mode only, and requires a warning acknowledgement.
- No firmware-update, transmit, jamming, or radio-replay command exists.

Report suspected vulnerabilities privately to the project maintainer before public disclosure when practical. Include version, browser, operating system, steps, expected behavior, actual behavior, and whether a physical device was involved. Do not include unrelated private data or device serial numbers unless needed and intentionally shared.
