/**
 * ESP32 Board Info —— 自动识别串口与芯片型号的小工具
 *
 * 设计：
 *   状态栏常驻显示当前板子信息，插上新板子自动刷新（只做被动识别，不碰板子）
 *   点状态栏或执行命令打开面板，点"探测"才做主动复位拿完整参数
 */
'use strict';

const vscode = require('vscode');
const path = require('path');
const { execFile } = require('child_process');

const detect = require('./lib/detect');
const profiles = require('./lib/profiles');

let statusBar;
let panel = null;
let pollTimer = null;

const state = {
    ports: [],
    probed: new Map(),   // device -> 探测结果
    probing: new Set(),  // 正在探测的 device
    lastError: null,
};

function cfg() {
    const c = vscode.workspace.getConfiguration('esp32BoardInfo');
    let root = c.get('root') || '${env:HOME}/esp32';
    root = root.replace(/\$\{env:HOME\}/g, process.env.HOME || '');
    root = root.replace(/^~(?=\/)/, process.env.HOME || '~');
    return {
        root,
        esptoolPath: c.get('esptoolPath') || '',
        autoProbe: c.get('autoProbe', true),
        pollInterval: Math.max(500, c.get('pollInterval', 2000)),
    };
}

// ── 状态栏 ────────────────────────────────────────────────────

function updateStatusBar() {
    if (!statusBar) return;
    const probed = [...state.probed.values()].filter((p) => p && p.ok);
    const ports = state.ports;

    if (probed.length) {
        const p = probed[probed.length - 1];
        const chip = p.chip.model || 'ESP32';
        const flash = p.flash.sizeMB ? `${p.flash.sizeMB}MB` : '';
        const psram = p.psramMB ? `PSRAM ${p.psramMB}MB` : '';
        const bits = [chip, flash, psram].filter(Boolean).join(' · ');
        statusBar.text = `$(plug) ${bits}`;
        statusBar.tooltip = new vscode.MarkdownString(
            [
                `**${chip}** (${p.chip.target || '?'})`,
                '',
                `- 串口: \`${p.device}\``,
                p.chip.revision ? `- 版本: ${p.chip.revision}` : '',
                p.chip.crystal ? `- 晶振: ${p.chip.crystal}` : '',
                p.flash.sizeMB ? `- Flash: ${p.flash.sizeMB}MB (${p.flash.mode || '?'} SPI, ${p.flash.voltage || '?'})` : '',
                p.psramMB ? `- PSRAM: ${p.psramMB}MB` : '',
                p.chip.mac ? `- MAC: \`${p.chip.mac}\`` : '',
                p.secure && p.secure.encrypted ? '- ⚠️ Flash 加密已开启' : '',
                '',
                '点击打开板子信息面板',
            ].filter(Boolean).join('\n')
        );
        statusBar.backgroundColor = undefined;
        return;
    }

    if (state.probing.size) {
        statusBar.text = '$(sync~spin) 探测中…';
        statusBar.tooltip = '正在探测芯片型号（会复位板子）';
        return;
    }

    if (ports.length) {
        statusBar.text = `$(plug) ${ports.length} 个串口待探测`;
        statusBar.tooltip = ports.map((p) => `${p.device}\n  ${describePort(p).desc}`).join('\n\n');
        statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        return;
    }

    statusBar.text = '$(plug) 未检测到串口';
    statusBar.tooltip = '插上开发板后这里会显示板子信息\n点击打开面板';
    statusBar.backgroundColor = undefined;
}

function describePort(p) {
    return detect.describeUsb(p.usb);
}

// ── 扫描 ──────────────────────────────────────────────────────

