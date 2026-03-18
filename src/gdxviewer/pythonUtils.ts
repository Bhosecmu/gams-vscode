import * as vscode from 'vscode';
import * as cp from 'child_process';

/** Return the Python interpreter path from the VS Code Python extension, or fall back to system python. */
export async function getPythonPath(): Promise<string> {
    try {
        const pyExt = vscode.extensions.getExtension('ms-python.python');
        if (pyExt) {
            if (!pyExt.isActive) {
                await pyExt.activate();
            }
            const api = pyExt.exports;
            const path: string | undefined =
                api?.settings?.getExecutionDetails?.()?.execCommand?.[0] ??
                api?.environments?.getActiveEnvironmentPath?.()?.path;
            if (path) {
                return path;
            }
        }
    } catch {
        // fall through
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}

/** Check whether gams-transfer is importable in the given Python (10 s timeout). */
export function checkGamsTransfer(pythonPath: string): Promise<boolean> {
    return new Promise(resolve => {
        const proc = cp.spawn(pythonPath, ['-c', 'import gams.transfer']);
        let done = false;
        const timer = setTimeout(() => {
            if (!done) { done = true; proc.kill(); resolve(false); }
        }, 10_000);
        proc.on('close', code => {
            if (!done) { done = true; clearTimeout(timer); resolve(code === 0); }
        });
        proc.on('error', () => {
            if (!done) { done = true; clearTimeout(timer); resolve(false); }
        });
    });
}
