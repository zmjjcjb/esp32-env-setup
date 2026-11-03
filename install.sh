#!/usr/bin/env bash
# 一键安装 ESP-IDF + 本工具
#
#   ./install.sh              # 装 ESP-IDF v5.5.6 + 本工具
#   ./install.sh --no-idf     # 只装本工具（ESP-IDF 已经有了）
#
# 设计要点:
#   - 不需要 root: flex/bison/gperf/ccache/dfu-util 用 apt-get download + dpkg -x 装到用户目录
#   - 强制使用系统 python3: conda 的新版 python 会被 detect_python.sh 误选
#   - GitHub 不稳时走 gitee 镜像 + 重试
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${ESP32_ROOT:-$HOME/esp32}"
IDF_VERSION="${IDF_VERSION:-v5.5.6}"
IDF_BRANCH="${IDF_BRANCH:-release/v5.5}"
TOOLS_PREFIX="$ROOT/tools/root"

SKIP_IDF=0
[ "${1:-}" = "--no-idf" ] && SKIP_IDF=1

hr() { printf '\n\033[1m──── %s ────\033[0m\n' "$1"; }

# ─────────────────────────────────────────────────────────────
hr "检查基础依赖"

MISSING=""
for c in git cmake ninja python3 wget dpkg apt-get; do
    command -v "$c" > /dev/null 2>&1 || MISSING="$MISSING $c"
done
if [ -n "$MISSING" ]; then
    echo "缺少命令:$MISSING"
    echo "请先安装（需要 root）: sudo apt-get install git cmake ninja-build python3 wget"
    exit 1
fi
echo "  git     : $(git --version)"
echo "  cmake   : $(cmake --version | head -1)"
echo "  ninja   : $(ninja --version)"
echo "  python3 : $(python3 --version 2>&1) ($(command -v python3))"

if command -v sudo > /dev/null 2>&1 && sudo -n true 2>/dev/null; then
    HAVE_SUDO=1
    echo "  sudo    : 可用"
else
    HAVE_SUDO=0
    echo "  sudo    : 不可用 -> 走免 root 路线"
fi

# ─────────────────────────────────────────────────────────────
hr "安装 flex / bison / gperf / ccache / dfu-util"

need_pkgs() {
    for p in flex bison gperf ccache dfu-util; do
        command -v "$p" > /dev/null 2>&1 || return 0
    done
    return 1
}

