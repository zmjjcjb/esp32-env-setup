# 环境适配详解

这份文档记录的是"标准 ESP-IDF 安装步骤之外，这台机器上额外做了什么、为什么"。
每一条都是实际踩出来的。

---

## 1. `sudo` 不可用

**现象**

```
$ sudo -S apt-get install flex
sudo: The "no new privileges" flag is set, which prevents sudo from running as root.
```

注意这跟**密码对不对无关** —— 连 `sudo --version`、`sudo -l` 自己都报同样的错。

**根因**

容器/受限环境里内核设了 `NoNewPrivs=1`：

```bash
$ grep NoNewPrivs /proc/self/status
NoNewPrivs:	1
```

这个标志会直接阻断 setuid 提权，任何用户态手段都绕不过去。

**判据**

```bash
grep NoNewPrivs /proc/self/status
```

**方案：免 root 装包**

```bash
# 下载 .deb 不需要 root
apt-get download flex bison gperf ccache dfu-util

# 解压到用户目录
mkdir -p tools/root
for d in *.deb; do dpkg -x "$d" tools/root/; done

# 加进 PATH
export PATH="$PWD/tools/root/usr/bin:$PATH"
export LD_LIBRARY_PATH="$PWD/tools/root/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
```

**两个细节**

- `ccache` 依赖 `libhiredis.so.0.14`，这个包也得一起下载，否则会报
  `error while loading shared libraries`
- 换 apt 源不用改 `/etc/apt/sources.list`（要 root），用 `-o Dir::Etc::sourcelist=` 指向自己的列表即可

---

## 2. conda 的 Python 版本抢占 PATH

**现象**

ESP-IDF 装完之后，`export.sh` 报错：

```
ERROR: ESP-IDF Python virtual environment
"/home/<user>/.espressif/python_env/idf5.5_py3.14_env/bin/python" not found.
```

**根因**

`tools/detect_python.sh` 的探测逻辑是**取 PATH 里第一个能用的 `python3`**：

```bash
for p_cmd in python3 python python3.9 python3.10 python3.11 python3.12 python3.13; do
    ...
done
```

如果 conda 装在前面且 python 版本 ≥ 3.9，它就会被选中，于是去找 `idf<版本>_py<检测到的版本>_env` —— 一个不存在的目录。

**方案**

显式指定 venv 路径。`idf_tools.py` 支持这个覆盖：

```python
idf_python_env_path = os.getenv('IDF_PYTHON_ENV_PATH') or os.path.join(
    g.idf_tools_path, 'python_env', PYTHON_VENV_DIR_TEMPLATE.format(idf_version, PYTHON_VER_MAJOR_MINOR)
)
```

```bash
export IDF_PYTHON_ENV_PATH="$HOME/.espressif/python_env/idf5.5_py3.10_env"
```

**为什么不改 PATH 顺序**

把 `/usr/bin` 提到 PATH 最前能解决问题，但会**破坏用户的 conda 工作**（`python` 变成系统 3.10）。
用 `IDF_PYTHON_ENV_PATH` 只影响 ESP-IDF 自己，互不干扰 —— 这是更克制的做法。

**装的时候也要注意**

`install.sh` 内部同样会调 `detect_python.sh`，所以装的时候也得用系统 python：

```bash
PATH="/usr/bin:$PATH" ./install.sh esp32s3
```

否则会装出一个 `idf5.5_py3.14_env`，而 `export.sh` 又去找 3.10 的，两头对不上。

---

## 3. GitHub 拉不动

**现象**

```
fatal: could not read Username for 'https://gitee.com': 没有那个设备或地址
fatal: unable to access 'https://github.com/...': gnutls_handshake() failed:
       The TLS connection was non-properly terminated.
```

两个问题叠在一起。

### 3.1 主仓库走 gitee 镜像

```bash
git clone --branch v5.5.6 --depth 1 https://gitee.com/EspressifSystems/esp-idf.git
```

gitee 上 `EspressifSystems` 和 `mirrors` 两个 org 都有同步。

### 3.2 子模块的相对 URL 会解析到需要认证的路径

ESP-IDF 的 `.gitmodules` 用的是**相对 URL**：

```ini
[submodule "components/mbedtls/mbedtls"]
	url = ../../espressif/mbedtls.git
```

注释里写得很清楚："All the relative URL paths are intended to be GitHub ones"。

相对 URL 是相对 **origin 的地址**解析的。主仓库从 `gitee.com/EspressifSystems/esp-idf` 克隆，
`../../espressif/mbedtls.git` 就变成了 `gitee.com/espressif/mbedtls.git` —— 那个路径需要登录。

**方案：改写成 GitHub 绝对地址**

```bash
python3 - <<'PY'
import re, pathlib
p = pathlib.Path('.gitmodules')
t = p.read_text()
p.write_text(re.sub(r'url\s*=\s*\.\./\.\./([^/\s]+/[^/\s]+)\.git',
                     r'url = https://github.com/\1.git', t))
PY
git submodule sync --recursive
```

### 3.3 GitHub 握手不稳定，必须重试

即便 URL 改对了，`gnutls_handshake()` 仍会间歇性失败。`setup/fetch_submodules.sh`
对每个子模块重试 6 次并递增退避。

### 3.4 `--depth 1` 会让子模块停在分支 tip

