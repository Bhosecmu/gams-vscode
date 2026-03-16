import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * GAMS .ref (cross-reference) file viewer — three-pane layout matching GAMS Studio.
 *
 * Actual .ref file format (one reference occurrence per line):
 *   <refSeq>  <entry>  <name>  <TYPE>  <refType>  <lineFrom>  <lineTo>  <col>  <flag>  <fileIdx>  <filePath>
 *
 * Example:
 *   1 138 s SETS declared 27 27 6 0 1 C:\path\lop.gms
 */

interface SymbolEntry {
    entry: number;
    name: string;
    type: string;       // display form: Set, Parameter, Variable, …
    refCount: number;
}

interface SymbolRef {
    refType: string;    // Declared, Defined, Assigned, …
    lineFrom: number;
    lineTo: number;
    col: number;
    file: string;
}

interface ParsedRef {
    symbols: SymbolEntry[];                    // deduplicated, ordered by entry
    refs: Record<string, SymbolRef[]>;         // name → occurrences
}

// ── Parser ─────────────────────────────────────────────────────────────────────

const TYPE_DISPLAY: Record<string, string> = {
    SETS: 'Set', SET: 'Set',
    PARAMETERS: 'Parameter', PARAMETER: 'Parameter', PARAM: 'Parameter',
    VARIABLES: 'Variable', VARIABLE: 'Variable', VAR: 'Variable',
    EQUATIONS: 'Equation', EQUATION: 'Equation', EQN: 'Equation',
    MODELS: 'Model', MODEL: 'Model',
    FILES: 'File', FILE: 'File',
    ALIASES: 'Alias', ALIAS: 'Alias',
    ACRONYMS: 'Acronym', ACRONYM: 'Acronym',
    FUNCTIONS: 'Function', FUNCTION: 'Function', FUNC: 'Function',
    MACROS: 'Macro', MACRO: 'Macro',
};

const REF_TYPE_LABELS: Record<string, string> = {
    declared: 'Declared', decl: 'Declared',
    defined: 'Defined', def: 'Defined',
    assigned: 'Assigned', assn: 'Assigned',
    'impl-assn': 'Implicitly Assigned', 'implassn': 'Implicitly Assigned',
    control: 'Controlled', ctrl: 'Controlled',
    ref: 'Referenced',
    indexed: 'Indexed', idx: 'Indexed',
};

function normaliseType(raw: string): string {
    return TYPE_DISPLAY[raw.toUpperCase()] ?? raw;
}

function normaliseRefType(raw: string): string {
    return REF_TYPE_LABELS[raw.toLowerCase()] ?? raw;
}

function parseRefFile(text: string): ParsedRef {
    // entry number → SymbolEntry (for deduplication)
    const entryMap = new Map<number, SymbolEntry>();
    const refs: Record<string, SymbolRef[]> = {};

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) { continue; }

        // Split into at most 11 tokens; last token is the file path (may contain spaces)
        const parts = line.split(/\s+/);
        if (parts.length < 11) { continue; }

        // Validate: first two tokens must be integers
        if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) { continue; }

        const entry   = parseInt(parts[1], 10);
        const name    = parts[2];
        const type    = normaliseType(parts[3]);
        const refType = normaliseRefType(parts[4]);
        const lineFrom = parseInt(parts[5], 10);
        const lineTo   = parseInt(parts[6], 10);
        const col      = parseInt(parts[7], 10);
        // parts[8] = flag, parts[9] = fileIdx, parts[10..] = file path
        const filePath = parts.slice(10).join(' ');

        // Register symbol (first occurrence wins for name+type)
        if (!entryMap.has(entry)) {
            entryMap.set(entry, { entry, name, type, refCount: 0 });
        }
        entryMap.get(entry)!.refCount++;

        // Add reference
        if (!refs[name]) { refs[name] = []; }
        refs[name].push({ refType, lineFrom, lineTo, col, file: filePath });
    }

    // Sort symbols by entry number
    const symbols = [...entryMap.values()].sort((a, b) => a.entry - b.entry);
    return { symbols, refs };
}

// ── HTML builder ───────────────────────────────────────────────────────────────

const REF_TYPE_ORDER = ['Declared','Defined','Assigned','Implicitly Assigned','Controlled','Indexed','Referenced'];

