#!/usr/bin/env bash
# 按板子参数生成 sdkconfig.defaults 模板
#
# 用法: bash setup/make_sdkconfig_defaults.sh <Flash容量> <PSRAM模式> [分区表文件] [输出文件] [目标芯片]
#   Flash容量: 2MB 4MB 8MB 16MB 32MB
#   PSRAM模式: none | quad | oct
#   分区表文件: 工程内的 csv 文件名，默认 partitions-16MiB.csv
#   输出文件:   默认 sdkconfig.defaults
#   目标芯片:   默认 esp32s3（原始 ESP32 传 esp32）
#
# 例:
#   bash setup/make_sdkconfig_defaults.sh 16MB oct partitions-16MiB.csv setup/sdkconfig.defaults esp32s3
#   bash setup/make_sdkconfig_defaults.sh 4MB  none partitions-4mb.csv   setup/sdkconfig.defaults esp32
set -u

FLASH="${1:?需要 Flash 容量，如 16MB}"
PSRAM="${2:?需要 PSRAM 模式，如 none/quad/oct}"
PART="${3:-partitions-16MiB.csv}"
OUT="${4:-sdkconfig.defaults}"
TARGET="${5:-esp32s3}"

case "$FLASH" in
    1MB|2MB|4MB|8MB|16MB|32MB|64MB|128MB) ;;
    *) echo "Flash 容量非法: $FLASH"; exit 1 ;;
esac

case "$TARGET" in
    esp32|esp32s2|esp32s3|esp32c2|esp32c3|esp32c5|esp32c6|esp32c61|esp32h2|esp32p4|esp32h4) ;;
    *) echo "目标芯片非法: $TARGET"; exit 1 ;;
esac

{
cat <<EOF
# 自动生成的板级配置模板
# 目标芯片: $TARGET   Flash: $FLASH   PSRAM: $PSRAM   分区表: $PART
# 生成命令: bash setup/make_sdkconfig_defaults.sh $FLASH $PSRAM $PART $(basename "$OUT") $TARGET
#
# 用法: cp $(basename "$OUT") <新工程>/sdkconfig.defaults
#       注意必须在 \`idf.py set-target\` 之前复制，否则不生效。

CONFIG_IDF_TARGET="$TARGET"

# ---- Flash: $FLASH ----
CONFIG_ESPTOOLPY_FLASHMODE_QIO=y
CONFIG_ESPTOOLPY_FLASHMODE="dio"
CONFIG_ESPTOOLPY_FLASHFREQ_80M=y
CONFIG_ESPTOOLPY_FLASHFREQ="80m"
CONFIG_ESPTOOLPY_FLASHSIZE_${FLASH}=y
CONFIG_ESPTOOLPY_FLASHSIZE="$FLASH"
EOF

case "$PSRAM" in
    none)
        echo "" >> "$OUT"
        echo "# ---- 无 PSRAM ----" >> "$OUT"
        echo "# CONFIG_SPIRAM is not set" >> "$OUT"
        ;;
    quad)
cat <<'EOF'

# ---- PSRAM: Quad (四线 QPI) ----
CONFIG_SPIRAM=y
CONFIG_SPIRAM_MODE_QUAD=y
CONFIG_SPIRAM_TYPE_AUTO=y
CONFIG_SPIRAM_SPEED_80M=y
CONFIG_SPIRAM_SPEED=80
CONFIG_SPIRAM_USE_MALLOC=y
CONFIG_SPIRAM_MEMTEST=y
EOF
        # SPIRAM_CLK_IO / SPIRAM_CS_IO 只有 esp32s3 才有，原始 esp32 用 SPIWP 引脚
        if [ "$TARGET" = "esp32s3" ]; then
            cat <<'EOF'
CONFIG_SPIRAM_CLK_IO=30
CONFIG_SPIRAM_CS_IO=26
EOF
        fi
        ;;
    oct)
cat <<'EOF'

# ---- PSRAM: Octal (八线 OPI) ----
# 注意: 八线 PSRAM 会占用 GPIO35/36/37，这三个引脚不可用
#       原始 ESP32 (esp32 target) 的 PSRAM 是外挂芯片且仅支持四线，不支持 OCT
CONFIG_SPIRAM=y
CONFIG_SPIRAM_MODE_OCT=y
CONFIG_SPIRAM_TYPE_AUTO=y
CONFIG_SPIRAM_SPEED_80M=y
CONFIG_SPIRAM_SPEED=80
CONFIG_SPIRAM_USE_MALLOC=y
CONFIG_SPIRAM_MEMTEST=y
EOF
        if [ "$TARGET" = "esp32s3" ]; then
            cat <<'EOF'
CONFIG_SPIRAM_CLK_IO=30
CONFIG_SPIRAM_CS_IO=26
EOF
        fi
        ;;
    *)
        echo "PSRAM 模式非法: $PSRAM (应为 none/quad/oct)"; exit 1 ;;
esac

cat <<EOF

# ---- 分区表: $PART ----
# Kconfig 中真正决定文件名的是 PARTITION_TABLE_CUSTOM_FILENAME，两者都要写。
CONFIG_PARTITION_TABLE_CUSTOM=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="$PART"
CONFIG_PARTITION_TABLE_FILENAME="$PART"
CONFIG_PARTITION_TABLE_OFFSET=0x8000
EOF
} > "$OUT"

echo "已生成: $OUT  (目标 $TARGET / $FLASH / PSRAM=$PSRAM)"
