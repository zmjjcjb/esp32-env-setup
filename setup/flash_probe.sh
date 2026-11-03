#!/usr/bin/env bash
# 一键探测板子参数（自动识别芯片型号）：
#   1) 等待板子就绪（UART 桥出现，或原生 USB 进 ROM 下载模式）
#   2) esptool 自动识别芯片，读取 Flash 芯片信息
#   3) 按识别到的 target 编译并烧录 board_probe 探测固件
#   4) 复位运行，读取探测输出
#   5) 打印结论
#
# 用法: bash setup/flash_probe.sh [等待秒数，默认120]
set -u

WAIT="${1:-120}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBE=$ROOT/board_probe
PY=$(ls "$HOME"/.espressif/python_env/idf*_env/bin/python 2>/dev/null | head -1)

# 加载 ESP-IDF 环境（非登录 shell 里也可用）
. "$ROOT/setup/_idf_env.sh"

echo "### 阶段 1: 等待板子就绪"
echo "    方式 A（推荐）: 把线插到板子的 UART 口，出现 /dev/ttyUSB* 后脚本自动继续"
echo "    方式 B: 用原生 USB 口时，按住 BOOT 键点一下 RESET，USB 变 303a:1001"
echo

deadline=$(( $(date +%s) + WAIT ))
PORT=""
while [ "$(date +%s)" -lt "$deadline" ]; do
    UART=$(ls /dev/ttyUSB* 2>/dev/null | head -1)
    if [ -n "$UART" ]; then
        PORT="$UART"
        echo "    ✓ 检测到 UART 桥: $PORT"
        break
    fi
    if lsusb 2>/dev/null | grep -q "303a:1001"; then
        PORT=$(ls /dev/ttyACM* 2>/dev/null | head -1)
        if [ -n "$PORT" ]; then
            echo "    ✓ 检测到原生 USB 下载模式: $PORT"
            break
        fi
    fi
    sleep 1
done

if [ -z "$PORT" ]; then
    echo
    echo "超时：没等到板子就绪。"
    echo "  - 插 UART 口时应出现 /dev/ttyUSB0"
    echo "  - 不插时需按住 BOOT + 点 RESET，USB 应变成 303a:1001"
    exit 1
fi

echo
echo "### 阶段 2: 识别芯片并读取 Flash 信息"
"$PY" -m esptool --chip auto -p "$PORT" chip_id 2>&1 \
    | grep -E "^Chip is|^Features:|^MAC:" | head -3
CHIPLINE=$("$PY" -m esptool --chip auto -p "$PORT" chip_id 2>&1 | grep "^Chip is" | head -1)

# "Chip is ESP32-S3 (QFN56) (revision v0.2)" -> 取型号名
CHIPNAME=$(echo "$CHIPLINE" | sed -n 's/^Chip is \([A-Za-z0-9-]*\).*/\1/p')
# esptool 报的型号名形如:
#   "Chip is ESP32-S3 (QFN56) (revision v0.2)"
#   "Chip is ESP32-D0WD-V3 (revision v3.1)"   <- 原始 ESP32 的硅片版本名
#   "Chip is ESP32-C6 (QFN40) (revision v0.1)"
# 按前缀匹配，注意 C61 要排在 C6 前面
case "$CHIPNAME" in
    ESP32-S3*)  TARGET=esp32s3 ;;
    ESP32-S2*)  TARGET=esp32s2 ;;
    ESP32-C61*) TARGET=esp32c61 ;;
    ESP32-C6*)  TARGET=esp32c6 ;;
    ESP32-C5*)  TARGET=esp32c5 ;;
    ESP32-C3*)  TARGET=esp32c3 ;;
    ESP32-C2*)  TARGET=esp32c2 ;;
    ESP32-H2*)  TARGET=esp32h2 ;;
    ESP32-P4*)  TARGET=esp32p4 ;;
    ESP32-H4*)  TARGET=esp32h4 ;;
    ESP32*)     TARGET=esp32 ;;
    *) echo "无法识别的芯片型号: '$CHIPLINE'，请手动处理"; exit 1 ;;
esac
echo "    目标 target: $TARGET"

"$PY" -m esptool --chip auto -p "$PORT" flash_id 2>&1 \
    | grep -E "Manufacturer|Device|Detected flash size|Flash type|Flash voltage" | head -6

echo
echo "### 阶段 3: 编译并烧录探测固件 (target=$TARGET)"
cd "$PROBE" || exit 1
# 探测固件用通用配置（不预设硬件参数），PSRAM 模式由 psram-oct 变体单独验
rm -rf build sdkconfig
grep -v '^CONFIG_IDF_TARGET' sdkconfig.defaults > sdkconfig.defaults.tmp
echo "CONFIG_IDF_TARGET=\"$TARGET\"" >> sdkconfig.defaults.tmp
mv sdkconfig.defaults.tmp sdkconfig.defaults

idf.py set-target "$TARGET" > /tmp/probe_settarget.log 2>&1 \
    || { echo "set-target 失败"; tail -10 /tmp/probe_settarget.log; exit 1; }
idf.py build > /tmp/probe_build.log 2>&1 \
    || { echo "编译失败"; grep -E "error:" /tmp/probe_build.log | head -5; exit 1; }
echo "    编译完成"

idf.py -p "$PORT" flash > /tmp/probe_flash.log 2>&1 \
    || { echo "烧录失败"; tail -10 /tmp/probe_flash.log; exit 1; }
echo "    烧录完成"

echo
echo "### 阶段 4: 读取探测输出"
sleep 3
"$PY" "$ROOT/setup/read_console.py" "$PORT" 20 2>&1 | sed -n '/BOARD PROBE/,/====$/p'

echo
echo "### 阶段 5: 结论"
echo "按上面读到的值生成配置档:"
echo "  bash $ROOT/setup/make_sdkconfig_defaults.sh <Flash> <none|quad|oct> [分区表.csv] [输出文件] $TARGET"
