import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { getPythonPath, checkGamsTransfer } from './pythonUtils';
import { getGdxWebviewContent } from './gdxWebview';

export class GdxEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'gams.gdxViewer';

    private interactiveProc: cp.ChildProcess | undefined;
    private interactiveUri: string | undefined;
    private pendingCallbacks: Map<string, (data: unknown) => void> = new Map();

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
            new vscode.RelativePattern(vscode.Uri.file(path.dirname(document.uri.fsPath)), path.basename(document.uri.fsPath))
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
                    document.uri,
                    webviewPanel,
                    msg.symbolName,
                    msg.page,
                    msg.rows
                );
            }
        });

        await this.loadIndex(document.uri, webviewPanel);
    }

    // ── Index loading ───────────────────────────────────────────────────────────

    private async loadIndex(uri: vscode.Uri, panel: vscode.WebviewPanel): Promise<void> {
        panel.webview.postMessage({ command: 'loading' });

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
            return;
        }

        const script = path.join(this.context.extensionPath, 'scripts', 'readgdx.py');
        const proc = cp.spawn(python, [script, uri.fsPath]);

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
        proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

        proc.on('close', (code) => {
            if (code !== 0) {
                panel.webview.postMessage({
                    command: 'error',
                    message: stderr || `Python process exited with code ${code}`,
                });
                return;
            }
            try {
                const index = JSON.parse(stdout.trim());
                if (index.error) {
                    panel.webview.postMessage({ command: 'error', message: index.error });
                } else {
                    panel.webview.postMessage({ command: 'initialize', data: index });
                }
            } catch {
                panel.webview.postMessage({ command: 'error', message: 'Failed to parse GDX index.' });
            }
        });
    }

    // ── Symbol data fetching (interactive process) ──────────────────────────────

    private async fetchSymbolData(
        uri: vscode.Uri,
        panel: vscode.WebviewPanel,
        symbolName: string,
        page: number,
        rows: number
    ): Promise<void> {
        const python = await getPythonPath();
        const script = path.join(this.context.extensionPath, 'scripts', 'readgdx.py');

        // (Re)start the interactive process if needed
        if (!this.interactiveProc || this.interactiveUri !== uri.fsPath) {
            this.killInteractive(this.interactiveUri);
            const proc = cp.spawn(python, [script, uri.fsPath, '--interactive']);
            this.interactiveProc = proc;
            this.interactiveUri = uri.fsPath;

            let buffer = '';
            proc.stdout.on('data', (d: Buffer) => {
                buffer += d.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';   // keep incomplete line
                for (const line of lines) {
                    if (!line.trim()) { continue; }
                    try {
                        const data = JSON.parse(line.trim());
                        // Route response to the waiting callback for this symbol
                        const cb = this.pendingCallbacks.get(data.name ?? symbolName);
                        if (cb) {
                            this.pendingCallbacks.delete(data.name ?? symbolName);
                            cb(data);
                        }
                    } catch {
                        // ignore parse errors from partial lines
                    }
                }
            });

            proc.on('close', () => {
                this.interactiveProc = undefined;
                this.interactiveUri = undefined;
            });
        }

        // Register callback then write request
        await new Promise<void>((resolve) => {
            this.pendingCallbacks.set(symbolName, (data) => {
                panel.webview.postMessage({ command: 'symbolData', data });
                resolve();
            });
            this.interactiveProc!.stdin!.write(
                JSON.stringify({ symbolName, page, rows }) + '\n'
            );
            // Timeout guard
            setTimeout(() => {
                if (this.pendingCallbacks.has(symbolName)) {
                    this.pendingCallbacks.delete(symbolName);
                    panel.webview.postMessage({
                        command: 'symbolData',
                        data: { name: symbolName, error: 'Timed out waiting for symbol data.' },
                    });
                    resolve();
                }
            }, 30_000);
        });
    }

    private killInteractive(filePath: string | undefined): void {
        if (this.interactiveProc && this.interactiveUri === filePath) {
            this.interactiveProc.kill();
            this.interactiveProc = undefined;
            this.interactiveUri = undefined;
            this.pendingCallbacks.clear();
        }
    }

    private async reload(uri: vscode.Uri, panel: vscode.WebviewPanel): Promise<void> {
        this.killInteractive(uri.fsPath);
        await this.loadIndex(uri, panel);
    }
}
