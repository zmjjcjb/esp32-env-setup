# ESP32 一键流水线的快捷命令
# 由 ~/.bashrc（交互 shell）和 ~/.profile（登录 shell）共同引用

# 完整流水线: 探测 -> 生成配置档 -> 套用工程 -> 编译 -> 烧录 -> 验证
#   board [工程目录] [配置档名] [--no-flash] [--keep]
board() {
    bash "$HOME/esp32/setup/setup_board.sh" "$@"
}

# 只探测，不改任何东西
boardprobe() {
    bash "$HOME/esp32/setup/flash_probe.sh" "$@"
}

# 把已有配置档套用到工程（不重新探测）
boarduse() {
    bash "$HOME/esp32/setup/use_board.sh" "$@"
}

# 列出所有板子配置档
boardlist() {
    local f
    for f in "$HOME"/esp32/setup/boards/*.defaults; do
        [ -e "$f" ] || { echo "(还没有配置档)"; return; }
        printf "  %-24s %s\n" "$(basename "$f" .defaults)" \
            "$(grep -m1 '^# ' "$f" 2>/dev/null | sed 's/^# //')"
    done
}
