#!/usr/bin/env bash
# 一键流水线: 探测板子 -> 生成配置档 -> 套用工程 -> 编译 -> 烧录 -> 验证
#
# 用法:
#   bash setup/setup_board.sh                      # 工程目录 = 当前目录
#   bash setup/setup_board.sh my_project           # 指定工程目录(不存在则创建)
#   bash setup/setup_board.sh my_project myboard   # 再指定配置档名(默认按参数自动命名)
#
# 选项:
#   --no-flash   只探测+生成配置档+编译，不烧录
#   --keep       不改动已有配置档(已存在同名档时不覆盖)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP=$ROOT/setup
PROBE=$ROOT/board_probe
PY=$(ls "$HOME"/.espressif/python_env/idf*_env/bin/python 2>/dev/null | head -1)

DO_FLASH=1
KEEP=0
POSITIONAL=()
for a in "$@"; do
    case "$a" in
        --no-flash) DO_FLASH=0 ;;
        --keep)     KEEP=1 ;;
        *)          POSITIONAL+=("$a") ;;
    esac
done

PROJ="${POSITIONAL[0]:-$PWD}"
NAME="${POSITIONAL[1]:-}"

. "$SETUP/_idf_env.sh"

hr() { printf '\n\033[1m──── %s ────\033[0m\n' "$1"; }

# ─────────────────────────────────────────────────────────────
hr "阶段 1/6  等待板子并识别芯片"

