# Browser release constraints

Use GDScript and the Compatibility renderer. The initial web target is single-threaded, with extension and thread support disabled, so embedding does not depend on cross-origin isolation headers. Split expensive work across frames and retain cancellation points. Do not make desktop subprocesses, local servers, or extraction tools runtime dependencies.

Import files through a browser file picker into the application's local storage. Export portable plans through a browser download. Keep ZIP and world decoding in the shared application. Browser persistence uses IndexedDB and may be restricted in private or embedded browsing; always provide portable plan export and report storage failures.

Export as `index.html` and archive the generated files together at the ZIP root. Keep relative paths and original export filenames. Test on localhost, a normal hosted page, and an iframe. A successful engine export alone does not verify file picking, persistence, memory use, or embedded interactions.

References: [Godot web export](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html) and [itch.io HTML5 uploads](https://itch.io/docs/creators/html5).
