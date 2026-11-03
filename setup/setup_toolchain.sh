#!/usr/bin/env bash
# 安装 ESP-IDF 工具链（针对 esp32s3 目标）
set -u
_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export IDF_PATH="$(dirname "$_HERE")/esp-idf"
cd "$IDF_PATH" || exit 1

# 1) 强制使用系统 Python 3.10（避免 miniconda 的 3.14 被 detect_python.sh 选中）
export PATH="/usr/bin:$ESP32_TOOLS_PREFIX/usr/bin:$PATH"
# 2) 免 root 解压安装的 flex/bison/gperf/ccache/dfu-util
export LD_LIBRARY_PATH="$ESP32_TOOLS_PREFIX/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
# 3) 工具链下载走国内镜像（GitHub 连通性不稳定）
export IDF_GITHUB_ASSETS="dl.espressif.cn/github_assets"

echo "### python: $(command -v python3) -> $(python3 --version 2>&1)"
bash ./"install"".sh" esp32s3
echo "### EXIT=$?"
