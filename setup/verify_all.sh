#!/usr/bin/env bash
# 端到端验证：全新 shell -> 新建工程 -> set-target -> 套用板级配置 -> 编译
set -e
. "$(dirname "$0")/_idf_env.sh"

echo "### 1. shell 环境"
echo "  IDF_PATH   = $IDF_PATH"
echo "  idf.py     = $(command -v idf.py)"
idf.py --version 2>&1 | tail -1
echo "  flex       = $(flex --version)"

echo
echo "### 2. 从零创建新工程"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf verify_test
idf.py create-project verify_test > /dev/null
cd verify_test
echo "  OK"

echo "### 3. 套用板级配置"
if [ -f "$HOME/esp32/setup/sdkconfig.defaults" ]; then
    cp "$HOME/esp32/setup/sdkconfig.defaults" sdkconfig.defaults
    echo "  已套用 setup/sdkconfig.defaults"
else
    echo "  未找到 setup/sdkconfig.defaults —— 用默认配置（板级参数待你确认板子型号后再定）"
fi
echo "  OK"

echo "### 4. set-target esp32s3"
idf.py set-target esp32s3 > /dev/null 2>&1
echo "  OK"

echo "### 5. 编译"
idf.py build 2>&1 | tail -8

echo "### 5. 确认板级配置"
grep -E "^CONFIG_(ESPTOOLPY_FLASHSIZE|SPIRAM=|PARTITION_TABLE_FILENAME)" sdkconfig