async function scan({ silent = false } = {}) {
    const before = new Set(state.ports.map((p) => p.device));
    state.ports = detect.listSerialPorts();
    const after = new Set(state.ports.map((p) => p.device));

    // 新出现的串口 → 可选自动探测
    const fresh = state.ports.filter((p) => !before.has(p.device));

    if (fresh.length) {
        const c = cfg();
        if (c.autoProbe) {
            for (const p of fresh) {
                await probe(p.device, { silent: true });
            }
        } else {
            vscode.window.setStatusBarMessage('检测到新串口（ESP32: 探测当前串口的芯片 可获取型号）', 4000);
        }
    }

    updateStatusBar();
    refreshPanel();
    if (!silent && fresh.length) {
        vscode.window.setStatusBarMessage(
            `检测到 ${fresh.map((p) => p.device).join(', ')}`, 3000
        );
    }
}

async function probe(device, { silent = false } = {}) {
    if (state.probing.has(device)) return state.probed.get(device);
    const c = cfg();
    const python = detect.findEsptoolPython(c.esptoolPath);

    state.probing.add(device);
    updateStatusBar();
    refreshPanel();

    try {
        const res = await detect.probePort(device, python);
        state.probed.set(device, res);
        if (!res.ok && !silent) {
            vscode.window.showWarningMessage(`探测 ${device} 失败：${res.error || '未知错误'}`);
        }
    } catch (e) {
        state.probed.set(device, { ok: false, device, error: String(e && e.message || e) });
    } finally {
        state.probing.delete(device);
        updateStatusBar();
        refreshPanel();
    }
    return state.probed.get(device);
}

// ── Webview 面板 ──────────────────────────────────────────────

function refreshPanel() {
    if (!panel) return;
    panel.webview.postMessage({ type: 'state', state: serializeState() });
}

function serializeState() {
    const c = cfg();
    const list = profiles.listProfiles(c.root);
    const probedEntries = [...state.probed.entries()].map(([device, res]) => ({
        device,
        result: res,
    }));
    return {
        ports: state.ports.map((p) => ({
            device: p.device,
            byId: p.byId,
            usb: p.usb,
            desc: describePort(p).desc,
            guessedChip: describePort(p).chip,
        })),
        probed: probedEntries,
        probing: [...state.probing],
        profiles: list.map((p) => ({
            name: p.name,
            target: p.target,
            flashMB: p.flashMB,
            psram: p.psram,
            description: p.description,
        })),
        root: c.root,
    };
}

