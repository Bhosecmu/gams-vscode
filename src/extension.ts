import * as vscode from 'vscode';
import { GdxEditorProvider } from './gdxviewer/gdxEditorProvider';
import { RefEditorProvider } from './gdxviewer/refEditorProvider';
import { GamsRunner, RunResult } from './runner/gamsRunner';
import { GamsStatusBarItem } from './runner/statusBarItem';

export function activate(context: vscode.ExtensionContext) {

    // ── Phase 1: Syntax highlighting (declarative — no runtime code needed) ──

    // ── Phase 2: GDX + REF file viewers ──────────────────────────────────────
    context.subscriptions.push(GdxEditorProvider.register(context));
    context.subscriptions.push(RefEditorProvider.register(context));

    // ── Phase 3: Run button ───────────────────────────────────────────────────
    const outputChannel = vscode.window.createOutputChannel('GAMS');
    const statusBar     = new GamsStatusBarItem();
    const runner        = new GamsRunner(outputChannel, (state, result?: RunResult) => {
        statusBar.setState(state, result?.exitCode);
        // Phase 4 hook: pass result to diagnostics when ready
    });

    context.subscriptions.push(outputChannel, statusBar, runner);

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

    // gams.run — run the active GAMS file
    context.subscriptions.push(
        vscode.commands.registerCommand('gams.run', async () => {
            if (runner.isRunning) { return; }

            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'gams') {
                vscode.window.showWarningMessage('Open a .gms file to run GAMS.');
                return;
            }

            // Save the file before running
            if (editor.document.isDirty) {
                await editor.document.save();
            }

            await runner.run(editor.document.uri);
        })
    );

    // gams.stop — kill the running process
    context.subscriptions.push(
        vscode.commands.registerCommand('gams.stop', () => {
            runner.stop();
            statusBar.setState('idle');
        })
    );

    // ── Phase 4: Error diagnostics — placeholder ──────────────────────────────
    // TODO: parse log/lst, surface diagnostics, suggest fixes
}

export function deactivate() {}
