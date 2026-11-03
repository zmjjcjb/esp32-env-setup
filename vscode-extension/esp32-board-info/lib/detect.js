/**
 * 串口枚举与芯片探测。
 *
 * 分两层：
 *   - 被动扫描：只读 /dev 和 sysfs，不碰板子，插上就能看到"有个 Espressif 设备"
 *   - 主动探测：调 esptool 复位进 bootloader，拿到芯片型号/Flash/PSRAM/MAC
 *     （认型号必须复位，这个副作用不能偷偷发生，所以由用户点击触发）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ── USB VID/PID → 设备描述 ────────────────────────────────────
const USB_DEVICES = {
    '303a:1001': { desc: 'Espressif USB JTAG/Serial（ROM 下载模式）', chip: null },
    '303a:4001': { desc: 'Espressif USB Serial/JTAG（应用运行态）', chip: null },
    '303a:0002': { desc: 'Espressif USB CDC', chip: 'esp32s2' },
    '303a:0009': { desc: 'Espressif USB CDC', chip: 'esp32s3' },
    '303a:000a': { desc: 'Espressif USB JTAG', chip: 'esp32s3' },
    '10c4:ea60': { desc: 'Silicon Labs CP210x UART Bridge', chip: null },
    '1a86:7523': { desc: 'QinHeng CH340', chip: null },
    '1a86:55d4': { desc: 'QinHeng CH9102F', chip: null },
    '0403:6001': { desc: 'FTDI FT232R', chip: null },
    '0403:6010': { desc: 'FTDI FT2232H', chip: null },
    '0403:6014': { desc: 'FTDI FT232H', chip: null },
};

/** esptool 的 "Chip is ..." 行 → 归一化的 target 名 */
const CHIP_TO_TARGET = [
    [/^ESP32-S3/i, 'esp32s3'],
    [/^ESP32-S2/i, 'esp32s2'],
    [/^ESP32-C61/i, 'esp32c61'],
    [/^ESP32-C6/i, 'esp32c6'],
    [/^ESP32-C5/i, 'esp32c5'],
    [/^ESP32-C3/i, 'esp32c3'],
    [/^ESP32-C2/i, 'esp32c2'],
    [/^ESP32-H2/i, 'esp32h2'],
    [/^ESP32-P4/i, 'esp32p4'],
    [/^ESP32-H4/i, 'esp32h4'],
    [/^ESP32/i, 'esp32'],
];

// ── 串口枚举 ──────────────────────────────────────────────────

function safeReaddir(dir) {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}

/**
 * 列出串口设备。Linux 下扫 /dev/ttyUSB*、/dev/ttyACM* 和 /dev/serial/by-id。
 */
function listSerialPorts() {
    const found = new Map();

    for (const dir of ['/dev']) {
        for (const name of safeReaddir(dir)) {
            if (!/^tty(USB|ACM)\d+$/.test(name)) continue;
            found.set(path.join(dir, name), { device: path.join(dir, name), byId: [] });
        }
    }

    // /dev/serial/by-id 里有稳定名字（按序列号），优先展示
    const byIdDir = '/dev/serial/by-id';
    for (const name of safeReaddir(byIdDir)) {
        let real;
        try {
            real = fs.realpathSync(path.join(byIdDir, name));
        } catch {
            continue;
        }
        if (found.has(real)) {
            found.get(real).byId.push(name);
        }
    }

    const ports = [];
    for (const info of found.values()) {
        ports.push({
            ...info,
            usb: usbIdsForPort(info.device),
            name: path.basename(info.device),
        });
    }
    ports.sort((a, b) => a.device.localeCompare(b.device));
    return ports;
}

/**
 * 从 /sys/class/tty/<name>/device 往上找 USB 设备节点，读 idVendor/idProduct。
 */
function usbIdsForPort(devicePath) {
    const name = path.basename(devicePath);
    let dir = `/sys/class/tty/${name}/device`;
    try {
        dir = fs.realpathSync(dir);
    } catch {
        return null;
    }
    let cur = dir;
    for (let i = 0; i < 8; i++) {
        const v = path.join(cur, 'idVendor');
        const p = path.join(cur, 'idProduct');
        if (fs.existsSync(v) && fs.existsSync(p)) {
            try {
                return {
                    vid: fs.readFileSync(v, 'utf8').trim().toLowerCase(),
                    pid: fs.readFileSync(p, 'utf8').trim().toLowerCase(),
                };
            } catch {
                return null;
            }
        }
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
    }
    return null;
}

function describeUsb(usb) {
    if (!usb) return { desc: '未知 USB 设备', chip: null };
    const key = `${usb.vid}:${usb.pid}`;
    const known = USB_DEVICES[key];
    if (known) return known;
    return { desc: `USB ${key}`, chip: null };
}

// ── esptool 主动探测 ──────────────────────────────────────────

function findEsptoolPython(configured) {
    if (configured && fs.existsSync(configured)) return configured;
    const base = path.join(process.env.HOME || '', '.espressif', 'python_env');
    for (const name of safeReaddir(base)) {
        const py = path.join(base, name, 'bin', 'python');
        if (fs.existsSync(py)) return py;
    }
    return null;
}

