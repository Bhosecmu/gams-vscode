import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ArgPreset {
    name: string;
    args: string;
    description?: string;
}

const LAUNCH_FILE = '.vscode/gams-launch.json';
const STATE_KEY   = 'gams.lastArgs';

// ── Preset file ────────────────────────────────────────────────────────────────

function launchFilePath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) { return undefined; }
    return path.join(folders[0].uri.fsPath, LAUNCH_FILE);
}

function loadPresets(): ArgPreset[] {
    const file = launchFilePath();
    if (!file || !fs.existsSync(file)) { return []; }
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(raw)) { return raw as ArgPreset[]; }
    } catch { /* malformed — ignore */ }
    return [];
}

export async function createLaunchFileIfMissing(): Promise<void> {
    const file = launchFilePath();
    if (!file || fs.existsSync(file)) { return; }

    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }

    const template: ArgPreset[] = [
        { name: 'Default',               args: '',                description: 'Run with no extra arguments' },
        { name: 'CPLEX (LP)',             args: 'lp=cplex',        description: 'Use CPLEX for LP models' },
        { name: 'CPLEX (MIP)',            args: 'mip=cplex',       description: 'Use CPLEX for MIP models' },
        { name: 'IPOPT (NLP)',            args: 'nlp=ipopt',       description: 'Use IPOPT for NLP models' },
        { name: 'Compile only',           args: 'action=c',        description: 'Syntax check without running' },
        { name: 'Suppress listing',       args: 'o=nul lo=2',      description: 'Minimal output (Windows)' },
    ];
    fs.writeFileSync(file, JSON.stringify(template, null, 2) + '\n', 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    vscode.window.showTextDocument(doc);
}

// ── Last-used args (persisted in workspace state) ──────────────────────────────

export function getLastArgs(state: vscode.Memento, fileUri: string): string {
    const map: Record<string, string> = state.get(STATE_KEY, {});
    return map[fileUri] ?? map['__global__'] ?? '';
}

export function saveLastArgs(state: vscode.Memento, fileUri: string, args: string): void {
    const map: Record<string, string> = state.get(STATE_KEY, {});
    map[fileUri]     = args;
    map['__global__'] = args;
    state.update(STATE_KEY, map);
}

// ── Quick Pick UI ──────────────────────────────────────────────────────────────

export async function pickArgs(
    state: vscode.Memento,
    fileUri: string
): Promise<string | undefined> {
    const presets  = loadPresets();
    const lastArgs = getLastArgs(state, fileUri);
    const hasLast  = lastArgs !== '';

    type Item = vscode.QuickPickItem & { args?: string; action?: 'custom' | 'create' };

    const items: Item[] = [];

    // Last-used at top
    if (hasLast) {
        items.push({
            label:       `$(history) ${lastArgs}`,
            description: 'last used',
            args:        lastArgs,
        });
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }

    // Run with no args
    items.push({
        label:       '$(play) Run without arguments',
        description: '',
        args:        '',
    });

    // Custom free-text
    items.push({
        label:       '$(edit) Enter custom arguments…',
        description: 'type on the next prompt',
        action:      'custom',
    });

    // Presets
    if (presets.length) {
        items.push({ label: 'Presets', kind: vscode.QuickPickItemKind.Separator });
        for (const p of presets) {
            if (p.args === '' && !hasLast) { continue; } // skip blank Default if nothing saved
            items.push({
                label:       `$(symbol-constant) ${p.name}`,
                description: p.args || '(no args)',
                detail:      p.description,
                args:        p.args,
            });
        }
    }

    // Create launch file shortcut
    if (!launchFilePath() || !fs.existsSync(launchFilePath()!)) {
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({
            label:  '$(gear) Create gams-launch.json…',
            detail: 'Save argument presets for this workspace',
            action: 'create',
        });
    }

    const picked = await vscode.window.showQuickPick(items, {
        title:       'GAMS Run Arguments',
        placeHolder: 'Choose a preset or enter custom arguments',
        matchOnDescription: true,
        matchOnDetail:      true,
    });

    if (!picked) { return undefined; }   // cancelled

    if (picked.action === 'create') {
        await createLaunchFileIfMissing();
        return undefined;   // don't run after opening file
    }

    if (picked.action === 'custom') {
        const input = await vscode.window.showInputBox({
            title:       'GAMS custom arguments',
            prompt:      'e.g.  lp=cplex  or  nlp=ipopt threads=4',
            value:       lastArgs,
            placeHolder: 'key=value key=value …',
        });
        if (input === undefined) { return undefined; }  // cancelled
        return input.trim();
    }

    return picked.args ?? '';
}
