#!/usr/bin/env bash
# 把某个板子配置档套用到工程上
#
# 用法: bash setup/use_board.sh <配置档名> [工程目录]
#   配置档名: setup/boards/ 下的文件名（不含 .defaults）
#   例: bash setup/use_board.sh s3-n8r8 ~/my_project
#
# 已有列表:
#   generic   - 通用安全默认（2MB Flash, 不开 PSRAM），任何 S3 板都能跑
#   s3-n8r8   - 本机实测板子（8MB Flash + 8MB 八线 PSRAM）
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:?需要配置档名，如 s3-n8r8}"
PROJ="${2:-$ROOT/${PROFILE}-project}"

# 加载 ESP-IDF 环境（非登录 shell 里也可用）
. "$ROOT/setup/_idf_env.sh"

SRC="$ROOT/setup/boards/${PROFILE}.defaults"
if [ ! -f "$SRC" ]; then
    echo "找不到配置档: $SRC"
    echo "可用配置档:"
    ls "$ROOT/setup/boards/"*.defaults 2>/dev/null | while read -r f; do
        echo "  $(basename "$f" .defaults)"
    done
    exit 1
fi

echo "配置档 : $PROFILE"
echo "工程   : $PROJ"

if [ ! -d "$PROJ" ]; then
    echo "工程不存在，创建: $PROJ"
    mkdir -p "$PROJ"
fi

# 空目录 / 没有 CMakeLists.txt 时，先用官方模板建一个工程
if [ ! -f "$PROJ/CMakeLists.txt" ]; then
    NAME=$(basename "$PROJ")
    echo "目录里没有工程，先用官方模板创建 ($NAME) ..."
    # 注意: create-project 传绝对路径会把路径当成工程名，
    # 所以在临时目录里按名字创建，再把内容拷到目标目录
    TMPD=$(mktemp -d)
    ( cd "$TMPD" && idf.py create-project "$NAME" > /dev/null 2>&1 ) \
        || { echo "创建工程失败"; rm -rf "$TMPD"; exit 1; }
    cp -r "$TMPD/$NAME/." "$PROJ/"
    rm -rf "$TMPD"
fi

# 1) 放 sdkconfig.defaults（必须在 set-target 之前）
cp "$SRC" "$PROJ/sdkconfig.defaults"
echo "已写入 sdkconfig.defaults"

# 1b) 工程专属的额外配置叠加在板子配置档之后
if [ -f "$PROJ/sdkconfig.defaults.local" ]; then
    cat "$PROJ/sdkconfig.defaults.local" >> "$PROJ/sdkconfig.defaults"
    echo "已叠加工程额外配置 sdkconfig.defaults.local"
fi

# 2) 配置档里引用了自定义分区表就一并复制
PART=$(grep -oE 'CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="[^"]+"' "$SRC" \
       | sed 's/.*="//; s/"//' || true)
if [ -n "$PART" ] && [ -f "$ROOT/setup/boards/$PART" ]; then
    cp "$ROOT/setup/boards/$PART" "$PROJ/$PART"
    echo "已复制分区表 $PART"
fi

# 3) 已存在的 sdkconfig 会让 defaults 失效（只对"尚未存在的项"生效），
#    所以备份后重新生成，保证配置真的落地
if [ -f "$PROJ/sdkconfig" ]; then
    BACKUP="$PROJ/sdkconfig.$(date +%Y%m%d-%H%M%S).bak"
    mv "$PROJ/sdkconfig" "$BACKUP"
    echo "旧 sdkconfig 已备份到: $(basename "$BACKUP")"
    echo "  (如需保留旧的手工修改，从备份里挑着改回来)"
fi

# 4) 重新生成并编译
cd "$PROJ" || exit 1
TARGET=$(grep -oE 'CONFIG_IDF_TARGET="[^"]+"' "$SRC" | sed 's/.*="//; s/"//')
TARGET="${TARGET:-esp32s3}"

# set-target 会强制 fullclean，但残留的半成品 build/ 目录会让它拒绝删除
# （"doesn't seem to be a CMake build directory"），所以先手动清掉
rm -rf build

echo "set-target $TARGET ..."
idf.py set-target "$TARGET" > /tmp/use_board_settarget.log 2>&1 \
    || { echo "set-target 失败，日志: /tmp/use_board_settarget.log";
         tail -15 /tmp/use_board_settarget.log; exit 1; }

echo "编译中 ..."
if idf.py build > /tmp/use_board_build.log 2>&1; then
    echo "编译成功"
    grep -E "^CONFIG_(ESPTOOLPY_FLASHSIZE=|SPIRAM=|PARTITION_TABLE_FILENAME)" sdkconfig
else
    echo "编译失败，日志: /tmp/use_board_build.log"
    tail -20 /tmp/use_board_build.log
    exit 1
fi
