#!/usr/bin/env bash
# ESP32 开发环境变量（免 root 适配）
# 由 ~/.bashrc 与 ~/.profile 共同引用，请勿直接执行。

# 1) 免 root 解压安装的工具：flex / bison / gperf / ccache / dfu-util
_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export ESP32_TOOLS_PREFIX="$(dirname "$_HERE")/tools/root"
case ":$PATH:" in
    *":$ESP32_TOOLS_PREFIX/usr/bin:"*) ;;
    *) export PATH="$ESP32_TOOLS_PREFIX/usr/bin:$PATH" ;;
esac
export LD_LIBRARY_PATH="$ESP32_TOOLS_PREFIX/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# 2) 工具链下载走国内镜像（GitHub 直连不稳定）
export IDF_GITHUB_ASSETS="dl.espressif.cn/github_assets"

# 3) 锁定 ESP-IDF 使用的 Python 虚拟环境。
#    原因：本机 PATH 中 miniconda 的 python3 (3.14) 排在系统 python3.10 之前，
#    而 tools/detect_python.sh 只认 PATH 里第一个 python3，会去找不存在的
#    idf5.5_py3.14_env。显式指定 venv 路径可绕开（idf_tools.py 支持此覆盖）。
# 自动找到 ESP-IDF 的 python venv（版本号可能不同，不写死）
_IDF_ENV_DIR=""
for _d in "$HOME"/.espressif/python_env/idf*_env; do
    [ -d "$_d" ] && { _IDF_ENV_DIR="$_d"; break; }
done
[ -n "$_IDF_ENV_DIR" ] && export IDF_PYTHON_ENV_PATH="$_IDF_ENV_DIR"
