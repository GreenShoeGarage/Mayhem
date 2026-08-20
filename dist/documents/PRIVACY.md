# Privacy

MAYHEM RTL has no telemetry, analytics, advertising, account system, crash uploader, remote map tiles, remote fonts, or silent network request.

Radio samples, decoded results, settings, stations, notes, captures, and diagnostic logs remain in local browser storage. Data leaves the browser only when the user explicitly exports or prints it.

The service worker requests only same-origin application assets. After those static assets load, the application generates no outbound network traffic.

Diagnostics exports omit the USB serial number by default. The user can explicitly include it when preparing a hardware report.

Clearing local data removes project records, station presets, capture metadata, diagnostic records, and locally stored capture files where browser APIs permit. Browser-managed backups or synchronized profiles are controlled by the browser vendor and operating system, not this application.
