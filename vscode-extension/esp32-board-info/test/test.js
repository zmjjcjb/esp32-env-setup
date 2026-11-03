/**
 * 扩展核心逻辑的独立测试（不依赖 VS Code）。
 * 用法: node test/test.js
 */
'use strict';

const assert = require('assert');
const detect = require('../lib/detect');
const profiles = require('../lib/profiles');

let pass = 0;
let fail = 0;

function check(name, fn) {
    try {
        fn();
        console.log(`  ok    ${name}`);
        pass++;
    } catch (e) {
        console.log(`  FAIL  ${name}\n        ${e.message}`);
        fail++;
    }
}

console.log('=== 串口枚举 ===');
const ports = detect.listSerialPorts();
console.log(`  找到 ${ports.length} 个串口`);
for (const p of ports) {
    const d = detect.describeUsb(p.usb);
    console.log(`    ${p.device}  ${d.desc}  usb=${p.usb ? p.usb.vid + ':' + p.usb.pid : '无'}`);
}

check('枚举结果里每个端口都有 device 路径', () => {
    for (const p of ports) {
        assert(p.device.startsWith('/dev/'), `端口路径异常: ${p.device}`);
        assert(typeof p.name === 'string');
    }
});

console.log('\n=== chip_id 解析 ===');
const chipText = `Chip is ESP32-S3 (QFN56) (revision v0.2)
Features: WiFi, BLE, Embedded PSRAM 8MB (AP_3v3)
Crystal is 40MHz
MAC: aa:bb:cc:dd:ee:ff
Uploading stub...`;

check('ESP32-S3 解析出型号/target/版本/晶振/MAC', () => {
    const c = detect.parseChipId(chipText);
    assert.strictEqual(c.model, 'ESP32-S3');
    assert.strictEqual(c.target, 'esp32s3');
    assert.strictEqual(c.revision, 'v0.2');
    assert.strictEqual(c.crystal, '40MHz');
    assert.strictEqual(c.mac, 'aa:bb:cc:dd:ee:ff');
});

check('原始 ESP32 的硅片版本名也能解析成 esp32', () => {
    const c = detect.parseChipId('Chip is ESP32-D0WD-V3 (revision v3.1)\nFeatures: WiFi, BT, Dual Core');
    assert.strictEqual(c.target, 'esp32');
    assert.strictEqual(c.revision, 'v3.1');
});

check('其它芯片型号映射正确', () => {
    const cases = [
        ['Chip is ESP32-C6 (QFN40) (revision v0.1)', 'esp32c6'],
        ['Chip is ESP32-C3 (QFN32) (revision v0.4)', 'esp32c3'],
        ['Chip is ESP32-C61 (QFN40) (revision v0.1)', 'esp32c61'],
        ['Chip is ESP32-P4 (QFN53) (revision v0.1)', 'esp32p4'],
        ['Chip is ESP32-S2 (QFN48) (revision v1.0)', 'esp32s2'],
    ];
    for (const [line, want] of cases) {
        const c = detect.parseChipId(line);
        assert.strictEqual(c.target, want, `${line} -> ${c.target}，期望 ${want}`);
    }
});

console.log('\n=== flash_id 解析 ===');
const flashText = `Manufacturer: 20
Device: 4017
Detected flash size: 8MB
Flash type set in eFuse: quad (4 data lines)
Flash voltage set by eFuse to 3.3V`;

check('Flash 信息解析正确', () => {
    const f = detect.parseFlashId(flashText);
    assert.strictEqual(f.sizeMB, 8);
    assert.strictEqual(f.manufacturer, '20');
    assert.strictEqual(f.device, '4017');
    assert.strictEqual(f.mode, 'quad');
    assert.strictEqual(f.voltage, '3.3V');
});

console.log('\n=== 配置档匹配 ===');
const root = process.env.HOME + '/esp32';
const list = profiles.listProfiles(root);
console.log(`  找到 ${list.length} 个配置档: ${list.map((p) => p.name).join(', ')}`);

check('能列出本机的配置档', () => {
    assert(list.length > 0, '一个都没找到');
});

check('配置档解析出正确参数', () => {
    const s3 = list.find((p) => p.name === 's3-n8r8');
    if (!s3) return; // 没有就跳过
    assert.strictEqual(s3.target, 'esp32s3');
    assert.strictEqual(s3.flashMB, 8);
    assert.strictEqual(s3.psram, 'oct');
});

check('探测结果能匹配到配置档', () => {
    const detected = {
        ok: true,
        chip: { model: 'ESP32-S3', target: 'esp32s3' },
        flash: { sizeMB: 8 },
        psramMB: 8,
    };
    const m = profiles.matchProfile(list, detected);
    assert(m, '没匹配上');
    assert.strictEqual(m.name, 's3-n8r8');
});

check('4MB 原始 ESP32 匹配到对应档', () => {
    const detected = {
        ok: true,
        chip: { model: 'ESP32-D0WD-V3', target: 'esp32' },
        flash: { sizeMB: 4 },
        psramMB: null,
    };
    const m = profiles.matchProfile(list, detected);
    assert(m, '没匹配上');
    assert.strictEqual(m.target, 'esp32');
    assert.strictEqual(m.flashMB, 4);
});

console.log(`\n===== ${pass} 通过, ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
