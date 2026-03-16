import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export type RunState = 'idle' | 'running' | 'success' | 'error';

export interface RunResult {
    exitCode: number;
    logFile: string;   // path to the .log file written by GAMS
    lstFile: string;   // path to the .lst file
}

const EXIT_MESSAGES: Record<number, string> = {
    0:  'Completed successfully',
    2:  'Compilation error',
    3:  'Execution error',
    4:  'System limits exceeded',
    5:  'File error',
    6:  'Parameter error',
    7:  'Licensing error',
    8:  'System error',
    9:  'Could not start GAMS',
    10: 'Out of memory',
    11: 'Out of disk space',
};

export function exitMessage(code: number): string {
    return EXIT_MESSAGES[code] ?? `Exit code ${code}`;
}

// ── Executable location ─────────────────────────────────────────────────────

export async function findGamsExecutable(): Promise<string | null> {
    // 1. User setting
    const cfg = vscode.workspace.getConfiguration('gams');
    const setting: string = cfg.get('executablePath', '').trim();
    if (setting && fs.existsSync(setting)) { return setting; }

    // 2. PATH
    if (await probeExecutable('gams')) { return 'gams'; }

    // 3. Common Windows install paths: C:\GAMS\<ver>\gams.exe
    if (process.platform === 'win32') {
        for (const base of ['C:\\GAMS', 'C:\\Program Files\\GAMS']) {
            if (!fs.existsSync(base)) { continue; }
            const versions = fs.readdirSync(base)
                .filter(d => /^\d/.test(d))
                .sort((a, b) => parseFloat(b) - parseFloat(a));   // newest first
            for (const v of versions) {
                const exe = path.join(base, v, 'gams.exe');
                if (fs.existsSync(exe)) { return exe; }
            }
        }
    }

    return null;
}

function probeExecutable(cmd: string): Promise<boolean> {
    return new Promise(resolve => {
        const proc = cp.spawn(cmd, ['?'], { shell: false });
        proc.on('error', () => resolve(false));
        proc.on('close', () => resolve(true));
    });
}

// ── Runner ──────────────────────────────────────────────────────────────────

export class GamsRunner {
    private currentProc: cp.ChildProcess | undefined;
    private readonly channel: vscode.OutputChannel;
    private onStateChange: (state: RunState, result?: RunResult) => void;

    constructor(
        channel: vscode.OutputChannel,
        onStateChange: (state: RunState, result?: RunResult) => void
    ) {
        this.channel = channel;
        this.onStateChange = onStateChange;
    }

    get isRunning(): boolean { return !!this.currentProc; }

    async run(uri: vscode.Uri): Promise<void> {
        if (this.currentProc) { return; }   // already running

        const gamsExe = await findGamsExecutable();
        if (!gamsExe) {
            vscode.window.showErrorMessage(
                'GAMS executable not found. Set the path in Settings → gams.executablePath.'
            );
            return;
        }

        const filePath = uri.fsPath;
        const fileDir  = path.dirname(filePath);
        const baseName = path.basename(filePath, path.extname(filePath));
        const logFile  = path.join(fileDir, baseName + '.log');
        const lstFile  = path.join(fileDir, baseName + '.lst');

        // Build args: lo=3 streams log to stdout; lf writes a .log file too
        const args = [
            filePath,
            'lo=3',                          // stream log to stdout
            `lf=${logFile}`,                  // also write .log file
            `curDir=${fileDir}`,              // working directory = file's directory
        ];

        this.channel.clear();
        this.channel.show(true);
        this.channel.appendLine(`GAMS: ${gamsExe}`);
        this.channel.appendLine(`File: ${filePath}`);
        this.channel.appendLine('─'.repeat(60));

        this.onStateChange('running');

        const proc = cp.spawn(gamsExe, args, { cwd: fileDir });
        this.currentProc = proc;

        proc.stdout.on('data', (d: Buffer) => {
            this.channel.append(d.toString());
        });
        proc.stderr.on('data', (d: Buffer) => {
            this.channel.append(d.toString());
        });

        proc.on('error', (err) => {
            this.channel.appendLine(`\nFailed to start GAMS: ${err.message}`);
            this.currentProc = undefined;
            this.onStateChange('error');
        });

        proc.on('close', (code) => {
            this.currentProc = undefined;
            const exitCode = code ?? 1;
            this.channel.appendLine('\n' + '─'.repeat(60));
            this.channel.appendLine(`Exit: ${exitCode} — ${exitMessage(exitCode)}`);
            const result: RunResult = { exitCode, logFile, lstFile };
            this.onStateChange(exitCode === 0 ? 'success' : 'error', result);
        });
    }

    stop(): void {
        if (this.currentProc) {
            this.currentProc.kill();
            this.currentProc = undefined;
            this.channel.appendLine('\n[Run cancelled by user]');
            this.onStateChange('idle');
        }
    }

    dispose(): void { this.stop(); }
}
