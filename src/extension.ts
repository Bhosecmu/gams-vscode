import * as vscode from 'vscode';
import { GdxEditorProvider } from './gdxviewer/gdxEditorProvider';
import { RefEditorProvider } from './gdxviewer/refEditorProvider';
import { GamsRunner, RunResult } from './runner/gamsRunner';
import { GamsStatusBarItem } from './runner/statusBarItem';
import { pickArgs, getLastArgs, saveLastArgs } from './runner/argsManager';
import { GamsDiagnosticsProvider } from './diagnostics/gamsDiagnostics';

export function activate(context: vscode.ExtensionContext) {

    // ── Phase 1: Syntax highlighting (declarative — no runtime code needed) ──

    // ── Phase 2: GDX + REF file viewers ──────────────────────────────────────
    context.subscriptions.push(GdxEditorProvider.register(context));
    context.subscriptions.push(RefEditorProvider.register(context));

    // ── Phase 3: Run button ───────────────────────────────────────────────────
    const outputChannel = vscode.window.createOutputChannel('GAMS');
    const statusBar     = new GamsStatusBarItem();
    const diagnostics   = new GamsDiagnosticsProvider();
    const runner        = new GamsRunner(outputChannel, (state, result?: RunResult) => {
        statusBar.setState(state, result?.exitCode);
        if (result) {
            const editor = vscode.window.activeTextEditor;
            const gmsPath = editor?.document.uri.fsPath ?? '';
            if (gmsPath) {
                diagnostics.update(gmsPath, result.lstFile, result.logFile);
            }
        }
    });

    context.subscriptions.push(outputChannel, statusBar, diagnostics, runner);

    // Show/hide status bar based on active editor
    const updateStatusBarVisibility = (editor?: vscode.TextEditor) => {
        if (editor?.document.languageId === 'gams') {
            statusBar.show();
        } else if (!runner.isRunning) {
            statusBar.hide();
        }
    };
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(updateStatusBarVisibility)
    );
    updateStatusBarVisibility(vscode.window.activeTextEditor);

    // ── Helper: save file + run with given args ───────────────────────────────
    async function runWith(uri: vscode.Uri, args: string) {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
        if (doc?.isDirty) { await doc.save(); }
        saveLastArgs(context.workspaceState, uri.toString(), args);
        await runner.run(uri, args);
    }

    // ── gams.run — run with last-used args (no prompt) ────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('gams.run', async () => {
            if (runner.isRunning) { return; }
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'gams') {
                vscode.window.showWarningMessage('Open a .gms file to run GAMS.');
                return;
            }
            const uri  = editor.document.uri;
            const args = getLastArgs(context.workspaceState, uri.toString());
            await runWith(uri, args);
        })
    );

    // ── gams.runWithArgs — always show argument picker first ──────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('gams.runWithArgs', async () => {
            if (runner.isRunning) { return; }
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'gams') {
                vscode.window.showWarningMessage('Open a .gms file to run GAMS.');
                return;
            }
            const uri  = editor.document.uri;
            const args = await pickArgs(context.workspaceState, uri.toString());
            if (args === undefined) { return; }   // user cancelled
            await runWith(uri, args);
        })
    );

    // ── gams.stop — kill running process ─────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('gams.stop', () => {
            runner.stop();
            statusBar.setState('idle');
        })
    );

    // Clear diagnostics when a GAMS file is saved (will be re-populated on next run)
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.languageId === 'gams') {
                diagnostics.clear();
            }
        })
    );
}

export function deactivate() {}
