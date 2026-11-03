/**
 * 板级配置档：解析 setup/boards/*.defaults，并与探测结果匹配。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BOARDS_DIR = 'setup/boards';

/** 解析一份 sdkconfig.defaults，抽出板级参数 */
function parseProfile(filePath) {
    let text;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
    const get = (re) => {
        const m = text.match(re);
        return m ? m[1] : null;
    };

    const target = get(/^\s*CONFIG_IDF_TARGET\s*=\s*"([^"]+)"/m);
    const flashMB = get(/^\s*CONFIG_ESPTOOLPY_FLASHSIZE_(\d+)MB\s*=\s*y/m);
    const psramOct = /^\s*CONFIG_SPIRAM_MODE_OCT\s*=\s*y/m.test(text);
    const psramQuad = /^\s*CONFIG_SPIRAM_MODE_QUAD\s*=\s*y/m.test(text);
    const psramAny = /^\s*CONFIG_SPIRAM\s*=\s*y/m.test(text);
    const partition = get(/^\s*CONFIG_PARTITION_TABLE_CUSTOM_FILENAME\s*=\s*"([^"]+)"/m);

    const firstComment = (text.match(/^\s*#\s*(.+)$/m) || [])[1] || '';

    return {
        name: path.basename(filePath).replace(/\.defaults$/, ''),
        file: filePath,
        target: target || 'esp32s3',
        flashMB: flashMB ? parseInt(flashMB, 10) : null,
        psram: psramAny ? (psramOct ? 'oct' : psramQuad ? 'quad' : 'yes') : 'none',
        partition,
        description: firstComment.trim(),
    };
}

/** 列出根目录下所有板级配置档 */
function listProfiles(root) {
    const dir = path.join(root, BOARDS_DIR);
    let names;
    try {
        names = fs.readdirSync(dir);
    } catch {
        return [];
    }
    const out = [];
    for (const n of names) {
        if (!n.endsWith('.defaults')) continue;
        const p = parseProfile(path.join(dir, n));
        if (p) out.push(p);
    }
    return out;
}

/**
 * 给探测结果找最贴合的配置档。
 * 评分：target 匹配 + Flash 容量匹配 + PSRAM 模式匹配，各占权重。
 */
function matchProfile(profiles, detected) {
    if (!detected || !detected.ok) return null;
    let best = null;
    let bestScore = -1;

    for (const p of profiles) {
        let score = 0;
        if (p.target === detected.chip.target) score += 3;
        else score -= 2;

        if (p.flashMB && detected.flash.sizeMB) {
            if (p.flashMB === detected.flash.sizeMB) score += 3;
            else score -= 1;
        }

        // 检测到 PSRAM 才比较模式；没检测到就不加分不减分
        if (detected.psramMB) {
            if (p.psram === 'oct') score += 2;
            else if (p.psram === 'quad') score += 2;
            else score -= 1;
        } else {
            if (p.psram === 'none') score += 1;
        }

        if (score > bestScore) {
            bestScore = score;
            best = p;
        }
    }
    return bestScore >= 4 ? best : null;
}

module.exports = { listProfiles, parseProfile, matchProfile };
