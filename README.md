# esp32-env-setup

在 Ubuntu 上把 [ESP-IDF](https://github.com/espressif/esp-idf) 装起来，并解决三件最常见的麻烦事：

1. **板子参数别靠猜** —— Flash 真实容量、PSRAM 有没有、PSRAM 是几线，自动探测并实证
2. **换板子不用重配** —— 每块板子存一份配置档，一套命令套用到任意工程
3. **在没有 root 的环境也能装** —— 免 sudo 装齐 flex/bison/gperf/ccache，绕开 conda 的 Python 版本冲突

配套还送两个固件：**板子参数探测程序** 和 **板载自检程序**（LED 闪烁 + NVS 读写 + 堆内存监测）。

---

## 快速开始

```bash
# 1) 装 ESP-IDF（免 sudo）+ 本工具
git clone https://github.com/zmjjcjb/esp32-env-setup.git
cd esp32-env-setup && ./install.sh

# 2) 插上板子，一条命令搞定：探测 -> 生成配置档 -> 套用工程 -> 编译 -> 烧录 -> 验证
board ~/my_project

# 3) 以后这个板子直接用
boarduse <配置档名> ~/my_project
```

`board` 跑完后会在终端打印本次的完整结论：

```
──── 阶段 1/6  等待板子并识别芯片 ────
  ✓ UART 桥: /dev/ttyUSB0
  Chip is ESP32-S3 (QFN56) (revision v0.2)
  Features: WiFi, BLE, Embedded PSRAM 8MB (AP_3v3)
  目标 target: esp32s3
  Flash 容量: 8MB

──── 阶段 2/6  判定 PSRAM ────
  eFuse 特征串含 'Embedded PSRAM 8MB' -> 板载八线 PSRAM (S3R8 系列固定 OCT)

──── 阶段 3/6  生成分区表与配置档 ────
  已生成 partitions-8mb.csv
  已生成 esp32s3-8mb-oct.defaults

──── 阶段 4/6  套用到工程并编译 ────
  编译成功
  CONFIG_ESPTOOLPY_FLASHSIZE="8MB"
  CONFIG_PARTITION_TABLE_FILENAME="partitions-8mb.csv"

──── 阶段 5/6  烧录 ────
──── 阶段 6/6  读回验证 ────
```

---

## 为什么需要这些

### 板子参数不能靠猜

ESP-IDF 里有两个配置是**和硬件绑死、配错就出事**的：

| 配置 | 配错的后果 |
|---|---|
| `CONFIG_ESPTOOLPY_FLASHSIZE_*` | 偏小 → 分区表被限死，浪费空间；偏大 → 烧写越界失败 |
| `CONFIG_SPIRAM_MODE_QUAD/OCT` | **直接开不了机**（`PSRAM ID read error` + 反复重启），且**没有自动检测** |

`CONFIG_SPIRAM_MODE_QUAD` 还是 ESP32-S3 的**默认值**，所以大多数人会撞上这个坑。

### `esp_flash_get_size()` 会骗人

这个 API 返回的是**编译期 `CONFIG_ESPTOOLPY_FLASHSIZE` 的值**，不是物理容量。
你用 2MB 的默认配置编出来的固件，它就报 2MB —— 哪怕板子上是 16MB。

所以本工具读的是 **JEDEC ID 第 3 字节（容量码）**，这是物理真值：

| JEDEC 容量码 | 0x14 | 0x15 | 0x16 | 0x17 | 0x18 | 0x19 | 0x1A | 0x1B |
|---|---|---|---|---|---|---|---|---|
| 容量 | 1MB | 2MB | 4MB | 8MB | 16MB | 32MB | 64MB | 128MB |

（口径与 esptool 的 `DETECTED_FLASH_SIZES` 表一致）

再叠加一次**跨边界读**夹逼验证：读 `0x7FFFFF` 成功、读 `0x800000` 失败 → 恰好 8MB。

### PSRAM 线数只能靠"配对才能启动"反推

ESP32-S3 的 PSRAM 有四线（QUAD）和八线（OCT）两种，芯片本身**不提供运行时自动检测**。
唯一的判定办法是：**按某个模式编译，能正常启动就说明是这个模式，配错就死循环**。

`setup_board.sh` 就是这么干的 —— 依次试 `oct` → `quad`，把探测固件烧进去看能不能起来。

### `sdkconfig.defaults` 有个顺序坑

`sdkconfig.defaults` **必须在 `idf.py set-target` 之前**放好。
`set-target` 会先生成一份 `sdkconfig`，之后 `defaults` 只对"尚未存在的项"生效 ——
结果就是 flash size 悄悄退回 2MB、分区表退回 `partitions.csv`，而且**不报任何错**。

本工具的 `use_board.sh` 会先备份旧 `sdkconfig` 再重新生成，避免踩这个坑。

---

## 板级配置档

每块板子一份配置档，存放在 `setup/boards/`：

| 档名 | 芯片 | Flash | PSRAM | 说明 |
|---|---|---|---|---|
| `generic` | 任意 ESP32/S3 | 2MB | 关 | **兜底档**：任何板子都能启动，等探测出真实参数再换 |
| `s3-n8r8` | ESP32-S3 | 8MB | 8MB 八线 | 实测板子（WROOM-1-N8R8） |
| `esp32-4mb` | ESP32 原始款 | 4MB | 无 | 实测板子（ESP32-D0WD-V3） |

配置档就是一堆 `CONFIG_xxx=y`，可以直接看、直接改：

```
CONFIG_IDF_TARGET="esp32s3"
CONFIG_ESPTOOLPY_FLASHSIZE_8MB=y
CONFIG_SPIRAM_MODE_OCT=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions-8mb.csv"
```

**这套东西不限于 ESP32**：C3/C6/C5/H2/P4 等换成对应的 target 即可
（`make_sdkconfig_defaults.sh` 最后一个参数就是 target）。

---

## 常用命令

装完后（重开终端或 `source ~/.bashrc`）可用：

| 命令 | 作用 |
|---|---|
| `board [工程目录] [配置档名]` | **完整流水线**：探测 → 生成配置档 → 套用 → 编译 → 烧录 → 验证 |
| `board --no-flash [工程目录]` | 同上，但不烧录 |
| `boardprobe` | 只探测，不改任何东西 |
| `boarduse <档名> [工程目录]` | 把已有配置档套用到工程（不重新探测） |
| `boardlist` | 列出所有板子配置档 |

不想用快捷命令就直接调脚本：

```bash
bash setup/setup_board.sh ~/my_project          # 一键流水线
bash setup/flash_probe.sh                       # 只探测
bash setup/use_board.sh s3-n8r8 ~/my_project    # 套用配置档
bash setup/make_sdkconfig_defaults.sh 16MB oct partitions-16mb.csv out.defaults esp32s3
bash setup/gen_partitions.sh 16                 # 按容量生成分区表
```

---

## VS Code 扩展：状态栏直接看板子信息

仓库里带了一个 VS Code 扩展（`vscode-extension/esp32-board-info/`），
把"这个口上是什么板子、Flash 多大、有没有 PSRAM"直接放到状态栏：

```
master | ESP-IDF v5.5.6 | UART | /dev/ttyUSB0 | ESP32-S3 · 8MB · PSRAM 8MB | esp32s3 | ...
                                                  ↑ ESP32 Board Info 扩展
```

**它解决的是 ESP-IDF 扩展的一个短板**：ESP-IDF 扩展的状态栏串口是**静态配置值**，
拔板子重插后不会刷新，很容易拿着过期的 `/dev/ttyUSB0` 去烧录。

### 两种识别方式

| | 被动扫描 | 主动探测 |
|---|---|---|
| 触发 | 自动，插上就更新状态栏 | 点「探测」按钮 |
| 手段 | 读 `/dev` + sysfs 的 USB VID/PID | esptool 复位板子进 bootloader |
| 副作用 | 无 | **板子会复位一次** |
| 能得到 | "有个 Espressif 设备在 /dev/ttyACM0" | 芯片型号、Flash、PSRAM、MAC、eFuse 特征 |

认芯片型号**必须**让板子进 bootloader，这个副作用绕不过去 —— 所以本扩展把它放在
显式的按钮后面，而不是偷偷进行。

### 安装

```bash
cd vscode-extension/esp32-board-info
npx @vscode/vsce package
code --install-extension esp32-board-info-0.1.0.vsix
```

### 功能

- 状态栏常驻显示芯片型号 / Flash 容量 / PSRAM，插上新板子自动刷新
- 面板里一键探测完整信息：芯片型号、版本、晶振、Flash 厂商/容量/接口/电压、PSRAM、MAC、eFuse 特征、加密状态
- **自动匹配** `setup/boards/` 下对应的配置档，可一键应用到当前工程
- 命令：`ESP32: 板子信息面板` / `扫描串口` / `探测当前串口的芯片` / `应用配置档到当前工程`

核心逻辑有独立测试（不依赖 VS Code）：

```bash
cd vscode-extension/esp32-board-info && node test/test.js
```

---

## 免 root 装 ESP-IDF

很多容器/受限环境里 `sudo` 不可用（内核 `NoNewPrivs=1`），`apt-get install` 装不了
ESP-IDF 需要的 `flex` / `bison` / `gperf` / `ccache` / `dfu-util`。

`install.sh` 走的是免 root 路线：

```bash
apt-get download flex bison gperf ccache dfu-util   # 下载 .deb，不需要 root
dpkg -x xxx.deb tools/root/                          # 解压到用户目录
# 然后把 tools/root/usr/bin 加进 PATH
```

配套还处理了另外两个高频问题：

- **conda 的 Python 版本抢占 PATH** —— ESP-IDF 的 `tools/detect_python.sh` 只认 PATH 里第一个
  `python3`。conda 装在前面时它会去找不存在的 `idf5.5_py3.14_env`。本工具显式指定
  `IDF_PYTHON_ENV_PATH` 绕开，且**不改动**你的 conda 顺序。
- **GitHub 拉不动** —— 主仓库走 gitee 镜像，子模块 URL 改写成 GitHub 绝对地址并带重试。

详见 [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)。

---

## 目录结构

```
esp32-env-setup/
├── install.sh                     # 一键安装 ESP-IDF + 本工具
├── setup/
│   ├── board.sh                   # 快捷命令定义 (board / boardprobe / boarduse / boardlist)
│   ├── setup_board.sh             # ★ 一键流水线（探测->生成->套用->编译->烧录->验证）
│   ├── flash_probe.sh             # 只探测板子参数
│   ├── use_board.sh               # 套用配置档到工程
│   ├── make_sdkconfig_defaults.sh # 按参数生成配置档
│   ├── gen_partitions.sh          # 按 Flash 容量生成分区表
│   ├── detect_board.sh            # 快速读芯片/Flash 信息
│   ├── read_console.py            # 读串口输出
│   ├── idf_env.sh / _idf_env.sh   # 环境变量
│   ├── setup_toolchain.sh         # 免 root 装工具链
│   ├── fetch_submodules.sh / fix_submodule.sh
│   └── boards/                    # 板级配置档
├── vscode-extension/
│   └── esp32-board-info/          # VS Code 扩展：状态栏看板子信息
├── board_probe/                   # 板子参数探测固件
├── esp32_test/                    # 板载自检程序
└── docs/
    ├── ENVIRONMENT.md             # 环境适配详解
    └── TROUBLESHOOTING.md         # 踩坑备忘
```

---

## 探测固件

`board_probe/` 烧到板上后会打印：

```
===== BOARD PROBE =====
IDF version      : v5.5.6
chip model       : esp32s3
chip revision    : 2
cpu cores        : 2
flash size (cfg) : 2097152 bytes (2.0 MB)  <- 编译期 CONFIG_ESPTOOLPY_FLASHSIZE
flash jedec id   : 20 40 17
flash real size  : 8MB  <- JEDEC 容量码，物理真实容量
psram size       : 8388608 bytes (8.0 MB)
psram mode       : OCTAL/八线
MAC (default)    : xx:xx:xx:xx:xx:xx
PROBE_FLASH_SIZE=2097152
PROBE_PSRAM_SIZE=8388608
PROBE_PSRAM_MODE=oct
PROBE_MAC=xx:xx:xx:xx:xx:xx
=====================
```

末尾的 `PROBE_*` 是机器可读标记，脚本靠它做判定。

---

## 板载自检程序

`esp32_test/` 是一个拿来验证板子是否正常的工程：

- 打印芯片 / Flash / MAC / 分区表
- **NVS 读写测试**（验证 Flash 的 NVS 分区真的能用）
- **LED 闪烁**（默认 GPIO2，可在 `sdkconfig.defaults.local` 里改）
- 周期打印剩余堆内存（看有没有泄漏）

---

## 环境要求

- Ubuntu 20.04 / 22.04 / 24.04（其它发行版未测试）
- `git` `cmake` `ninja-build` `python3` `wget` `flex` `bison` `gperf`（后五个本工具可免 root 装）
- ESP-IDF **v5.5.6**（本工具的脚本按这个版本验证过；其它版本大概率可用但未测）

---

## License

MIT
