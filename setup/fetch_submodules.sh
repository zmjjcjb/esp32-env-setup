#!/usr/bin/env bash
# 并行补齐剩余子模块，带重试
set -u
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/esp-idf" || exit 1

git config --global http.postBuffer 524288000
git config --global http.lowSpeedLimit 1000
git config --global http.lowSpeedTime 60

for round in 1 2 3 4 5 6 7 8; do
  missing=$(git submodule status | grep "^-" | awk '{print $2}')
  if [ -z "$missing" ]; then
    echo "===== 全部子模块就绪 (第 ${round} 轮) ====="
    git submodule status
    exit 0
  fi
  echo "--- 第 ${round} 轮，待处理: $(echo "$missing" | grep -c . ) 个 ---"
  for p in $missing; do
    ( timeout 600 git submodule update --init --depth 1 -- "$p" >/dev/null 2>&1 && echo "[完成] $p" || echo "[失败] $p" ) &
  done
  wait
  sleep 5
done

echo "===== 最终状态 ====="
git submodule status