function html(webview) {
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
  .warn { color: var(--vscode-editorWarning-foreground); }
  .err  { color: var(--vscode-editorError-foreground); }
  .ok   { color: var(--vscode-testing-iconPassed); }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .row-actions { margin-top: 10px; }
</style>
</head>
<body>
  <h1>ESP32 板子信息</h1>
  <div class="sub" id="root"></div>

  <table>
    <thead><tr><th>串口</th><th>USB 设备</th><th>状态</th><th></th></tr></thead>
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
        tb.innerHTML = '<tr><td colspan="4" class="empty">没有检测到串口。插上开发板试试。</td></tr>';
      } else {
        tb.innerHTML = s.ports.map(p => {
          const pr = s.probed.find(x => x.device === p.device);
          const status = s.probing.includes(p.device)
            ? '<span class="warn">探测中…</span>'
            : (pr && pr.result && pr.result.ok
                ? '<span class="ok">已识别: ' + esc(pr.result.chip.model || '?') + '</span>'
                : (pr ? '<span class="err">探测失败</span>' : '<span>未探测</span>'));
          const action = (pr && pr.result && pr.result.ok)
            ? '' : '<button data-probe="' + esc(p.device) + '">探测</button>';
          return '<tr><td class="mono">' + esc(p.device) + '</td>'
               + '<td>' + esc(p.desc) + (p.usb ? ' <span class="mono">' + esc(p.usb.vid + ':' + p.usb.pid) + '</span>' : '') + '</td>'
               + '<td>' + status + '</td>'
               + '<td>' + action + '</td></tr>';
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

    vscode.postMessage({ type: 'ready' });
    render();
  </script>
</body>
</html>`;
}

function openPanel() {
    if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        return;
    }
    panel = vscode.window.createWebviewPanel(
        'esp32BoardInfo.panel',
        'ESP32 板子信息',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.webview.html = html(panel.webview);
    panel.onDidDispose(() => { panel = null; });
    panel.webview.onDidReceiveMessage(async (msg) => {
        if (!msg) return;
        if (msg.type === 'probe') {
            await probe(msg.device);
        } else if (msg.type === 'apply') {
            await applyProfile(msg.profile);
        } else if (msg.type === 'command') {
            vscode.commands.executeCommand(msg.command);
        } else if (msg.type === 'ready') {
            refreshPanel();
        }
    });
    scan({ silent: true });
}

// ── 应用配置档到当前工程 ──────────────────────────────────────

async function applyProfile(profileName) {
    if (!profileName) return;
    const c = cfg();
    const script = path.join(c.root, 'setup', 'use_board.sh');
    const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    if (!ws) {
        vscode.window.showErrorMessage('请先打开一个工程目录');
        return;
    }
    if (!require('fs').existsSync(script)) {
        vscode.window.showErrorMessage(`找不到 ${script}`);
        return;
    }
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `应用配置档 ${profileName}…` },
        () => new Promise((resolve) => {
            execFile('bash', [script, profileName, ws.uri.fsPath], { maxBuffer: 8 * 1024 * 1024 },
                (err, stdout, stderr) => {
                    const out = (stdout || '') + (stderr || '');
                    if (err) {
                        vscode.window.showErrorMessage(`应用失败：${out.slice(-600)}`);
                    } else {
                        vscode.window.showInformationMessage(`已应用配置档 ${profileName} 到 ${ws.name}`);
                        vscode.window.showInformationMessage(
                            out.split('\n').filter(l => l.includes('CONFIG_')).slice(-3).join('　')
                        );
                    }
                    resolve();
                });
        })
    );
}

// ── 激活 ──────────────────────────────────────────────────────

function activate(context) {
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.command = 'esp32BoardInfo.showPanel';
    statusBar.show();
    context.subscriptions.push(statusBar);

    context.subscriptions.push(
        vscode.commands.registerCommand('esp32BoardInfo.showPanel', openPanel),
        vscode.commands.registerCommand('esp32BoardInfo.scan', () => scan()),
        vscode.commands.registerCommand('esp32BoardInfo.probe', async () => {
            const c = cfg();
            const picked = await pickPort();
            if (!picked) return;
            await probe(picked);
            openPanel();
        }),
        vscode.commands.registerCommand('esp32BoardInfo.applyProfile', async () => {
            const c = cfg();
            const list = profiles.listProfiles(c.root);
            if (!list.length) {
                vscode.window.showWarningMessage(`在 ${c.root}/setup/boards 下没找到配置档`);
                return;
            }
            const items = list.map((p) => ({
                label: p.name,
                description: `${p.target} · ${p.flashMB || '?'}MB · PSRAM ${p.psram}`,
                detail: p.description,
            }));
            const sel = await vscode.window.showQuickPick(items, { placeHolder: '选择要应用的板子配置档' });
            if (sel) applyProfile(sel.label);
        })
    );

    // 串口变化监听（轮询）
    const startPolling = () => {
        const interval = cfg().pollInterval;
        pollTimer = setInterval(() => { scan({ silent: true }); }, interval);
        context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });
    };
    startPolling();

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('esp32BoardInfo')) {
                clearInterval(pollTimer);
                startPolling();
                updateStatusBar();
                refreshPanel();
            }
        })
    );

    scan({ silent: true });
}

async function pickPort() {
    const items = state.ports.map((p) => ({
        label: p.device,
        description: describePort(p).desc,
        detail: p.byId && p.byId.length ? p.byId.join(', ') : undefined,
    }));
    if (!items.length) {
        vscode.window.showWarningMessage('没有检测到串口');
        return null;
    }
    const sel = await vscode.window.showQuickPick(items, { placeHolder: '选择串口' });
    return sel ? sel.label : null;
}

function deactivate() {
    if (pollTimer) clearInterval(pollTimer);
    if (statusBar) statusBar.dispose();
}

module.exports = { activate, deactivate };
