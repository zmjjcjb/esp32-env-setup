#!/usr/bin/env node
/**
 * 生成面板预览页（浏览器可直接打开），用于在没有板子时验证渲染效果。
 *
 * 用法: node preview.js
 * 输出: <扩展目录>/preview.html
 */
'use strict';

const fs = require('fs');
const path = require('path');
const panel = require('./lib/panel');

const OUT = path.join(__dirname, 'preview.html');

const MOCK_STATE = {
    root: '/home/<user>/esp32',
    ports: [
        {
            device: '/dev/ttyUSB0',
            byId: ['usb-Silicon_Labs_CP2102_USB_UART_0001-if00-port0'],
            usb: { vid: '10c4', pid: 'ea60' },
            desc: 'Silicon Labs CP210x UART Bridge',
            guessedChip: null,
        },
        {
            device: '/dev/ttyACM1',
            byId: [],
            usb: { vid: '303a', pid: '4001' },
            desc: 'Espressif USB Serial/JTAG（应用运行态）',
            guessedChip: null,
        },
    ],
    probed: [
        {
            device: '/dev/ttyUSB0',
            result: {
                ok: true,
                device: '/dev/ttyUSB0',
                chip: {
                    model: 'ESP32-S3',
                    target: 'esp32s3',
                    revision: 'v0.2',
                    features: 'WiFi, BLE, Embedded PSRAM 8MB (AP_3v3)',
                    mac: 'aa:bb:cc:dd:ee:ff',
                    crystal: '40MHz',
                },
                flash: {
                    sizeMB: 8,
                    manufacturer: '20',
                    device: '4017',
                    mode: 'quad',
                    voltage: '3.3V',
                },
                psramMB: 8,
                secure: { encrypted: false, secureBoot: false },
            },
        },
    ],
    probing: [],
    profiles: [
        { name: 'generic', target: 'esp32s3', flashMB: 2, psram: 'none', description: '通用安全默认' },
        { name: 's3-n8r8', target: 'esp32s3', flashMB: 8, psram: 'oct', description: 'ESP32-S3 8MB + 八线 PSRAM' },
        { name: 'esp32-4mb', target: 'esp32', flashMB: 4, psram: 'none', description: 'ESP32 原始款 4MB' },
    ],
};

let html = panel.render({ cspSource: 'http://localhost/' });

// 浏览器预览：注入 acquireVsCodeApi 桩 + 模拟状态
const stub = `<script>
window.__PREVIEW_STATE__ = ${JSON.stringify(MOCK_STATE)};
window.acquireVsCodeApi = function () {
  return { postMessage: function (msg) {
    if (msg && msg.type === 'ready') {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'state', state: window.__PREVIEW_STATE__ }
      }));
    }
  }};
};
</script>`;

html = html.replace('<title>', stub + '<title>');
// 预览页不需要严格 CSP
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');

fs.writeFileSync(OUT, html);
console.log('已生成预览页:', OUT);
