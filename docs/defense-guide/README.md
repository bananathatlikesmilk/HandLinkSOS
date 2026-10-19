# HandLink defense guide

Open **HandLink-System-Defense-Guide.docx** for the formatted teaching document.

- 34 numbered lessons, a reading guide, and reference appendices.
- Role-specific User, Dispatcher, and Admin workflows.
- Embedded flowcharts, code explanations, limitations, and defense practice answers.
- `HandLink-System-Defense-Guide.md` is the authored source.
- `HandLink-System-Defense-Guide-complete.md` also includes the generated source/API index.
- `flowcharts/` contains reusable PNG and SVG diagrams.
- `file-notes.json` explains source-module responsibilities.

The guide describes inspected local source, not a live deployment certification. Credentials and actual database records are excluded.

To regenerate without changing app dependencies, install `docx` and `@resvg/resvg-js` into a separate temporary tools directory. Set `HANDLINK_GUIDE_TOOLS` to that directory if it differs from the default `%TEMP%/handlink-defense-doc-tools`. Run:

```powershell
node docs/defense-guide/build-guide.cjs
```

If Microsoft Word is available, open the result and update its table of contents. The optional PowerShell finalizer updates fields, saves the DOCX, and exports a PDF using a hidden Word instance. It does not modify application source or private configuration.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File docs/defense-guide/finalize-word.ps1
```
