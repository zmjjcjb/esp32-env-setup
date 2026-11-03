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
const panelUi = require('./lib/panel');

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
    panel.webview.html = panelUi.render(panel.webview);
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
