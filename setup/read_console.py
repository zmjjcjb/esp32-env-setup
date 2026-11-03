#!/usr/bin/env python3
"""读取 ESP32 串口输出。

用法:
    python read_console.py [串口] [秒数] [--reset]

    --reset   读之前先通过 DTR/RTS 触发一次复位，这样能抓到完整 boot log。
              不加这个参数则只读当前输出（不打断正在运行的程序）。

注意: 想要更干净的输出（带自动解码、错误提示），直接用 `idf.py monitor`。
"""
import sys
import time

import serial

args = [a for a in sys.argv[1:] if a != "--reset"]
do_reset = "--reset" in sys.argv

port = args[0] if len(args) > 0 else "/dev/ttyACM0"
seconds = float(args[1]) if len(args) > 1 else 12.0

s = serial.Serial(port, 115200, timeout=0.2)

if do_reset:
    try:
        s.dtr = False
        s.rts = True
        time.sleep(0.15)
        s.rts = False
    except Exception:
        pass

buf = []
deadline = time.time() + seconds
while time.time() < deadline:
    try:
        chunk = s.read(4096)
        if chunk:
            buf.append(chunk.decode("utf-8", "replace"))
    except Exception as e:
        print(f"[read error] {e}", file=sys.stderr)
        break

s.close()
text = "".join(buf)
sys.stdout.write(text)
if not text.strip():
    print("\n[无输出] 串口没有读到任何数据", file=sys.stderr)