PORT=""
deadline=$(( $(date +%s) + 60 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
    UART=$(ls /dev/ttyUSB* 2>/dev/null | head -1)
    if [ -n "$UART" ]; then PORT="$UART"; echo "  ✓ UART 桥: $PORT"; break; fi
    if lsusb 2>/dev/null | grep -q "303a:1001"; then
        PORT=$(ls /dev/ttyACM* 2>/dev/null | head -1)
        [ -n "$PORT" ] && { echo "  ✓ 原生 USB 下载模式: $PORT"; break; }
    fi
    sleep 1
done
[ -z "$PORT" ] && { echo "超时：没等到板子。插 UART 口，或按住 BOOT 点 RESET。" >&2; exit 1; }

CHIPLINE=$("$PY" -m esptool --chip auto -p "$PORT" chip_id 2>&1 | grep "^Chip is" | head -1)
FEATURES=$("$PY" -m esptool --chip auto -p "$PORT" chip_id 2>&1 | grep "^Features:" | head -1)
echo "  $CHIPLINE"
echo "  $FEATURES"

CHIPNAME=$(echo "$CHIPLINE" | sed -n 's/^Chip is \([A-Za-z0-9-]*\).*/\1/p')
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
    *) echo "无法识别的芯片: $CHIPLINE" >&2; exit 1 ;;
esac
echo "  目标 target: $TARGET"

FLASHSIZE=$("$PY" -m esptool --chip auto -p "$PORT" flash_id 2>&1 \
            | grep "Detected flash size" | sed -n 's/.*: \([0-9]*\)MB.*/\1/p' | head -1)
[ -z "$FLASHSIZE" ] && { echo "读不到 Flash 容量" >&2; exit 1; }
echo "  Flash 容量: ${FLASHSIZE}MB"

# ─────────────────────────────────────────────────────────────
hr "阶段 2/6  判定 PSRAM"

# eFuse 里带 "Embedded PSRAM" 说明是 S3R8 这类 die-bonded 的，固定八线
PSRAM_MODE=none
PSRAM_EFUSE=$(echo "$FEATURES" | grep -oE "Embedded PSRAM [0-9]+MB" | head -1)
if [ -n "$PSRAM_EFUSE" ]; then
    PSRAM_MODE=oct
    echo "  eFuse 特征串含 '$PSRAM_EFUSE' -> 板载八线 PSRAM (S3R8 系列固定 OCT)"
else
    echo "  eFuse 未报板载 PSRAM，实测一下（要烧几次探测固件，稍慢）..."
    # 依次尝试各模式：能正常启动并报出容量 -> 就是这个模式
    if [ "$TARGET" = "esp32s3" ]; then MODES="oct quad"; else MODES="quad"; fi
    for mode in $MODES; do
        cd "$PROBE" || exit 1
        rm -rf build sdkconfig
        grep -v '^CONFIG_IDF_TARGET' sdkconfig.defaults > sdkconfig.defaults.tmp
        echo "CONFIG_IDF_TARGET=\"$TARGET\"" >> sdkconfig.defaults.tmp
        if [ "$mode" = "oct" ]; then
            cat sdkconfig.defaults.psram-oct | grep -v '^CONFIG_IDF_TARGET' >> sdkconfig.defaults.tmp
        else
            {
                echo "CONFIG_SPIRAM=y"
                echo "CONFIG_SPIRAM_MODE_QUAD=y"
                echo "CONFIG_SPIRAM_TYPE_AUTO=y"
                echo "CONFIG_SPIRAM_SPEED_80M=y"
                echo "CONFIG_SPIRAM_SPEED=80"
                echo "CONFIG_SPIRAM_CLK_IO=30"
                echo "CONFIG_SPIRAM_CS_IO=26"
                echo "CONFIG_SPIRAM_USE_MALLOC=y"
                echo "CONFIG_SPIRAM_MEMTEST=y"
            } >> sdkconfig.defaults.tmp
        fi
        mv sdkconfig.defaults.tmp sdkconfig.defaults
        idf.py set-target "$TARGET" > /dev/null 2>&1
        if ! idf.py build > /tmp/sb_probe_build.log 2>&1; then
            echo "    [$mode] 编译失败，跳过"
            continue
        fi
        idf.py -p "$PORT" flash > /tmp/sb_probe_flash.log 2>&1 || continue
        sleep 3
        # 串口可能混进二进制数据，去掉 null 字节再解析
        OUT=$("$PY" "$SETUP/read_console.py" "$PORT" 12 2>/dev/null | tr -d '\0')
        SZ=$(echo "$OUT" | grep -oE "PROBE_PSRAM_SIZE=[0-9]+" | cut -d= -f2 | head -1)
        if [ -n "$SZ" ] && [ "$SZ" -gt 0 ] 2>/dev/null; then
            PSRAM_MODE=$mode
            PSRAM_BYTES=$SZ
            echo "    [$mode] 启动成功，PSRAM ${SZ} bytes -> 模式 $mode"
            break
        elif [ -n "$SZ" ]; then
            PSRAM_MODE=none
            echo "    [$mode] 启动成功但无 PSRAM -> 该板无 PSRAM"
            break
        else
            echo "    [$mode] 没跑起来（开了 PSRAM 但板子上没有/模式不符），换下一个模式"
        fi
    done
    if [ "$PSRAM_MODE" = "none" ]; then
        echo "  结论: 没有可用 PSRAM（所有模式都起不来 -> 板上没有 PSRAM）"
    fi
fi

# ─────────────────────────────────────────────────────────────
hr "阶段 3/6  生成分区表与配置档"

PART="partitions-${FLASHSIZE}mb.csv"
bash "$SETUP/gen_partitions.sh" "$FLASHSIZE" "$SETUP/boards/$PART" | sed 's/^/  /'

[ -z "$NAME" ] && NAME="${TARGET}-${FLASHSIZE}mb"
[ "$PSRAM_MODE" != "none" ] && NAME="${NAME}-${PSRAM_MODE}"
PROFILE="$SETUP/boards/${NAME}.defaults"

if [ -f "$PROFILE" ] && [ "$KEEP" -eq 1 ]; then
    echo "  配置档已存在且指定了 --keep，跳过生成: $(basename "$PROFILE")"
else
    bash "$SETUP/make_sdkconfig_defaults.sh" "${FLASHSIZE}MB" "$PSRAM_MODE" "$PART" "$PROFILE" "$TARGET" \
        | sed 's/^/  /'
    echo "  已生成配置档: $(basename "$PROFILE")"
fi

# ─────────────────────────────────────────────────────────────
hr "阶段 4/6  套用到工程并编译"

if [ ! -f "$PROJ/CMakeLists.txt" ]; then
    mkdir -p "$PROJ"
    TMPD=$(mktemp -d)
    ( cd "$TMPD" && idf.py create-project "$(basename "$PROJ")" > /dev/null 2>&1 )
    cp -r "$TMPD/$(basename "$PROJ")/." "$PROJ/"
    rm -rf "$TMPD"
    echo "  已创建工程: $PROJ"
fi

cp "$PROFILE" "$PROJ/sdkconfig.defaults"
if [ -f "$PROJ/sdkconfig.defaults.local" ]; then
    cat "$PROJ/sdkconfig.defaults.local" >> "$PROJ/sdkconfig.defaults"
    echo "  已叠加工程额外配置"
fi
cp "$SETUP/boards/$PART" "$PROJ/$PART"

cd "$PROJ" || exit 1
[ -f sdkconfig ] && mv sdkconfig "sdkconfig.$(date +%Y%m%d-%H%M%S).bak"
rm -rf build
idf.py set-target "$TARGET" > /tmp/sb_settarget.log 2>&1 \
    || { echo "set-target 失败:"; tail -10 /tmp/sb_settarget.log; exit 1; }
idf.py build > /tmp/sb_build.log 2>&1 \
    || { echo "编译失败:"; grep -E "error:" /tmp/sb_build.log | head -8; exit 1; }
echo "  编译成功"
grep -E "^CONFIG_(ESPTOOLPY_FLASHSIZE=|SPIRAM=|PARTITION_TABLE_FILENAME)" sdkconfig | sed 's/^/  /'

# ─────────────────────────────────────────────────────────────
if [ "$DO_FLASH" -eq 1 ]; then
    hr "阶段 5/6  烧录"
    idf.py -p "$PORT" flash > /tmp/sb_flash.log 2>&1 \
        || { echo "烧录失败:"; tail -10 /tmp/sb_flash.log; exit 1; }
    echo "  烧录完成"

    hr "阶段 6/6  读回验证"
    sleep 3
    "$PY" "$SETUP/read_console.py" "$PORT" 12 2>/dev/null | tr -d '\0' | head -30 | sed 's/^/  /'
else
    hr "完成（--no-flash，跳过烧录）"
fi

cat <<EOF

════════════════════════════════════════
  配置档 : $(basename "$PROFILE")
  工程   : $PROJ
  串口   : $PORT
  target : $TARGET / Flash ${FLASHSIZE}MB / PSRAM $PSRAM_MODE

  以后这个板子直接:
    bash $SETUP/use_board.sh $NAME <工程目录>
════════════════════════════════════════
EOF
