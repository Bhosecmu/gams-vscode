import * as fs from 'fs';

export interface LogError {
    /** 1-based line number in the source .gms file */
    line: number;
    /** Raw error message text */
    message: string;
}

/**
 * Parse a GAMS .log file and extract execution-phase error locations.
 *
 * GAMS writes execution errors to the log in the form:
 *
 *   *** Error at line 42: message text
 *
 * For compilation errors that appear in the log (rare, usually in .lst), the
 * format may also be:
 *
 *   *** Error        42 in C:\path\file.gms: message
 *
 * We capture both.  Only the 1-based line number and message are returned;
 * compilation error codes come from the .lst parser instead.
 */
export function parseLog(logPath: string): LogError[] {
    let text: string;
    try {
        text = fs.readFileSync(logPath, 'utf8');
    } catch {
        return [];
    }

    const errors: LogError[] = [];

    // Pattern 1:  *** Error at line N [in file]: message
    const atLineRe = /^\*{3}\s+Error\s+at\s+line\s+(\d+)[^:]*:\s*(.+)$/im;
    // Pattern 2:  *** Error   N in file: message
    const numFileRe = /^\*{3}\s+Error\s+(\d+)\s+in\s+\S+:\s*(.+)$/im;

    for (const ln of text.split(/\r?\n/)) {
        let m = atLineRe.exec(ln);
        if (!m) { m = numFileRe.exec(ln); }
        if (m) {
            errors.push({
                line:    parseInt(m[1], 10),
                message: m[2].trim(),
            });
        }
    }

    return errors;
}
