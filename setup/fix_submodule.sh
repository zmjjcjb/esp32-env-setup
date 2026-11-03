#!/usr/bin/env bash
# 把指定子模块检出到 ESP-IDF 锁定的 commit
# 用法: fix_submodule.sh <子模块路径>
set -u
SUB="$1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../esp-idf" && pwd)"
cd "$ROOT" || exit 1

WANT=$(git ls-tree HEAD "$SUB" | awk '{print $3}')
if [ -z "$WANT" ]; then echo "!! 在父仓库找不到 $SUB"; exit 1; fi
echo "目标 SHA: $WANT  ($SUB)"

cd "$ROOT/$SUB" || exit 1
git remote set-url origin https://github.com/espressif/$(basename "$SUB").git 2>/dev/null
git fetch origin "$WANT" --depth 1 >/dev/null 2>&1
git cat-file -e "$WANT^{commit}" 2>/dev/null || git fetch origin "$WANT" >/dev/null 2>&1
git cat-file -e "$WANT^{commit}" 2>/dev/null || git fetch --unshallow origin >/dev/null 2>&1

if git cat-file -e "$WANT^{commit}" 2>/dev/null; then
    git checkout -q --force "$WANT" && git reset -q --hard "$WANT"
    echo "OK: $(git rev-parse HEAD)"
else
    echo "FAIL: 拿不到 $WANT"
    exit 1
fi
