import * as vscode from 'vscode';
import { parseLst } from './lstParser';
import { parseLog } from './logParser';
import { ERROR_DB, GAMS_ERRORS_DOC } from './errorCodes';

export class GamsDiagnosticsProvider implements vscode.Disposable {
    private readonly collection: vscode.DiagnosticCollection;

    constructor() {
        this.collection = vscode.languages.createDiagnosticCollection('gams');
    }

    /**
     * Parse the .lst and .log files produced by a GAMS run and populate the
     * VS Code Problems panel with diagnostics on the source .gms file.
     *
     * @param gmsPath  Absolute path to the main .gms source file that was run.
     * @param lstPath  Absolute path to the generated .lst file.
     * @param logPath  Absolute path to the generated .log file (may not exist).
     */
    update(gmsPath: string, lstPath: string, logPath: string): void {
        this.collection.clear();

        /** Map from absolute source-file path → diagnostics array */
        const diagMap = new Map<string, vscode.Diagnostic[]>();

        const addDiag = (filePath: string, diag: vscode.Diagnostic) => {
            let arr = diagMap.get(filePath);
            if (!arr) { arr = []; diagMap.set(filePath, arr); }
            arr.push(diag);
        };

        // ── LST errors (compilation phase) ───────────────────────────────────
        const lstErrors = parseLst(lstPath, gmsPath);
        for (const e of lstErrors) {
            const info   = ERROR_DB[e.code];
            const lineNo = Math.max(0, e.line - 1); // convert to 0-based

            // Highlight the whole line (column 0 → end of line)
            const range = new vscode.Range(lineNo, 0, lineNo, Number.MAX_SAFE_INTEGER);

            const baseMsg = info
                ? `${info.message}  [GAMS error $${e.code}]`
                : `GAMS compilation error $${e.code}`;

            const diag = new vscode.Diagnostic(range, baseMsg, vscode.DiagnosticSeverity.Error);
            diag.source = 'GAMS';
            diag.code   = {
                value:  e.code,
                target: vscode.Uri.parse(GAMS_ERRORS_DOC),
            };

            if (info?.hint) {
                // VS Code doesn't have a first-class "hint" field for the Problems
                // panel, so we append it to the message and also surface it as a
                // related information entry pointing at the same location.
                diag.message += `\n\nFix: ${info.hint}`;
                diag.relatedInformation = [
                    new vscode.DiagnosticRelatedInformation(
                        new vscode.Location(vscode.Uri.file(e.sourceFile), range),
                        `Fix hint: ${info.hint}`
                    ),
                ];
            }

            addDiag(e.sourceFile, diag);
        }

        // ── LOG errors (execution phase) ──────────────────────────────────────
        const logErrors = parseLog(logPath);
        for (const e of logErrors) {
            const lineNo = Math.max(0, e.line - 1);
            const range  = new vscode.Range(lineNo, 0, lineNo, Number.MAX_SAFE_INTEGER);

            const diag = new vscode.Diagnostic(
                range,
                `GAMS execution error at line ${e.line}: ${e.message}`,
                vscode.DiagnosticSeverity.Error
            );
            diag.source = 'GAMS';

            addDiag(gmsPath, diag);
        }

        // ── Publish to VS Code ─────────────────────────────────────────────────
        for (const [filePath, diags] of diagMap) {
            this.collection.set(vscode.Uri.file(filePath), diags);
        }
    }

    /** Remove all GAMS diagnostics (e.g. when the file is saved but not yet re-run). */
    clear(): void {
        this.collection.clear();
    }

    dispose(): void {
        this.collection.dispose();
    }
}
