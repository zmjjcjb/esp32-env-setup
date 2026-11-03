#!/usr/bin/env bash
# 探测已连接的 ESP32-S3 开发板：读 Flash 芯片信息（容量/厂商），并给出 PSRAM 模式判定方法。
#
# 用法: bash setup/detect_board.sh [串口]
#   串口省略时自动扫描 /dev/ttyUSB* /dev/ttyACM*
set -u

PORT="${1:-}"
if [ -z "$PORT" ]; then
    PORT=$(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | head -1)
    if [ -z "$PORT" ]; then
        echo "未找到串口设备。插板后执行：ls /dev/ttyUSB* /dev/ttyACM*"
        echo "若出现权限错误：sudo usermod -a -G dialout \$USER  （本机用户已在 dialout 组，一般不需要）"
        exit 1
    fi
fi

echo "串口: $PORT"
echo

ESR=$(ls "$HOME"/.espressif/python_env/idf*_env/bin/python 2>/dev/null | head -1)
if [ -z "$ESR" ]; then
    echo "找不到 ESP-IDF 的 python venv，先执行 get_idf"
    exit 1
fi

echo "=== 芯片与 Flash 芯片信息 ==="
"$ESR" -m esptool --chip auto -p "$PORT" chip_id 2>&1 | grep -viE "^warning|^$" | head -12
"$ESR" -m esptool --chip auto -p "$PORT" flash_id 2>&1 | grep -viE "^warning|^$" | head -12

cat <<'EOF'

=== Flash 容量 → 改 sdkconfig.defaults ===
  1MB  -> CONFIG_ESPTOOLPY_FLASHSIZE_1MB=y
  2MB  -> CONFIG_ESPTOOLPY_FLASHSIZE_2MB=y
  4MB  -> CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y
  8MB  -> CONFIG_ESPTOOLPY_FLASHSIZE_8MB=y
  16MB -> CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y

=== PSRAM 模式 → 看模组丝印（无自动检测，配错会开不了机）===
  ESP32-S3-WROOM-1-N8 / N16    无 PSRAM   -> 不开 CONFIG_SPIRAM
  ESP32-S3-WROOM-1-N8R2        Quad 2MB   -> CONFIG_SPIRAM_MODE_QUAD=y
  ESP32-S3-WROOM-1-N16R8       Octal 8MB  -> CONFIG_SPIRAM_MODE_OCT=y
  型号里的 V 指 Flash 是八线 SPI，不是 PSRAM 八线。

  不确定时的判定法：
    1) 先按 QUAD 编译烧录，若串口刷不出 "PSRAM ID read error" 说明对了
    2) 若报错/反复重启，改成 OCT 重编一次
EOF