function buildHtml(parsed: ParsedRef, filePath: string): string {
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;
    const title = path.basename(filePath);

    // Count per type
    const typeCounts: Record<string, number> = {};
    for (const s of parsed.symbols) {
        typeCounts[s.type] = (typeCounts[s.type] ?? 0) + 1;
    }
    const total = parsed.symbols.length;

    const TYPE_ORDER = ['Set','Parameter','Variable','Equation','Model','Alias','Acronym','Function','Macro','File'];
    const usedTypes = [...new Set([...TYPE_ORDER, ...Object.keys(typeCounts)])].filter(t => typeCounts[t]);

    const typeButtons = usedTypes.map(t =>
        `<button class="type-btn" data-type="${esc(t)}">${esc(t)} (${typeCounts[t]})</button>`
    ).join('\n');

    const symbolsJson = JSON.stringify(parsed.symbols);
    const refsJson    = JSON.stringify(parsed.refs);

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${esc(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  /* ── Left pane ── */
  #left-pane {
    width: 150px;
    min-width: 110px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--vscode-panel-border);
    overflow-y: auto;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  #all-btn-wrap {
    padding: 5px 6px;
    border-bottom: 1px solid var(--vscode-panel-border);
    font-size: 0.85em;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }
  .type-btn {
    display: block; width: 100%;
    text-align: left;
    padding: 5px 8px;
    background: transparent;
    color: var(--vscode-foreground);
    border: none;
    border-bottom: 1px solid var(--vscode-panel-border);
    cursor: pointer;
    font-size: inherit; font-family: inherit;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .type-btn:hover  { background: var(--vscode-list-hoverBackground); }
  .type-btn.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
    font-weight: 600;
  }

  /* ── Middle pane ── */
  #mid-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--vscode-panel-border);
    min-width: 0;
  }
  #mid-toolbar {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
  }
  #filter-input {
    flex: 1; padding: 3px 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    outline: none; border-radius: 2px;
    font-size: inherit; font-family: inherit;
  }
  #mid-count { color: var(--vscode-descriptionForeground); font-size: 0.88em; white-space: nowrap; }
  #mid-table-wrap { flex: 1; overflow: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9em; }
  thead th {
    position: sticky; top: 0;
    background: var(--vscode-editor-background);
    border-bottom: 2px solid var(--vscode-panel-border);
    padding: 4px 8px;
    text-align: left; white-space: nowrap;
    font-weight: 600; cursor: pointer; user-select: none;
  }
  thead th:hover { color: var(--vscode-focusBorder); }
  thead th.sorted-asc::after  { content: ' ▲'; font-size: 0.7em; }
  thead th.sorted-desc::after { content: ' ▼'; font-size: 0.7em; }
  tbody tr { cursor: pointer; }
  tbody tr:hover    { background: var(--vscode-list-hoverBackground); }
  tbody tr.selected {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  td { padding: 3px 8px; border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
       white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .col-entry { width: 55px; }
  .col-name  { width: 120px; }
  .col-type  { width: 100px; }
  .col-refs  { width: 60px; text-align: right; }

  /* ── Right pane ── */
  #right-pane {
    width: 300px; min-width: 180px;
    flex-shrink: 0;
    display: flex; flex-direction: column;
    overflow: hidden;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  #right-header {
    padding: 6px 10px;
    font-weight: 700; font-size: 1em;
    border-bottom: 1px solid var(--vscode-panel-border);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #right-content { flex: 1; overflow-y: auto; }
  #right-empty {
    padding: 20px 10px;
    color: var(--vscode-descriptionForeground);
    font-style: italic; font-size: 0.9em;
  }
  .ref-group-header {
    display: flex; align-items: center; gap: 5px;
    padding: 4px 10px;
    cursor: pointer; user-select: none;
    font-size: 0.9em;
  }
  .ref-group-header:hover { background: var(--vscode-list-hoverBackground); }
  .ref-arrow { font-size: 9px; display: inline-block; transition: transform 0.1s; }
  .ref-arrow.open { transform: rotate(90deg); }
  .ref-group-body { display: none; }
  .ref-group-body.open { display: block; }
  .ref-col-head {
    display: grid; grid-template-columns: 1fr 52px 52px;
    padding: 2px 10px 2px 24px;
    font-size: 0.82em;
    color: var(--vscode-descriptionForeground);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .ref-row {
    display: grid; grid-template-columns: 1fr 52px 52px;
    padding: 2px 10px 2px 24px;
    font-size: 0.85em; cursor: default;
  }
  .ref-row:hover { background: var(--vscode-list-hoverBackground); }
  .ref-file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ref-num  { text-align: right; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>

<div id="left-pane">
  <div id="all-btn-wrap">
    <button class="type-btn active" data-type="" style="border:none;padding:3px 0;font-weight:700;font-size:1em">
      All Symbols (${total})
    </button>
  </div>
  ${typeButtons}
</div>

<div id="mid-pane">
  <div id="mid-toolbar">
    <input id="filter-input" type="text" placeholder="Filter…" autocomplete="off">
    <span id="mid-count"></span>
  </div>
  <div id="mid-table-wrap">
    <table>
      <thead><tr>
        <th class="col-entry" data-col="entry">Entry</th>
        <th class="col-name"  data-col="name">Name</th>
        <th class="col-type"  data-col="type">Type</th>
        <th class="col-refs"  data-col="refCount" style="text-align:right">Refs</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
</div>

<div id="right-pane">
  <div id="right-header">—</div>
  <div id="right-content">
    <div id="right-empty">Select a symbol to view references.</div>
  </div>
</div>

<script>
(function () {
  const SYMBOLS = ${symbolsJson};
  const REFS    = ${refsJson};
  const REF_ORDER = ${JSON.stringify(REF_TYPE_ORDER)};

  let activeType   = '';
  let filterText   = '';
  let selectedName = null;
  let sortCol      = 'entry';
  let sortDir      = 1;

  const tbody     = document.getElementById('tbody');
  const midCount  = document.getElementById('mid-count');
  const filterEl  = document.getElementById('filter-input');
  const rightHdr  = document.getElementById('right-header');
  const rightCont = document.getElementById('right-content');

  // Type buttons
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeType = btn.dataset.type;
      renderTable();
    });
  });

  // Filter
  filterEl.addEventListener('input', () => {
    filterText = filterEl.value.trim().toLowerCase();
    renderTable();
  });

  // Column sort
  document.querySelectorAll('thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      sortDir = (sortCol === col) ? -sortDir : 1;
      sortCol = col;
      document.querySelectorAll('thead th').forEach(h => h.classList.remove('sorted-asc','sorted-desc'));
      th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
      renderTable();
    });
  });

  function renderTable() {
    let rows = SYMBOLS.filter(s =>
      (!activeType || s.type === activeType) &&
      (!filterText || s.name.toLowerCase().includes(filterText))
    );
    rows.sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (typeof av === 'number') return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });

    midCount.textContent = rows.length + ' / ' + SYMBOLS.length + ' symbols';

    tbody.innerHTML = rows.map(s => {
      const sel = s.name === selectedName ? ' class="selected"' : '';
      return \`<tr\${sel} data-name="\${esc(s.name)}">
        <td class="col-entry">\${s.entry}</td>
        <td class="col-name" title="\${esc(s.name)}">\${esc(s.name)}</td>
        <td class="col-type">\${esc(s.type)}</td>
        <td class="col-refs" style="text-align:right">\${s.refCount}</td>
      </tr>\`;
    }).join('');

    tbody.querySelectorAll('tr').forEach(tr =>
      tr.addEventListener('click', () => selectSymbol(tr.dataset.name))
    );
  }

  function selectSymbol(name) {
    selectedName = name;
    renderTable();

    rightHdr.textContent = name;
    const allRefs = REFS[name] ?? [];

    if (allRefs.length === 0) {
      rightCont.innerHTML = '<div id="right-empty">No references found.</div>';
      return;
    }

    // Group by refType
    const groups = {};
    for (const r of allRefs) {
      if (!groups[r.refType]) groups[r.refType] = [];
      groups[r.refType].push(r);
    }

    const keys = Object.keys(groups).sort((a, b) => {
      const ia = REF_ORDER.indexOf(a), ib = REF_ORDER.indexOf(b);
      if (ia < 0 && ib < 0) return a.localeCompare(b);
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    });

    rightCont.innerHTML = keys.map(rt => {
      const items = groups[rt];
      const autoOpen = items.length <= 20;
      const rows = items.map(r => {
        const fname = r.file.split(/[\\\\/]/).pop() ?? r.file;
        return \`<div class="ref-row" title="\${esc(r.file)}">
          <span class="ref-file">\${esc(fname)}</span>
          <span class="ref-num">\${r.lineFrom}</span>
          <span class="ref-num">\${r.col}</span>
        </div>\`;
      }).join('');

      return \`<div class="ref-group">
        <div class="ref-group-header">
          <span class="ref-arrow\${autoOpen ? ' open' : ''}">▶</span>
          <span>(\${items.length}) \${esc(rt)}</span>
        </div>
        <div class="ref-col-head">
          <span>Location</span>
          <span style="text-align:right">Line</span>
          <span style="text-align:right">Col</span>
        </div>
        <div class="ref-group-body\${autoOpen ? ' open' : ''}">\${rows}</div>
      </div>\`;
    }).join('');

    rightCont.querySelectorAll('.ref-group-header').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const body  = hdr.nextElementSibling.nextElementSibling;
        const arrow = hdr.querySelector('.ref-arrow');
        body.classList.toggle('open');
        arrow.classList.toggle('open');
      });
    });
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  renderTable();
})();
</script>
</body>
</html>`;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function errorHtml(msg: string): string {
    return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:20px;color:var(--vscode-errorForeground)">
<b>Error reading .ref file:</b><pre>${esc(msg)}</pre></body></html>`;
}

// ── Provider ───────────────────────────────────────────────────────────────────

export class RefEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'gams.refViewer';

    static register(_context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            RefEditorProvider.viewType,
            new RefEditorProvider(),
            { supportsMultipleEditorsPerDocument: false }
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

        const render = () => {
            try {
                const text = fs.readFileSync(document.uri.fsPath, 'utf8');
                const parsed = parseRefFile(text);
                webviewPanel.webview.html = buildHtml(parsed, document.uri.fsPath);
            } catch (err) {
                webviewPanel.webview.html = errorHtml(String(err));
            }
        };

        render();

        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(
                vscode.Uri.file(path.dirname(document.uri.fsPath)),
                path.basename(document.uri.fsPath)
            )
        );
        watcher.onDidChange(render);
        webviewPanel.onDidDispose(() => watcher.dispose());
    }
}
