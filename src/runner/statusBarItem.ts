import * as vscode from 'vscode';
import { RunState, exitMessage } from './gamsRunner';

export class GamsStatusBarItem {
    private readonly item: vscode.StatusBarItem;
    private resetTimer: ReturnType<typeof setTimeout> | undefined;

    constructor() {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.item.command = 'gams.run';
        this.setState('idle');
    }

    setState(state: RunState, exitCode?: number): void {
        if (this.resetTimer) {
            clearTimeout(this.resetTimer);
            this.resetTimer = undefined;
        }

        switch (state) {
            case 'idle':
                this.item.text        = '$(play) Run GAMS';
                this.item.tooltip     = 'Run current GAMS file (Ctrl+F5)';
                this.item.color       = undefined;
                this.item.command     = 'gams.run';
                break;

            case 'running':
                this.item.text        = '$(loading~spin) Running GAMS…';
                this.item.tooltip     = 'Click to stop';
                this.item.color       = new vscode.ThemeColor('statusBarItem.warningForeground');
                this.item.command     = 'gams.stop';
                break;

            case 'success':
                this.item.text        = '$(check) GAMS: Done';
                this.item.tooltip     = 'Completed successfully — click to run again';
                this.item.color       = new vscode.ThemeColor('charts.green');
                this.item.command     = 'gams.run';
                this.resetTimer = setTimeout(() => this.setState('idle'), 6000);
                break;

            case 'error':
                const msg = exitCode !== undefined ? exitMessage(exitCode) : 'Error';
                this.item.text        = `$(error) GAMS: ${msg}`;
                this.item.tooltip     = `${msg} — click to run again`;
                this.item.color       = new vscode.ThemeColor('statusBarItem.errorForeground');
                this.item.command     = 'gams.run';
                this.resetTimer = setTimeout(() => this.setState('idle'), 8000);
                break;
        }
    }

    show(): void  { this.item.show(); }
    hide(): void  { this.item.hide(); }

    dispose(): void {
        if (this.resetTimer) { clearTimeout(this.resetTimer); }
        this.item.dispose();
    }
}
