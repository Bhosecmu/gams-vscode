import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { getPythonPath, checkGamsTransfer } from './pythonUtils';
import { getGdxWebviewContent } from './gdxWebview';

export class GdxEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'gams.gdxViewer';

    /** One persistent Python process per open GDX file. */
    private interactiveProc: cp.ChildProcess | undefined;
    private interactiveUri: string | undefined;

    /**
     * Pending response callbacks keyed by symbol name, or '__index__' for the
     * index request.
     */
    private pendingCallbacks: Map<string, (data: unknown) => void> = new Map();
    private lastRequestedSymbol: string | undefined;

    constructor(private readonly context: vscode.ExtensionContext) {}

    static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            GdxEditorProvider.viewType,
            new GdxEditorProvider(context),
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false,
            }
        );
    }

    openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = getGdxWebviewContent(webviewPanel.webview);

        // Watch for file changes
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(
                vscode.Uri.file(path.dirname(document.uri.fsPath)),
                path.basename(document.uri.fsPath)
            )
        );
        watcher.onDidChange(() => this.reload(document.uri, webviewPanel));
        webviewPanel.onDidDispose(() => {
            watcher.dispose();
            this.killInteractive(document.uri.fsPath);
        });

        // Handle webview → extension messages
        webviewPanel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'getSymbol') {
                await this.fetchSymbolData(
                    document.uri, webviewPanel,
                    msg.symbolName, msg.page, msg.rows
                );
            }
        });

        await this.loadIndex(document.uri, webviewPanel);
    }

    // ── Single process management ───────────────────────────────────────────────

    /**
     * Ensure the interactive Python process is running for this GDX file.
     * Returns the process, or null if it could not be started.
     */
    private async ensureProcess(
        uri: vscode.Uri,
        panel: vscode.WebviewPanel
    ): Promise<cp.ChildProcess | null> {
        if (this.interactiveProc && this.interactiveUri === uri.fsPath) {
            return this.interactiveProc;
        }

        this.killInteractive(this.interactiveUri);

        const python = await getPythonPath();
        const ok = await checkGamsTransfer(python);
        if (!ok) {
            panel.webview.postMessage({
                command: 'error',
                message:
                    "Python package 'gams-transfer' not found.\n" +
                    "Install it with:  pip install gams-transfer\n" +
                    "Then reload the file.",
            });
            return null;
        }

        const script = path.join(this.context.extensionPath, 'scripts', 'readgdx.py');
        const proc   = cp.spawn(python, [script, uri.fsPath]);
        this.interactiveProc = proc;
        this.interactiveUri  = uri.fsPath;

        // Route stdout lines to waiting callbacks
        let buffer = '';
        proc.stdout.on('data', (d: Buffer) => {
            buffer += d.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) { continue; }
                try {
                    const data = JSON.parse(line) as Record<string, unknown>;
                    const key  = data['command'] === 'index'
                        ? '__index__'
                        : (data['name'] as string | undefined) ?? this.lastRequestedSymbol ?? '';
                    const cb = this.pendingCallbacks.get(key);
                    if (cb) { this.pendingCallbacks.delete(key); cb(data); }
                } catch {
                    // ignore malformed / partial lines
                }
            }
        });

        let stderrBuf = '';
        proc.stderr.on('data', (d: Buffer) => { stderrBuf += d.toString(); });

        proc.on('error', (err) => {
            const errorMsg = `Failed to start Python: ${err.message}`;
            for (const [key, cb] of this.pendingCallbacks) {
                this.pendingCallbacks.delete(key);
                cb(key === '__index__'
                    ? { command: 'index', error: errorMsg }
                    : { name: key, error: errorMsg });
            }
        });

        proc.on('close', (code) => {
            // Resolve every pending callback with an error so no request hangs forever
            const errorMsg = stderrBuf || `Python process exited with code ${code}`;
            for (const [key, cb] of this.pendingCallbacks) {
                this.pendingCallbacks.delete(key);
                cb(key === '__index__'
                    ? { command: 'index', error: errorMsg }
                    : { name: key, error: errorMsg });
            }
            this.interactiveProc = undefined;
            this.interactiveUri  = undefined;
        });

        return proc;
    }

    // ── Index loading ───────────────────────────────────────────────────────────

    private async loadIndex(uri: vscode.Uri, panel: vscode.WebviewPanel): Promise<void> {
        panel.webview.postMessage({ command: 'loading' });

        const proc = await this.ensureProcess(uri, panel);
        if (!proc) { return; }

        await new Promise<void>((resolve) => {
            this.pendingCallbacks.set('__index__', (data: unknown) => {
                const d = data as Record<string, unknown>;
                if (d['error']) {
                    panel.webview.postMessage({ command: 'error', message: d['error'] });
                } else {
                    panel.webview.postMessage({ command: 'initialize', data: d['data'] });
                }
                resolve();
            });

            proc.stdin!.write(JSON.stringify({ command: 'index' }) + '\n');

            // Large GDX files can take a long time to load — allow 3 minutes
            setTimeout(() => {
                if (this.pendingCallbacks.has('__index__')) {
                    this.pendingCallbacks.delete('__index__');
                    panel.webview.postMessage({
                        command: 'error',
                        message: 'Timed out loading GDX index. The file may be too large or gams-transfer may be unavailable.',
                    });
                    resolve();
                }
            }, 180_000);
        });
    }

    // ── Symbol data fetching ────────────────────────────────────────────────────

    private async fetchSymbolData(
        uri: vscode.Uri,
        panel: vscode.WebviewPanel,
        symbolName: string,
        page: number,
        rows: number
    ): Promise<void> {
        // The process should already be running (started by loadIndex).
        // If it died, surface a friendly error rather than re-loading the whole file.
        const proc = this.interactiveProc;
        if (!proc || this.interactiveUri !== uri.fsPath) {
            panel.webview.postMessage({
                command: 'symbolData',
                data: { name: symbolName, error: 'GDX process is not running. Close and reopen the file.' },
            });
            return;
        }

        this.lastRequestedSymbol = symbolName;

        await new Promise<void>((resolve) => {
            this.pendingCallbacks.set(symbolName, (data) => {
                panel.webview.postMessage({ command: 'symbolData', data });
                resolve();
            });

            proc.stdin!.write(
                JSON.stringify({ command: 'symbolData', symbolName, page, rows }) + '\n'
            );

            setTimeout(() => {
                if (this.pendingCallbacks.has(symbolName)) {
                    this.pendingCallbacks.delete(symbolName);
                    panel.webview.postMessage({
                        command: 'symbolData',
                        data: { name: symbolName, error: 'Timed out waiting for symbol data.' },
                    });
                    resolve();
                }
            }, 60_000);
        });
    }

    private killInteractive(filePath: string | undefined): void {
        if (this.interactiveProc && this.interactiveUri === filePath) {
            this.interactiveProc.kill();
            this.interactiveProc = undefined;
            this.interactiveUri  = undefined;
            this.pendingCallbacks.clear();
        }
    }

    private async reload(uri: vscode.Uri, panel: vscode.WebviewPanel): Promise<void> {
        this.killInteractive(uri.fsPath);
        await this.loadIndex(uri, panel);
    }
}
