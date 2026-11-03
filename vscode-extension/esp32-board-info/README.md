# ESP32 Board Info

自动识别 ESP32 串口与芯片型号，查看 Flash 容量、PSRAM、MAC 等板级参数。

配合 [esp32-env-setup](https://github.com/zmjjcjb/esp32-env-setup) 使用效果最好。

## 功能

- **状态栏常驻**：显示当前板子的芯片型号、Flash 容量、PSRAM
- **插上就识别**：检测到新串口时自动刷新状态栏
- **一键探测**：点一下拿到完整信息（芯片型号、版本、晶振、Flash 厂商/容量/接口/电压、PSRAM、MAC、eFuse 特征、加密状态）
- **配置档匹配**：自动匹配 `setup/boards/` 下对应的板级配置档，可一键应用到当前工程

## 两种识别方式

| | 被动扫描 | 主动探测 |
|---|---|---|
| 触发 | 自动，插上就更新 | 点「探测」按钮 |
| 手段 | 读 `/dev` 与 sysfs 的 USB VID/PID | esptool 复位板子进 bootloader |
| 副作用 | 无 | **板子会复位一次** |
| 能得到 | "有个 Espressif 设备在 /dev/ttyACM0" | 芯片型号、Flash、PSRAM、MAC |

认芯片型号**必须**让板子进 bootloader，无法绕过，所以这个副作用被放在显式的按钮后面，而不是偷偷进行。

## 命令

| 命令 | 说明 |
|---|---|
| `ESP32: 板子信息面板` | 打开面板 |
| `ESP32: 扫描串口` | 手动刷新串口列表 |
| `ESP32: 探测当前串口的芯片` | 选串口并探测 |
| `ESP32: 应用配置档到当前工程` | 选配置档并套用 |

## 配置项

| 项 | 默认 | 说明 |
|---|---|---|
| `esp32BoardInfo.root` | `${env:HOME}/esp32` | ESP32 工作根目录 |
| `esp32BoardInfo.esptoolPath` | 自动查找 | esptool 的 python 解释器 |
| `esp32BoardInfo.autoProbe` | `true` | 新串口出现时自动探测 |
| `esp32BoardInfo.pollInterval` | `2000` | 轮询间隔（毫秒） |

## 常见问题

**探测失败 `No serial data received`**
板子上跑的应用占用了 USB。插 UART 口（出现 `/dev/ttyUSB0`）即可，或按住 BOOT 点 RESET 进下载模式。

**状态栏显示"未检测到串口"**
确认板子插好且 `ls /dev/ttyUSB* /dev/ttyACM*` 能看到设备。USB 口被占用或接触不良时也会这样。

## License

MIT