这是最隐蔽的一个坑。浅克隆子模块时，git 拉的是**默认分支的头**，而不是
ESP-IDF 锁定的那��� commit。

```bash
$ git submodule status | grep "^+"
+601bd11... components/bootloader/.../micro-ecc (heads/master)
+324a6ac... components/json/cJSON (heads/master)
```

`+` 前缀表示"当前 commit 和父仓库期望的不一致"。多数时候能编过，但 **`components/heap/tlsf`
这种关键组件会直接编不过**：

```
CMake Error: Include directory '.../components/heap/tlsf/include' is not a directory.
```

**方案：对齐到锁定的 SHA**

```bash
WANT=$(git ls-tree HEAD <子模块路径> | awk '{print $3}')
cd <子模块路径>
git fetch origin "$WANT" --depth 1 || git fetch --unshallow origin
git checkout --force "$WANT"
```

`setup/fix_submodule.sh` 就是干这个的。

### 3.5 工具链下载走国内镜像

```bash
export IDF_GITHUB_ASSETS="dl.espressif.cn/github_assets"
```

---

## 4. VS Code ESP-IDF 扩展的配置

扩展 2.x 不再从 `settings.json` 读 IDF 路径，而是从 `~/.espressif/esp_idf.json` 读安装清单：

```json
{
    "gitPath": "/usr/bin/git",
    "idfToolsPath": "/home/<user>/.espressif",
    "idfSelectedId": "esp-idf-v5.5.6",
    "idfInstalled": {
        "esp-idf-v5.5.6": {
            "path": "/home/<user>/esp32/esp-idf",
            "version": "v5.5.6",
            "python": "/home/<user>/.espressif/python_env/idf5.5_py3.10_env/bin/python",
            "activationScript": "",
            "status": "Finished"
        }
    }
}
```

再配合 `settings.json`：

```json
{
    "idf.currentSetup": "/home/<user>/esp32/esp-idf",
    "idf.toolsPath": "/home/<user>/.espressif",
    "idf.extensionActivationMode": "always",
    "idf.customExtraVars": {
        "IDF_PATH": "/home/<user>/esp32/esp-idf",
        "IDF_TOOLS_PATH": "/home/<user>/.espressif",
        "IDF_PYTHON_ENV_PATH": "/home/<user>/.espressif/python_env/idf5.5_py3.10_env",
        "IDF_TARGET": "esp32s3"
    },
    "idf.flashType": "UART",
    "idf.port": "/dev/ttyUSB0"
}
```

### 为什么要 `extensionActivationMode: always`

扩展默认靠 `workspaceContains:**/CMakeLists.txt` 激活，这个事件在某些环境下不触发
（`exthost.log` 里看不到 `_doActivateExtension espressif.esp-idf-extension`）。
改成 `always` 后扩展无条件激活，它自己的探测逻辑再决定要不要接管工程。

### 验证是否配好

```bash
sqlite3 ~/.config/Code/User/workspaceStorage/<hash>/state.vscdb \
  "select value from ItemTable where key='espressif.esp-idf-extension';" \
  | python3 -c "import sys,json; d=json.load(sys.stdin)['CURRENT_IDF_CONFIGURATION']; \
      print({k:d[k] for k in ('IDF_PATH','IDF_TOOLS_PATH','IDF_PYTHON_ENV_PATH','ESP_IDF_VERSION')})"
```

---

## 5. 串口与复位

### 用 UART 桥（CP2102/CH343）最省事

出现 `/dev/ttyUSB0`，esptool 用 DTR/RTS **自动复位**，烧录全程不用按按钮。

### 用原生 USB 口（`/dev/ttyACM0`）的限制

ESP32-S3 的原生 USB 有两种枚举形态：

| 状态 | PID | 接口 | esptool 能连吗 |
|---|---|---|---|
| 应用运行中（应用接管了 USB） | `303a:4001` | 只有 CDC | **不能** |
| ROM 下载模式（按住 BOOT + 点 RESET） | `303a:1001` | CDC + JTAG | 能 |

esptool 4.12 靠 PID 判断：

```python
USB_JTAG_SERIAL_PID = 0x1001
...
if mode == "usb_reset" or self._get_pid() == self.USB_JTAG_SERIAL_PID:
    return (USBJTAGSerialReset(self._port),)
```

所以原生 USB 口下每次烧录都得先让板子进下载模式。

### 串口归属

```bash
ls -la /dev/ttyUSB* /dev/ttyACM*
```

若提示 permission denied：

```bash
sudo usermod -a -G dialout $USER   # 需要重新登录才生效
```

---

## 6. 其它零碎

### VS Code 强杀后残留锁文件

进程被 `kill -9` 之后，`~/.config/Code/code.lock` 会留下。
表现是：进程都在，但新窗口起不来（没有 renderer 进程、日志目录是空的）。

```bash
rm -f ~/.config/Code/code.lock
```

### `idf.py flash monitor` 连着跑会乱码

两个进程抢同一个串口。单独跑 `idf.py monitor` 就干净了。

### 分区表文件名要写两个 Kconfig 项

```ini
CONFIG_PARTITION_TABLE_CUSTOM=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions-8mb.csv"   # ← 真正取文件名的
CONFIG_PARTITION_TABLE_FILENAME="partitions-8mb.csv"           # ← 派生项
```

只写 `PARTITION_TABLE_FILENAME` 的话，Kconfig 会把它重置回默认值 `partitions.csv`。
