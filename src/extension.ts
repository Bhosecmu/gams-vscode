import * as vscode from 'vscode';
import { GdxEditorProvider } from './gdxviewer/gdxEditorProvider';
import { RefEditorProvider } from './gdxviewer/refEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    // Phase 1: Syntax highlighting — handled declaratively via package.json + tmLanguage

    // Phase 2a: GDX file viewer
    context.subscriptions.push(GdxEditorProvider.register(context));

    // Phase 2b: .ref file viewer
    context.subscriptions.push(RefEditorProvider.register(context));

    // Phase 3: Run button — placeholder
    // TODO: register 'gams.run' command and status bar item

    // Phase 4: Error diagnostics — placeholder
    // TODO: register log file watcher and diagnostic provider
}

export function deactivate() {}
