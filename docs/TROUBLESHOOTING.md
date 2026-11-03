# 踩坑备忘

按"症状 → 原因 → 解决"组织，都是实际遇到过的问题。

---

## 编译期

### `Include directory '.../components/heap/tlsf/include' is not a directory`

**原因**：子模块用 `--depth 1` 克隆，停在分支 tip 而不是 ESP-IDF 锁定的 commit，
工作区其实是空的。

```bash
git submodule status | grep "^+"    # 带 + 的是不匹配的
```

**解决**：对齐到锁定的 SHA，见 [`ENVIRONMENT.md` §3.4](ENVIRONMENT.md#34---depth-1-会让子模块停在分支-tip)。

---

### `The target name "/path/to/proj.elf" is reserved or not valid`

**原因**：`idf.py create-project` 传了**绝对路径**，它把路径当成了工程名。

**解决**：在临时目录里按名字创建，再把内容拷过去。

```bash
TMPD=$(mktemp -d)
(cd "$TMPD" && idf.py create-project myproj)
cp -r "$TMPD/myproj/." /目标/目录/
```

---

### `Directory '.../build' doesn't seem to be a CMake build directory. Refusing to automatically delete`

**原因**：残留的半成品 `build/` 目录（工程还没建好时执行过 `set-target` 留下的）。
`set-target` 会强制 fullclean，但遇到这种目录会拒绝删。

**解决**：`rm -rf build` 之后再 `set-target`。

---

### 编译成功，但 flash size 是 2MB、分区表是 `partitions.csv`

**原因**：`sdkconfig.defaults` 放晚了。`idf.py set-target` 先生成了一份 `sdkconfig`，
之后 `defaults` 只对**尚未存在的项**生效，所以什么都没改到，而且**不报错**。

**解决**：`sdkconfig.defaults` 必须放在 `set-target` **之前**；
或者删掉已有的 `sdkconfig` 重新生成。用 `use_board.sh` 会自动处理。

---

### `undefined reference to esp_psram_get_size`

**原因**：编译时没开 `CONFIG_SPIRAM`，相关 API 没编进来。

**解决**：用 `#if CONFIG_SPIRAM` 把调用包起来。

---

### `the comparison will always evaluate as 'true' for the address of 'label' will never be NULL`

**原因**：`esp_partition_t.label` 是固定数组不是指针，`p->label ? ... : ...` 恒真。

**解决**：直接用 `p->label`。

---

## 运行期

### 板子反复重启，串口刷 `PSRAM ID read error: 0x00000000`

**原因**：PSRAM 线数模式配错。ESP32-S3 默认是 `SPIRAM_MODE_QUAD`，
而八线 PSRAM 的板子必须显式设 `SPIRAM_MODE_OCT`。**没有自动检测，配错就开不了机。**

**解决**：见 [`README.md` 的 PSRAM 判定](README.md#psram-线数只能靠配对才能启动反推)。
临时快速试：把 `SPIRAM_MODE_OCT` 改成 `SPIRAM_MODE_QUAD` 重编一次。

---

### 板子完全起不来，串口一片乱码

**原因**（两个，都常见）：

1. **波特率/晶振不匹配** —— 查实际晶振：
   ```bash
   python -m esptool --chip auto -p /dev/ttyUSB0 chip_id | grep Crystal
   ```
   输出 `Crystal is 40MHz` 而配置是 26MHz（或反过来）就要改 `CONFIG_XTAL_FREQ`。
2. **串口被两个进程同时占用** —— `idf.py flash monitor` 连着跑就会这样。分开跑。

---

### `esp_flash_get_size()` 报的和实际容量对不上

**原因**：它返回的是**编译期 `CONFIG_ESPTOOLPY_FLASHSIZE` 的值**，不是物理容量。

**解决**：读 JEDEC ID 第 3 字节（容量码），或用跨边界读夹逼。

---

## 连接期

### `Failed to connect to ESP32-S3: No serial data received`

**原因**：板子上跑的应用占用了 USB（枚举 `303a:4001`，只有 CDC 没有 JTAG），
esptool 无法让它进下载模式。

**解决**（二选一）：

- 插 **UART 口**（CP2102/CH343），出现 `/dev/ttyUSB0`，之后全程免按按钮 ← 推荐
- 按住 **BOOT** 键点一下 **RESET**，芯片变 `303a:1001` 进 ROM 下载模式

---

### `Invalid head of packet (0x1B): Possible serial noise or corruption`

**原因**：读到的不是 bootloader 的应答，而是**应用日志**（0x1B 是 ESC 字符）。
说明芯片在跑应用，没进下载模式。

**解决**：同上。

---

### `Serial data stream stopped: Possible serial noise or corruption`

**原因**：握手开始了但数据流中断。常见于波特率太高或线接触不良。

**解决**：降波特率试。

```bash
python -m esptool --chip auto -b 115200 -p /dev/ttyUSB0 chip_id
```

---

## 环境期

### `sudo: The "no new privileges" flag is set`

**原因**：内核 `NoNewPrivs=1`，与密码无关。

**解决**：免 root 装包，见 [`ENVIRONMENT.md` §1](ENVIRONMENT.md#1-sudo-不可用)。

---

### `ERROR: ESP-IDF Python virtual environment "..._py3.14_env" not found`

**原因**：conda 的 python 抢在 PATH 最前，被 `detect_python.sh` 选中。

**解决**：设 `IDF_PYTHON_ENV_PATH`，见 [`ENVIRONMENT.md` §2](ENVIRONMENT.md#2-conda-的-python-版本抢占-path)。

---

### `gnutls_handshake() failed: The TLS connection was non-properly terminated`

**原因**：GitHub 连接不稳（间歇性）。

**解决**：换 gitee 镜像 + 重试 + `IDF_GITHUB_ASSETS` 走国内 CDN。
见 [`ENVIRONMENT.md` §3](ENVIRONMENT.md#3-github-拉不动)。

---

### VS Code 进程都在，但新窗口起不来

**原因**：`~/.config/Code/code.lock` 残留。

**解决**：

```bash
rm -f ~/.config/Code/code.lock
```

---

### VS Code 的 ESP-IDF 扩展不激活

**原因**：`workspaceContains:**/CMakeLists.txt` 激活事件不触发。

**解决**：`settings.json` 里加 `"idf.extensionActivationMode": "always"`。

---

## 快速自检清单

板子不工作的时候，按这个顺序过一遍：

```bash
# 1. 串口在不在
ls /dev/ttyUSB* /dev/ttyACM*

# 2. 芯片认不认得
python -m esptool --chip auto -p /dev/ttyUSB0 chip_id

# 3. Flash 真实容量
python -m esptool --chip auto -p /dev/ttyUSB0 flash_id

# 4. 完整探测（会烧探测固件并读回参数）
bash setup/flash_probe.sh

# 5. 板子现在跑的是什么、串口上有没有输出
idf.py -p /dev/ttyUSB0 monitor
```
