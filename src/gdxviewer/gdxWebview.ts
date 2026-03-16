import * as vscode from 'vscode';

/** Generate the standalone HTML page for the GDX viewer webview. */
export function getGdxWebviewContent(_webview: vscode.Webview): string {
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';`;
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GDX Viewer</title>
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

  /* ── Sidebar ── */
  #sidebar {
    width: 220px;
    min-width: 140px;
    max-width: 400px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    border-right: 1px solid var(--vscode-panel-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  }
  #search-wrap { padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  #search {
    width: 100%;
    padding: 4px 6px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    outline: none;
    border-radius: 2px;
    font-size: inherit;
  }
  #symbol-tree { flex: 1; overflow-y: auto; }
  .category-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 8px;
    cursor: pointer;
    user-select: none;
    font-weight: 600;
    color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
    background: var(--vscode-sideBarSectionHeader-background, transparent);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .category-header:hover { background: var(--vscode-list-hoverBackground); }
  .category-arrow { font-size: 10px; transition: transform 0.15s; }
  .category-arrow.open { transform: rotate(90deg); }
  .symbol-list { display: none; }
  .symbol-list.open { display: block; }
  .symbol-item {
    padding: 3px 8px 3px 22px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .symbol-item:hover { background: var(--vscode-list-hoverBackground); }
  .symbol-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  /* ── Resizer ── */
  #resizer {
    width: 4px;
    cursor: col-resize;
    background: transparent;
    flex-shrink: 0;
  }
  #resizer:hover { background: var(--vscode-focusBorder); }

  /* ── Main content ── */
  #main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  #header {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  #sym-name { font-weight: 700; font-size: 1.05em; }
  #sym-desc { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.95em; }
  #sym-total { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 0.9em; }

  #table-wrap { flex: 1; overflow: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 0.92em; }
  thead th {
    position: sticky;
    top: 0;
    background: var(--vscode-editor-background);
    border-bottom: 2px solid var(--vscode-panel-border);
    padding: 5px 10px;
    text-align: left;
    white-space: nowrap;
    font-weight: 600;
  }
  tbody tr:hover { background: var(--vscode-list-hoverBackground); }
  td { padding: 3px 10px; border-bottom: 1px solid var(--vscode-panel-border, #333); white-space: nowrap; }

  /* ── Pagination ── */
  #pagination {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-top: 1px solid var(--vscode-panel-border);
    flex-wrap: wrap;
  }
  #pagination button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 3px 9px;
    cursor: pointer;
    border-radius: 2px;
    font-size: inherit;
  }
  #pagination button:disabled { opacity: 0.4; cursor: default; }
  #pagination button:not(:disabled):hover { background: var(--vscode-button-hoverBackground); }
  #page-info { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  #rows-select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, transparent);
    padding: 2px 4px;
    font-size: inherit;
    border-radius: 2px;
  }

  /* ── Status / Loading ── */
  #status {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-descriptionForeground);
    font-size: 1.1em;
    padding: 32px;
  }
  .spinner {
    display: inline-block;
    width: 18px; height: 18px;
    border: 2px solid var(--vscode-panel-border);
    border-top-color: var(--vscode-focusBorder);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-right: 8px;
    vertical-align: middle;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error { color: var(--vscode-errorForeground); }
</style>
</head>
<body>

<div id="sidebar">
  <div id="search-wrap">
    <input id="search" type="text" placeholder="Search symbols…" autocomplete="off">
  </div>
  <div id="symbol-tree"></div>
</div>

<div id="resizer"></div>

<div id="main">
  <div id="header" style="display:none">
    <span id="sym-name"></span>
    <span id="sym-desc"></span>
    <span id="sym-total"></span>
  </div>
  <div id="table-wrap">
    <div id="status"><span class="spinner"></span> Loading GDX file…</div>
  </div>
  <div id="pagination" style="display:none">
    <button id="btn-first">«</button>
    <button id="btn-prev">‹</button>
    <span id="page-info"></span>
    <button id="btn-next">›</button>
    <button id="btn-last">»</button>
    <span style="margin-left:8px">Rows:</span>
    <select id="rows-select">
      <option value="50">50</option>
      <option value="100" selected>100</option>
      <option value="200">200</option>
      <option value="500">500</option>
    </select>
  </div>
</div>

<script>
(function() {
  const vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────────────────
  let symbolIndex = {};   // { Sets: [{name,description},...], Parameters: [...], ... }
  let selectedSymbol = null;
  let currentPage = 1;
  let totalRecords = 0;
  let rows = 100;
  let pendingResolve = null;

  // ── Elements ───────────────────────────────────────────────
  const searchEl     = document.getElementById('search');
  const treeEl       = document.getElementById('symbol-tree');
  const statusEl     = document.getElementById('status');
  const tableWrapEl  = document.getElementById('table-wrap');
  const headerEl     = document.getElementById('header');
  const paginationEl = document.getElementById('pagination');
  const symNameEl    = document.getElementById('sym-name');
  const symDescEl    = document.getElementById('sym-desc');
  const symTotalEl   = document.getElementById('sym-total');
  const pageInfoEl   = document.getElementById('page-info');
  const rowsSelect   = document.getElementById('rows-select');

  // ── Sidebar resize ─────────────────────────────────────────
  const resizer = document.getElementById('resizer');
  const sidebar = document.getElementById('sidebar');
  let isResizing = false;
  resizer.addEventListener('mousedown', e => { isResizing = true; e.preventDefault(); });
  document.addEventListener('mousemove', e => {
    if (!isResizing) return;
    const w = Math.min(400, Math.max(140, e.clientX));
    sidebar.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => { isResizing = false; });

  // ── Message handler ────────────────────────────────────────
  window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.command) {
      case 'initialize':
        symbolIndex = msg.data;
        renderTree('');
        setStatus(null);
        break;
      case 'symbolData':
        if (pendingResolve) { pendingResolve(msg.data); pendingResolve = null; }
        break;
      case 'loading':
        setStatus('<span class="spinner"></span> Loading GDX file…');
        break;
      case 'error':
        setStatus('<span class="error">⚠ ' + escHtml(msg.message) + '</span>');
        break;
    }
  });

  // ── Tree rendering ─────────────────────────────────────────
  function renderTree(filter) {
    treeEl.innerHTML = '';
    const q = filter.trim().toLowerCase();

    for (const [cat, symbols] of Object.entries(symbolIndex)) {
      const visible = symbols.filter(s =>
        !q || s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)
      );
      if (visible.length === 0) continue;

      const header = document.createElement('div');
      header.className = 'category-header';
      const arrow = document.createElement('span');
      arrow.className = 'category-arrow open';
      arrow.textContent = '▶';
      header.appendChild(arrow);
      header.appendChild(document.createTextNode(cat + ' (' + visible.length + ')'));

      const list = document.createElement('div');
      list.className = 'symbol-list open';

      header.addEventListener('click', () => {
        const open = list.classList.toggle('open');
        arrow.classList.toggle('open', open);
      });

      for (const sym of visible) {
        const item = document.createElement('div');
        item.className = 'symbol-item' + (selectedSymbol === sym.name ? ' active' : '');
        item.title = sym.description || sym.name;
        item.textContent = sym.name;
        item.addEventListener('click', () => selectSymbol(sym.name));
        list.appendChild(item);
      }

      treeEl.appendChild(header);
      treeEl.appendChild(list);
    }
  }

  searchEl.addEventListener('input', () => renderTree(searchEl.value));

  // ── Symbol selection ───────────────────────────────────────
  async function selectSymbol(name) {
    selectedSymbol = name;
    currentPage = 1;
    renderTree(searchEl.value);
    await loadSymbolPage();
  }

  async function loadSymbolPage() {
    if (!selectedSymbol) return;
    setLoading(true);
    try {
      const data = await requestSymbol(selectedSymbol, currentPage, rows);
      if (data.error) { setStatus('<span class="error">⚠ ' + escHtml(data.error) + '</span>'); return; }
      renderSymbol(data);
    } catch (err) {
      setStatus('<span class="error">⚠ ' + escHtml(String(err)) + '</span>');
    } finally {
      setLoading(false);
    }
  }

  function requestSymbol(name, page, rowCount) {
    return new Promise((resolve, reject) => {
      pendingResolve = resolve;
      vscode.postMessage({ command: 'getSymbol', symbolName: name, page, rows: rowCount });
      setTimeout(() => {
        if (pendingResolve) { pendingResolve = null; reject(new Error('Timeout waiting for symbol data')); }
      }, 30000);
    });
  }

  function renderSymbol(data) {
    totalRecords = data.total;
    const totalPages = Math.max(1, Math.ceil(totalRecords / rows));

    // Header
    symNameEl.textContent = data.name;
    symDescEl.textContent = data.description ? '— ' + data.description : '';
    symTotalEl.textContent = totalRecords + ' record' + (totalRecords !== 1 ? 's' : '');
    headerEl.style.display = 'flex';

    // Table
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    if (data.columns.length > 0) {
      const tr = document.createElement('tr');
      for (const col of data.columns) {
        const th = document.createElement('th');
        th.textContent = col;
        tr.appendChild(th);
      }
      thead.appendChild(tr);
    }

    for (const rec of data.records) {
      const tr = document.createElement('tr');
      for (const col of data.columns) {
        const td = document.createElement('td');
        const val = rec[col];
        td.textContent = val === null || val === undefined ? '' : String(val);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    if (data.records.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = Math.max(data.columns.length, 1);
      td.textContent = 'No records.';
      td.style.color = 'var(--vscode-descriptionForeground)';
      td.style.padding = '16px 10px';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrapEl.innerHTML = '';
    tableWrapEl.appendChild(table);

    // Pagination
    pageInfoEl.textContent = 'Page ' + currentPage + ' / ' + totalPages;
    document.getElementById('btn-first').disabled = currentPage <= 1;
    document.getElementById('btn-prev').disabled  = currentPage <= 1;
    document.getElementById('btn-next').disabled  = currentPage >= totalPages;
    document.getElementById('btn-last').disabled  = currentPage >= totalPages;
    paginationEl.style.display = 'flex';
  }

  // ── Pagination controls ────────────────────────────────────
  document.getElementById('btn-first').addEventListener('click', () => { currentPage = 1; loadSymbolPage(); });
  document.getElementById('btn-prev').addEventListener('click',  () => { currentPage--; loadSymbolPage(); });
  document.getElementById('btn-next').addEventListener('click',  () => { currentPage++; loadSymbolPage(); });
  document.getElementById('btn-last').addEventListener('click',  () => {
    currentPage = Math.max(1, Math.ceil(totalRecords / rows));
    loadSymbolPage();
  });
  rowsSelect.addEventListener('change', () => {
    rows = parseInt(rowsSelect.value, 10);
    currentPage = 1;
    if (selectedSymbol) loadSymbolPage();
  });

  // ── Helpers ────────────────────────────────────────────────
  function setStatus(html) {
    if (html === null) {
      statusEl.style.display = 'none';
    } else {
      statusEl.innerHTML = html;
      statusEl.style.display = 'flex';
      tableWrapEl.innerHTML = '';
      tableWrapEl.appendChild(statusEl);
      headerEl.style.display = 'none';
      paginationEl.style.display = 'none';
    }
  }

  function setLoading(on) {
    if (on) {
      const loader = document.createElement('div');
      loader.id = 'status';
      loader.className = 'status';
      loader.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;padding:32px';
      loader.innerHTML = '<span class="spinner"></span> Loading…';
      tableWrapEl.innerHTML = '';
      tableWrapEl.appendChild(loader);
    }
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
})();
</script>
</body>
</html>`;
}
