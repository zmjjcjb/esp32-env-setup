# 让脚本在非登录 shell 里也能找到 ESP-IDF 环境
# 由 setup/ 下的脚本统一 source

_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$_HERE/idf_env.sh" ] && . "$_HERE/idf_env.sh"

if [ -z "${IDF_PATH:-}" ] && [ -f "$_HERE/../esp-idf/export.sh" ]; then
    . "$_HERE/../esp-idf/export.sh" > /dev/null 2>&1
fi

if ! command -v idf.py > /dev/null 2>&1; then
    echo "错误：找不到 idf.py，ESP-IDF 环境没加载成功。" >&2
    echo "  手动执行： . $HOME/esp32/esp-idf/export.sh" >&2
    exit 1
fi