/** 跑一条 esptool 命令，返回 {ok, stdout, stderr, code} */
function runEsptool(pythonPath, args, timeoutMs = 20000) {
    return new Promise((resolve) => {
        const child = execFile(
            pythonPath,
            ['-m', 'esptool', ...args],
            { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout, stderr) => {
                resolve({
                    ok: !err,
                    stdout: stdout || '',
                    stderr: stderr || '',
                    code: err ? (err.code ?? -1) : 0,
                });
            }
        );
        child.on('error', () => { /* 超时/ENOENT 都会走 callback */ });
    });
}

function parseChipId(text) {
    const out = { model: null, target: null, revision: null, features: null, mac: null, crystal: null };
    const m = text.match(/^Chip is (\S+).*?revision (v[\d.]+)/m);
    if (m) {
        out.model = m[1];
        out.revision = m[2];
        for (const [re, t] of CHIP_TO_TARGET) {
            if (re.test(out.model)) { out.target = t; break; }
        }
    }
    const f = text.match(/^Features:\s*(.+)$/m);
    if (f) out.features = f[1].trim();
    const mac = text.match(/^MAC:\s*([0-9a-f:]{17})/im);
    if (mac) out.mac = mac[1].toLowerCase();
    const c = text.match(/^Crystal is (\d+)\s*MHz/im);
    if (c) out.crystal = `${c[1]}MHz`;
    return out;
}

function parseFlashId(text) {
    const out = { sizeMB: null, manufacturer: null, device: null, mode: null, voltage: null };
    const man = text.match(/^Manufacturer:\s*([0-9a-fA-F]+)/m);
    if (man) out.manufacturer = man[1].toLowerCase();
    const dev = text.match(/^Device:\s*([0-9a-fA-F]+)/m);
    if (dev) out.device = dev[1].toLowerCase();
    const size = text.match(/Detected flash size:\s*(\d+)\s*MB/i);
    if (size) out.sizeMB = parseInt(size[1], 10);
    const mode = text.match(/Flash type set in eFuse:\s*(\w+)/i);
    if (mode) out.mode = mode[1].toLowerCase();
    // esptool 的电压行有两种写法，都没冒号:
    //   "Flash voltage set by eFuse to 3.3V"
    //   "Flash voltage set by a strapping pin to 3.3V"
    const volt = text.match(/Flash voltage[^:\n]*?(?:to\s*)?([\d.]+V)/i);
    if (volt) out.voltage = volt[1];
    return out;
}

/**
 * 完整探测一个串口。会复位板子进 bootloader（认芯片型号的必要代价）。
 */
async function probePort(device, pythonPath) {
    if (!pythonPath) {
        return { ok: false, error: '找不到 esptool 的 python 解释器' };
    }
    const base = ['--chip', 'auto', '-p', device];

    const chipRes = await runEsptool(pythonPath, [...base, 'chip_id']);
    if (!chipRes.ok && !/Chip is/.test(chipRes.stdout)) {
        return {
            ok: false,
            error: firstErrorLine(chipRes) || '连接失败',
            raw: (chipRes.stdout + chipRes.stderr).trim().split('\n').slice(-4).join('\n'),
        };
    }
    const chip = parseChipId(chipRes.stdout);

    const flashRes = await runEsptool(pythonPath, [...base, 'flash_id']);
    const flash = parseFlashId(flashRes.stdout);

    const secRes = await runEsptool(pythonPath, [...base, 'get_security_info'], 15000);
    const secure = parseSecurityInfo(secRes.stdout);

    // eFuse 特征串里若带 PSRAM，直接给出 PSRAM 容量（ESP32-S3R8 这类是 die-bonded 的）
    let psramMB = null;
    if (chip.features) {
        const pm = chip.features.match(/Embedded PSRAM (\d+)MB/i);
        if (pm) psramMB = parseInt(pm[1], 10);
    }

    return {
        ok: true,
        device,
        chip,
        flash,
        psramMB,
        secure,
    };
}

function parseSecurityInfo(text) {
    const out = { encrypted: false, secureBoot: false, flashEncryption: null };
    const enc = text.match(/Flash encryption:\s*(\w+)/i);
    if (enc) {
        out.flashEncryption = enc[1];
        out.encrypted = /enabled/i.test(enc[1]);
    }
    const sb = text.match(/Secure boot:\s*(\w+)/i);
    if (sb) out.secureBoot = /enabled/i.test(sb[1]);
    return out;
}

function firstErrorLine(res) {
    const all = `${res.stdout}\n${res.stderr}`;
    const m = all.match(/^(?:A fatal error occurred:\s*)?(.{0,160})/m);
    for (const line of all.split('\n')) {
        const t = line.trim();
        if (/error|fatal|failed/i.test(t) && !/^\*/.test(t)) return t.slice(0, 200);
    }
    return m ? '' : '';
}

module.exports = {
    listSerialPorts,
    usbIdsForPort,
    describeUsb,
    findEsptoolPython,
    probePort,
    parseChipId,
    parseFlashId,
};
