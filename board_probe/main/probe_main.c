/*
 * 板子参数探测程序
 *
 * 打印出决定 sdkconfig 所需的硬件信息：
 *   - Flash 容量（决定 CONFIG_ESPTOOLPY_FLASHSIZE_*）
 *   - PSRAM 容量（决定是否开 CONFIG_SPIRAM）
 *   - 芯片型号与版本
 *
 * PSRAM 线数模式（OCT/QUAD）没有公开 API，只能靠"配对才能启动"来反推：
 * 本程序用 OCT 模式编译，若能正常启动并打印出 PSRAM 容量，说明是八线；
 * 若反复重启并报 "PSRAM ID read error"，改成 QUAD 重新编译烧录。
 */
#include <stdio.h>
#include <string.h>

#include "esp_chip_info.h"
#include "esp_flash.h"
#include "esp_mac.h"
#include "esp_system.h"
#include "esp_idf_version.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* 原始 ESP32 的 PSRAM 是外挂芯片（仅四线），且并非所有板子都有；
   S3 则可能是板载八线。所以按编译目标条件编译。 */
#if CONFIG_SPIRAM
#include "esp_psram.h"
#endif

/* JEDEC ID 第 3 字节是容量码，换算成 Flash 容量
 * 口径与 esptool 的 DETECTED_FLASH_SIZES 表保持一致：
 *   0x12=256KB 0x13=512KB 0x14=1MB 0x15=2MB 0x16=4MB 0x17=8MB
 *   0x18=16MB 0x19=32MB 0x1A=64MB 0x1B=128MB 0x1C=256MB
 */
static const char *jedec_capacity_str(uint8_t code)
{
    switch (code) {
    case 0x12: return "256KB";
    case 0x13: return "512KB";
    case 0x14: return "1MB";
    case 0x15: return "2MB";
    case 0x16: return "4MB";
    case 0x17: return "8MB";
    case 0x18: return "16MB";
    case 0x19: return "32MB";
    case 0x1A: return "64MB";
    case 0x1B: return "128MB";
    case 0x1C: return "256MB";
    default:   return "未知";
    }
}

void app_main(void)
{
    uint32_t flash_size = 0;
    uint32_t psram_size = 0;
    uint8_t mac[6] = {0};
    char mac_str[18];
    esp_chip_info_t chip_info;
    uint32_t jedec_id = 0;

    if (esp_flash_get_size(NULL, &flash_size) != ESP_OK) {
        flash_size = 0;
    }
#if CONFIG_SPIRAM
    if (esp_psram_is_initialized()) {
        psram_size = esp_psram_get_size();
    }
#endif
    if (esp_read_mac(mac, ESP_MAC_WIFI_STA) != ESP_OK) {
        memset(mac, 0xff, sizeof(mac));
    }
    snprintf(mac_str, sizeof(mac_str),
             "%02x:%02x:%02x:%02x:%02x:%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    esp_chip_info(&chip_info);

    /* JEDEC ID 反映的是物理 Flash 芯片，不受 CONFIG_ESPTOOLPY_FLASHSIZE 影响 */
    if (esp_flash_read_id(NULL, &jedec_id) != ESP_OK) {
        jedec_id = 0;
    }

    printf("\n===== BOARD PROBE =====\n");
    printf("IDF version      : %s\n", esp_get_idf_version());
    printf("chip model       : %s\n", CONFIG_IDF_TARGET);
    printf("chip revision    : %d\n", (int)chip_info.revision);
    printf("cpu cores        : %d\n", (int)chip_info.cores);

    printf("flash size (cfg) : %u bytes (%.1f MB)  <- 编译期 CONFIG_ESPTOOLPY_FLASHSIZE\n",
           (unsigned)flash_size, (double)flash_size / (1024.0 * 1024.0));
    if (jedec_id) {
        uint8_t cap_code = (uint8_t)(jedec_id & 0xFF);
        printf("flash jedec id   : %02x %02x %02x\n",
               (unsigned)((jedec_id >> 16) & 0xFF),
               (unsigned)((jedec_id >> 8) & 0xFF),
               (unsigned)cap_code);
        printf("flash real size  : %s  <- JEDEC 容量码，物理真实容量\n",
               jedec_capacity_str(cap_code));
    }

    if (psram_size) {
        printf("psram size       : %u bytes (%.1f MB)\n",
               (unsigned)psram_size, (double)psram_size / (1024.0 * 1024.0));
        printf("psram mode       : OCTAL/八线（本次按 SPIRAM_MODE_OCT 编译且能启动）\n");
    } else {
#if CONFIG_SPIRAM
        printf("psram size       : 0 (未初始化或不存在)\n");
#else
        printf("psram            : 本次编译未启用 PSRAM 支持（无 PSRAM 的板子用这个）\n");
#endif
    }

    /* 机器可读的标记，便于脚本自动解析 */
    printf("PROBE_FLASH_SIZE=%u\n", (unsigned)flash_size);
    printf("PROBE_PSRAM_SIZE=%u\n", (unsigned)psram_size);
#if CONFIG_SPIRAM
#if CONFIG_SPIRAM_MODE_OCT
    printf("PROBE_PSRAM_MODE=oct\n");
#else
    printf("PROBE_PSRAM_MODE=quad\n");
#endif
#else
    printf("PROBE_PSRAM_MODE=none\n");
#endif
    printf("PROBE_MAC=%s\n", mac_str);

    printf("MAC (default)    : %s\n", mac_str);
    printf("=====================\n\n");

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}
