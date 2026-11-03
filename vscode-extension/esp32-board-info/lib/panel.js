/**
 * Webview 面板的 HTML 生成。
 *
 * 独立于 VS Code，便于：
 *   - 单元测试
 *   - 用浏览器直接预览渲染效果（见 test/preview.js）
 */
'use strict';

/**
 * @param {{cspSource: string}} webview
 * @returns {string} 完整的 HTML 文档
 */
function render(webview) {
    const nonce = require('crypto').randomUUID();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ESP32 板子信息</title>
<style>
  body { font-family: var(--vscode-font-family); padding: 14px 18px; color: var(--vscode-foreground); }
  h1 { font-size: 1.15em; margin: 0 0 2px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: .9em; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  th { color: var(--vscode-descriptionForeground); font-weight: 500; font-size: .9em; }
  code, .mono { font-family: var(--vscode-editor-font-family); font-size: .92em; }
  .card { border: 1px solid var(--vscode-panel-border); border-radius: 5px; padding: 12px 14px; margin-bottom: 14px; }
  .card h2 { font-size: 1em; margin: 0 0 8px; }
  .kv { display: grid; grid-template-columns: 120px 1fr; gap: 3px 10px; font-size: .92em; }
  .kv .k { color: var(--vscode-descriptionForeground); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; padding: 5px 12px; border-radius: 3px; cursor: pointer; font-size: .92em; margin-right: 6px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: .5; cursor: default; }
  .warn { color: var(--vscode-editorWarning-foreground); }
  .err  { color: var(--vscode-editorError-foreground); }
  .ok   { color: var(--vscode-testing-iconPassed); }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .row-actions { margin-top: 10px; }
  /* 浏览器预览时的兜底配色（VS Code 里由主题提供变量） */
  body:not(.vscode) { background: #1e1e1e; color: #d4d4d4; font-family: system-ui, sans-serif; }
  body:not(.vscode) .sub, body:not(.vscode) th, body:not(.vscode) .kv .k { color: #9d9d9d; }
  body:not(.vscode) table td, body:not(.vscode) .card { border-color: #454545; }
  body:not(.vscode) button { background: #0e639c; color: #fff; }
  body:not(.vscode) button.secondary { background: #3a3d41; color: #d4d4d4; }
  body:not(.vscode) .ok { color: #89d185; }
  body:not(.vscode) .warn { color: #cca700; }
  body:not(.vscode) .err { color: #f14c4c; }
</style>
</head>
<body>
  <h1>ESP32 板子信息</h1>
  <div class="sub" id="root"></div>

  <table>
    <thead><tr><th>串口</th><th>USB 设备</th><th>状态</th></tr></thead>
    <tbody id="ports"></tbody>
  </table>

  <div id="detail"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let STATE = null;

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    function render() {
      const s = STATE;
      if (!s) return;
      document.getElementById('root').textContent = '工作目录: ' + s.root;

      // 串口列表
      const tb = document.getElementById('ports');
      if (!s.ports.length) {
        tb.innerHTML = '<tr><td colspan="3" class="empty">没有检测到串口。插上开发板试试。</td></tr>';
      } else {
        tb.innerHTML = s.ports.map(p => {
          const pr = s.probed.find(x => x.device === p.device);
          const status = s.probing.includes(p.device)
            ? '<span class="warn">探测中…</span>'
            : (pr && pr.result && pr.result.ok
                ? '<span class="ok">已识别: ' + esc(pr.result.chip.model || '?') + '</span>'
                : (pr ? '<span class="err">探测失败</span>' : '<span>未探测</span>'));
          const action = (pr && pr.result && pr.result.ok)
            ? '' : ' <button data-probe="' + esc(p.device) + '">探测</button>';
          return '<tr><td class="mono">' + esc(p.device) + '</td>'
               + '<td>' + esc(p.desc) + (p.usb ? ' <span class="mono">' + esc(p.usb.vid + ':' + p.usb.pid) + '</span>' : '') + '</td>'
               + '<td>' + status + action + '</td></tr>';
        }).join('');
      }

      // 详情
      const okProbes = s.probed.filter(x => x.result && x.result.ok);
      const detail = document.getElementById('detail');
      if (!okProbes.length) {
        detail.innerHTML = '<div class="card"><h2>详细信息</h2>'
          + '<div class="empty">点上面某个串口的「探测」按钮，这里会显示芯片型号、Flash 容量、PSRAM、MAC 等完整信息。</div>'
          + '<div class="empty" style="margin-top:6px">注意：探测会让板子复位一次（认芯片型号必须进 bootloader，无法避免）。</div></div>';
        return;
      }
      const r = okProbes[okProbes.length - 1].result;
      const c = r.chip, f = r.flash;
      const rows = [];
      rows.push(['芯片', (c.model || '?') + '  <span class="mono">' + esc(c.target || '') + '</span>']);
      rows.push(['串口', '<span class="mono">' + esc(r.device) + '</span>']);
      if (c.revision) rows.push(['版本', esc(c.revision)]);
      if (c.crystal) rows.push(['晶振', esc(c.crystal)]);
      if (c.mac) rows.push(['MAC', '<span class="mono">' + esc(c.mac) + '</span>']);
      if (f.sizeMB) rows.push(['Flash', f.sizeMB + ' MB　<span class="mono">' + esc((f.manufacturer||'') + ' ' + (f.device||'')) + '</span>']);
      if (f.mode) rows.push(['Flash 接口', esc(f.mode + ' SPI, ' + (f.voltage || '?'))]);
      rows.push(['PSRAM', r.psramMB ? r.psramMB + ' MB' : '未检测到']);
      if (c.features) rows.push(['eFuse 特征', '<span class="mono">' + esc(c.features) + '</span>']);
      if (r.secure && r.secure.encrypted) rows.push(['安全', '<span class="warn">Flash 加密已开启</span>']);

      // 匹配配置档
      const match = matchProfile(s.profiles, r);
      let profHtml = '<div class="empty">没有完全匹配的现成配置档，可以按探测结果生成一个。</div>';
      if (match) {
        profHtml = '<div class="ok">匹配配置档: <span class="mono">' + esc(match.name) + '</span> —— '
          + esc(match.target) + ' / ' + (match.flashMB || '?') + 'MB / PSRAM ' + esc(match.psram) + '</div>';
      }

      detail.innerHTML = '<div class="card"><h2>详细信息</h2><div class="kv">'
        + rows.map(x => '<div class="k">' + x[0] + '</div><div>' + x[1] + '</div>').join('')
        + '</div>'
        + '<div class="row-actions">' + profHtml + '</div>'
        + '<div class="row-actions">'
        + '<button data-apply="' + esc(match ? match.name : '') + '"' + (match ? '' : ' disabled') + '>应用到当前工程</button>'
        + '<button class="secondary" data-cmd="espIdf.selectPort">ESP-IDF: 选择串口</button>'
        + '<button class="secondary" data-cmd="espIdf.setTarget">ESP-IDF: 选择目标芯片</button>'
        + '</div></div>';
    }

    function matchProfile(list, r) {
      let best = null, bestScore = -1;
      for (const p of list) {
        let sc = 0;
        sc += (p.target === r.chip.target) ? 3 : -2;
        if (p.flashMB && r.flash.sizeMB) sc += (p.flashMB === r.flash.sizeMB) ? 3 : -1;
        if (r.psramMB) sc += (p.psram === 'oct' || p.psram === 'quad') ? 2 : -1;
        else sc += (p.psram === 'none') ? 1 : 0;
        if (sc > bestScore) { bestScore = sc; best = p; }
      }
      return bestScore >= 4 ? best : null;
    }

    document.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t.dataset && t.dataset.probe) {
        vscode.postMessage({ type: 'probe', device: t.dataset.probe });
      } else if (t.dataset && t.dataset.apply) {
        vscode.postMessage({ type: 'apply', profile: t.dataset.apply });
      } else if (t.dataset && t.dataset.cmd) {
        vscode.postMessage({ type: 'command', command: t.dataset.cmd });
      }
    });

    window.addEventListener('message', (ev) => {
      if (ev.data && ev.data.type === 'state') { STATE = ev.data.state; render(); }
    });

    // 浏览器预览模式：没有 VS Code API，直接注入测试数据
    if (typeof acquireVsCodeApi !== 'function') {
      const inject = document.createElement('script');
      inject.textContent = 'window.__PREVIEW_STATE__ && window.dispatchEvent(new MessageEvent("message", {data: {type:"state", state: window.__PREVIEW_STATE__}}));';
      document.body.appendChild(inject);
    }

    vscode.postMessage({ type: 'ready' });
    render();
  </script>
</body>
</html>`;
}

module.exports = { render };