install_pkgs_rootless() {
    local LISTDIR="$ROOT/tools/.aptlists"
    local SRCLIST="$ROOT/tools/.apt-sources.list"
    local MIRROR="${APT_MIRROR:-https://mirrors.aliyun.com/ubuntu}"

    mkdir -p "$LISTDIR/partial" "$ROOT/tools/debs"
    # 换用国内镜像（官方源在部分网络下很慢），无需改 /etc/apt/sources.list
    {
        echo "deb $MIRROR/ jammy main restricted universe multiverse"
        echo "deb $MIRROR/ jammy-updates main restricted universe multiverse"
        echo "deb $MIRROR/ jammy-security main restricted universe multiverse"
    } > "$SRCLIST"

    echo "  更新包索引（镜像: $MIRROR）..."
    apt-get update \
        -o Dir::Etc::sourcelist="$SRCLIST" \
        -o Dir::Etc::sourceparts=/dev/null \
        -o Dir::State::Lists="$LISTDIR" \
        -o APT::Get::List-Cleanup=0 > /dev/null 2>&1

    echo "  下载 deb..."
    cd "$ROOT/tools/debs" || return 1
    apt-get download \
        -o Dir::Etc::sourcelist="$SRCLIST" \
        -o Dir::Etc::sourceparts=/dev/null \
        -o Dir::State::Lists="$LISTDIR" \
        flex bison gperf ccache dfu-util > /dev/null 2>&1

    mkdir -p "$TOOLS_PREFIX"
    for d in ./*.deb; do
        [ -e "$d" ] || continue
        dpkg -x "$d" "$TOOLS_PREFIX/" 2>/dev/null
    done
    cd "$ROOT" || return 1
}

if need_pkgs; then
    if [ "$HAVE_SUDO" -eq 1 ]; then
        echo "  用 sudo 安装..."
        sudo apt-get install -y flex bison gperf ccache dfu-util
    else
        echo "  免 root 安装..."
        install_pkgs_rootless
    fi
    export PATH="$TOOLS_PREFIX/usr/bin:$PATH"
    export LD_LIBRARY_PATH="$TOOLS_PREFIX/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    for p in flex bison gperf ccache dfu-util; do
        command -v "$p" > /dev/null 2>&1 \
            && echo "  ✓ $p" \
            || echo "  ✗ $p 装不上（后面编译可能失败）"
    done
else
    echo "  已全部就绪"
fi

# ─────────────────────────────────────────────────────────────
if [ "$SKIP_IDF" -eq 0 ]; then
    hr "获取 ESP-IDF $IDF_VERSION"

    mkdir -p "$ROOT"
    cd "$ROOT" || exit 1

    if [ -d "esp-idf/.git" ]; then
        echo "  已存在 esp-idf，跳过克隆"
    else
        # 国内网络优先用 gitee 镜像；失败再试 GitHub
        CLONE_OK=0
        for URL in "https://gitee.com/EspressifSystems/esp-idf.git" \
                   "https://github.com/espressif/esp-idf.git"; do
            echo "  尝试克隆: $URL"
            if timeout 1800 git clone --branch "$IDF_VERSION" --depth 1 --recursive --shallow-submodules \
                "$URL" esp-idf > /tmp/idf_clone.log 2>&1; then
                CLONE_OK=1
                break
            fi
            echo "    失败，换下一个源"
            rm -rf esp-idf
        done
        [ "$CLONE_OK" -eq 0 ] && { echo "克隆失败，日志: /tmp/idf_clone.log"; exit 1; }
    fi

    cd "$ROOT/esp-idf" || exit 1

    hr "初始化子模块"
    # .gitmodules 里是相对 URL（../../owner/repo.git），从 gitee 克隆会解析到需要认证的路径，
    # 所以统一改写成 GitHub 绝对地址
    python3 - <<'PY' 2>/dev/null || true
import re, pathlib
p = pathlib.Path('.gitmodules')
t = p.read_text()
new = re.sub(r'url\s*=\s*\.\./\.\./([^/\s]+/[^/\s]+)\.git', r'url = https://github.com/\1.git', t)
p.write_text(new)
PY
    git submodule sync --recursive > /dev/null 2>&1
    bash "$HERE/setup/fetch_submodules.sh" || echo "  ⚠ 有子模块没拉下来（见上），可稍后重试"

    hr "安装工具链（target: esp32s3）"
    # 强制系统 python：PATH 里第一个 python3 会被 detect_python.sh 选中，
    # conda 的新版本 python 会导致装出错误的 venv
    PATH="/usr/bin:$PATH" \
    IDF_GITHUB_ASSETS="dl.espressif.cn/github_assets" \
    LD_LIBRARY_PATH="$TOOLS_PREFIX/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
        bash ./install.sh esp32s3
fi

# ─────────────────────────────────────────────────────────────
hr "接入 shell 环境"

for RC in "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$RC" ] || touch "$RC"
    if grep -q "esp32/setup/board.sh" "$RC"; then
        echo "  $(basename "$RC") 已配置"
        continue
    fi
    cat >> "$RC" <<'EOF'

# >>> ESP32 开发环境 (ESP-IDF) >>>
[ -f "$HOME/esp32/setup/idf_env.sh" ] && . "$HOME/esp32/setup/idf_env.sh"
alias get_idf='. $HOME/esp32/esp-idf/export.sh'
[ -f "$HOME/esp32/setup/board.sh" ] && . "$HOME/esp32/setup/board.sh"
# <<< ESP32 开发环境 <<<
EOF
    echo "  已写入 $(basename "$RC")"
done

hr "完成"

cat <<EOF
  ESP-IDF  : $ROOT/esp-idf
  本工具   : $HERE

  重新打开终端后可用:
    board [工程目录]        # 一键流水线
    boardprobe              # 只探测板子
    boardlist               # 列出板子配置档

  现在就可以插上板子跑:
    board ~/my_project
EOF
