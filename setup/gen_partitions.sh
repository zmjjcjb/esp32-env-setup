#!/usr/bin/env bash
# 按 Flash 容量生成分区表 CSV
#
# 用法: bash setup/gen_partitions.sh <Flash容量MB> [输出文件]
#   例: bash setup/gen_partitions.sh 8
#       bash setup/gen_partitions.sh 16 /tmp/partitions-16mb.csv
#
# 布局:
#   nvs       0x9000   24KB
#   phy_init  0xf000    4KB
#   factory   0x10000  app 区（按容量给 1~4MB）
#   storage   其余全部给 spiffs
set -u

MB="${1:?需要 Flash 容量(MB)，如 8}"
OUT="${2:-partitions-${MB}mb.csv}"

case "$MB" in
    1|2|4|8|16|32|64|128) ;;
    *) echo "Flash 容量非法: $MB"; exit 1 ;;
esac

TOTAL=$(( MB * 1024 * 1024 ))

# app 分区大小：容量越大给越多，但至少留 1.5MB 给数据区
case "$MB" in
    1|2|4)  APP=$(( 1024 * 1024 )) ;;
    8)      APP=$(( 1536 * 1024 )) ;;
    16)     APP=$(( 2 * 1024 * 1024 )) ;;
    32)     APP=$(( 3 * 1024 * 1024 )) ;;
    64|128) APP=$(( 4 * 1024 * 1024 )) ;;
esac

STORAGE_OFF=$(( 0x10000 + APP ))
STORAGE=$(( TOTAL - STORAGE_OFF ))
# 向下取整到 4KB
STORAGE=$(( STORAGE / 0x1000 * 0x1000 ))

if [ "$STORAGE" -lt 4096 ]; then
    echo "容量 ${MB}MB 装不下这个布局，请改用更小的 app 分区" >&2
    exit 1
fi

cat > "$OUT" <<EOF
# ${MB}MB Flash 分区表 (自动生成)
# Name, Type, SubType, Offset, Size, Flags
nvs,      data, nvs,     0x9000,  0x6000,
phy_init, data, phy,     0xf000,  0x1000,
factory,  app,  factory, 0x10000, $(printf '0x%X' $APP),
storage,  data, spiffs,  $(printf '0x%X' $STORAGE_OFF), $(printf '0x%X' $STORAGE),
EOF

echo "已生成 $OUT"
echo "  总容量 ${MB}MB / app $(printf '0x%X' $APP) / storage $(printf '0x%X' $STORAGE) (偏移 $(printf '0x%X' $STORAGE_OFF))"
