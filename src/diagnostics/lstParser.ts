import * as fs from 'fs';
import * as path from 'path';

export interface LstError {
    /** 1-based line number in the source .gms file */
    line: number;
    /** GAMS error code */
    code: number;
    /** Source file path (absolute) — may differ from the main file if $include is used */
    sourceFile: string;
}

/**
 * Parse a GAMS .lst file and extract compilation error positions.
 *
 * The .lst format interleaves numbered source lines with error markers:
 *
 *   GAMS Rev 47  ...
 *   ...
 *   Include file summary
 *   1   /path/to/main.gms
 *   2   /path/to/included.gms
 *   ...
 *
 *      1  Set c crops / wheat, corn /;
 *      2  Parameter p(c);
 *      3  p(x) = 1;
 *   ****  $140
 *
 * Each error marker line starts with "****" and contains one or more $NNN codes,
 * separated by spaces. The marker appears immediately after the offending source line.
 *
 * The line number shown is the line within the *included* file. The "Include file
 * summary" at the top maps include indices to absolute paths.
 */
export function parseLst(lstPath: string, gmsPath: string): LstError[] {
    let text: string;
    try {
        text = fs.readFileSync(lstPath, 'utf8');
    } catch {
        return [];
    }

    const lines = text.split(/\r?\n/);
    const errors: LstError[] = [];

    // ── 1. Build include-file index ──────────────────────────────────────────
    // The "Include file summary" block looks like:
    //   Include file summary
    //   ......................
    //   SEQ   GLOBAL  LOCAL  PARENT  LOCAL FILENAME
    //   ...
    //   1 1 1 0 1 C:\path\to\main.gms
    //   2 10 1 1 10 C:\path\to\included.gms
    //
    // We only need the last column (file path). Index 1 = main file.
    const includeMap: Record<number, string> = { 1: gmsPath };
    let inIncludeSummary = false;
    const includeHeaderRe = /^\s*SEQ\s+GLOBAL\s+LOCAL\s+PARENT/i;
    const includeLineRe   = /^\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+(.+)$/;

    for (const ln of lines) {
        if (/Include file summary/i.test(ln)) {
            inIncludeSummary = true;
            continue;
        }
        if (inIncludeSummary) {
            if (includeHeaderRe.test(ln)) { continue; }
            const m = includeLineRe.exec(ln);
            if (m) {
                const idx      = parseInt(m[1], 10);
                const filePath = m[2].trim();
                includeMap[idx] = filePath;
            } else if (ln.trim() === '' && Object.keys(includeMap).length > 1) {
                // Blank line after include entries signals end of block
                inIncludeSummary = false;
            }
        }
    }

    // ── 2. Scan numbered source lines + **** error markers ───────────────────
    // Source line:  /^\s{0,6}(\d+)\s{2,}/    (line number, 2+ spaces, source text)
    // Error marker: /^\*{4}\s*((?:\$\d+\s*)+)/
    //
    // We also track which include file is active. GAMS emits a comment like:
    //   ---- INCLUDE  C:\path\to\file.gms
    // whenever it switches to an included file, then back.

    const sourceLineRe  = /^\s{0,6}(\d+) {2,}/;
    const errorMarkerRe = /^\*{4}[\s$]*((?:\$\d+[\s$]*)+)/;
    const includeTagRe  = /^----\s+INCLUDE\s+(.+)$/i;

    let lastSourceLine = 0;
    let currentFile    = gmsPath;

    for (const ln of lines) {
        const inclMatch = includeTagRe.exec(ln);
        if (inclMatch) {
            const p = inclMatch[1].trim();
            // Try to resolve against includeMap values (exact or basename match)
            const resolved = Object.values(includeMap).find(
                v => v === p || path.basename(v).toLowerCase() === path.basename(p).toLowerCase()
            );
            currentFile = resolved ?? p;
            continue;
        }

        const srcMatch = sourceLineRe.exec(ln);
        if (srcMatch) {
            lastSourceLine = parseInt(srcMatch[1], 10);
            continue;
        }

        const errMatch = errorMarkerRe.exec(ln);
        if (errMatch && lastSourceLine > 0) {
            // Extract all $NNN codes from the marker line
            const codeRe = /\$(\d+)/g;
            let cm: RegExpExecArray | null;
            while ((cm = codeRe.exec(errMatch[1])) !== null) {
                const code = parseInt(cm[1], 10);
                errors.push({ line: lastSourceLine, code, sourceFile: currentFile });
            }
        }
    }

    return errors;
}
