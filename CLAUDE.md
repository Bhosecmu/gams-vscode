# GAMS VS Code Extension

A VS Code extension for the GAMS (General Algebraic Modeling System) language.

## Reference Resources

Add your context URLs here before starting work on each phase:

### GAMS Studio (Syntax Highlighting Source)
- URL: https://github.com/GAMS-dev/studio/tree/master/src/syntax
- Use: Reference for TextMate grammar rules, keywords, operators, token types

### GAMS Documentation
- URL: https://gams.com/latest/docs/
- Use: Error codes, language reference, built-in functions and keywords

### GAMS User Forum
- URL: https://forum.gams.com/
- Use: Common syntax questions, real-world error patterns and fixes

### GDX Viewer VS Code Extension Sample
- URL: https://github.com/Vaibhavnath-Jha/vscode-gdxviewer
- Use: Reference implementation for viewing GDX binary files in VS Code

### GAMS Model library
- URL: https://gams.com/latest/gamslib_ml/libhtml/index.html#gamslib
- Use: Reference for grammar rules, keywords, operators, token types

## Development Phases

### Phase 1 — Syntax Highlighting (start here)
- TextMate grammar in `syntaxes/gams.tmLanguage.json`
- Language configuration in `language-configuration.json`
- Derive token scopes from GAMS Studio source

### Phase 2 — GDX & .ref File Viewer
- Custom editor / webview in `src/gdxviewer/`
- Reference the vscode-gdxviewer sample above
- `.ref` files are plain text; GDX files are binary (GAMS-specific format)

### Phase 3 — Run Button
- Command + status bar button in `src/runner/`
- Spawns GAMS process, streams output to terminal
- Requires GAMS installation path (configurable in settings)

### Phase 4 — Error Detection & Fix Suggestions
- Log file parser in `src/diagnostics/`
- Reads `.log` output, maps error codes to GAMS docs
- Surfaces diagnostics in VS Code Problems panel with suggested fixes
- Can query GAMS docs / forum context for suggestions

## Extension Settings (planned)

- `gams.executablePath`: Path to the GAMS executable
- `gams.defaultScratchDir`: Working directory for GAMS runs
- `gams.logLevel`: Verbosity of extension logging

## Notes

- Language ID: `gams`
- File extensions: `.gms`, `.gams`
- GDX files: `.gdx` (binary)
- Reference files: `.ref`
- Log files: `.log`
