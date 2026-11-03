/*
 * ESP32 板载测试程序
 *
 * 做这几件事，每一项都能在串口输出里看到结果：
 *   1. 打印芯片/Flash/分区信息
 *   2. 闪板载 LED（默认 GPIO2，可用 Kconfig 改）
 *   3. NVS 读写测试（验证 Flash 的 NVS 分区可用）
 *   4. 周期打印剩余堆内存
 */
#include <stdio.h>
#include <string.h>

#include "esp_chip_info.h"
#include "esp_flash.h"
#include "esp_heap_caps.h"
#include "esp_idf_version.h"
#include "esp_mac.h"
#include "esp_partition.h"
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#define LED_GPIO CONFIG_TEST_LED_GPIO
#define TEST_NVS_KEY "test_key"
#define TEST_NVS_VAL "hello_esp32"

static void led_init(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = 1ULL << LED_GPIO,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&io_conf));
}

static void led_set(int on)
{
    gpio_set_level(LED_GPIO, on ? 1 : 0);
}

/* 返回 0 成功 */
static int nvs_test(void)
{
    nvs_handle_t h;
    char buf[32] = {0};
    size_t len = sizeof(buf);

    if (nvs_open("testns", NVS_READWRITE, &h) != ESP_OK) {
        printf("[NVS] open failed\n");
        return -1;
    }
    if (nvs_set_str(h, TEST_NVS_KEY, TEST_NVS_VAL) != ESP_OK) {
        printf("[NVS] write failed\n");
        nvs_close(h);
        return -1;
    }
    if (nvs_commit(h) != ESP_OK) {
        printf("[NVS] commit failed\n");
        nvs_close(h);
        return -1;
    }
    if (nvs_get_str(h, TEST_NVS_KEY, buf, &len) != ESP_OK) {
        printf("[NVS] read failed\n");
        nvs_close(h);
        return -1;
    }
    nvs_close(h);
    printf("[NVS] 读写正常: %s = %s\n", TEST_NVS_KEY, buf);
    return 0;
}

static void print_partitions(void)
{
    esp_partition_iterator_t it =
        esp_partition_find(ESP_PARTITION_TYPE_ANY, ESP_PARTITION_SUBTYPE_ANY, NULL);

    printf("--- 分区表 ---\n");
    printf("  %-12s %-6s %-6s %-10s %s\n", "名称", "类型", "子类型", "偏移", "大小");
    while (it) {
        const esp_partition_t *p = esp_partition_get(it);
        if (p != NULL) {
            printf("  %-12s 0x%02x   0x%02x   0x%06x   0x%06x (%u KB)\n",
                   p->label,
                   (unsigned)p->type, (unsigned)p->subtype,
                   (unsigned)p->address, (unsigned)p->size,
                   (unsigned)(p->size / 1024));
        }
        it = esp_partition_next(it);
    }
    esp_partition_iterator_release(it);
}

void app_main(void)
{
    uint32_t flash_size = 0;
    esp_chip_info_t chip;
    uint8_t mac[6] = {0};
    char mac_str[18];
    int tick = 0;

    esp_chip_info(&chip);
    esp_flash_get_size(NULL, &flash_size);
    if (esp_read_mac(mac, ESP_MAC_WIFI_STA) != ESP_OK) {
        memset(mac, 0xff, sizeof(mac));
    }
    snprintf(mac_str, sizeof(mac_str),
             "%02x:%02x:%02x:%02x:%02x:%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    printf("\n=========================\n");
    printf("  ESP32 板载测试程序\n");
    printf("=========================\n");
    printf("IDF 版本  : %s\n", esp_get_idf_version());
    printf("芯片      : %s (rev %d, %d 核)\n",
           CONFIG_IDF_TARGET, (int)chip.revision, (int)chip.cores);
    printf("Flash     : %u bytes (%.1f MB)\n",
           (unsigned)flash_size, (double)flash_size / (1024.0 * 1024.0));
    printf("MAC       : %s\n", mac_str);
    printf("LED 引脚  : GPIO%d\n", LED_GPIO);
    print_partitions();

    printf("\n--- NVS 测试 ---\n");
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        printf("[NVS] 分区有问题，擦除重建\n");
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
    printf("[NVS] 初始化成功\n");
    if (nvs_test() != 0) {
        printf("[NVS] 测试未通过\n");
    }

    led_init();
    printf("\n--- 开始运行 ---\n");

    while (1) {
        led_set(1);
        vTaskDelay(pdMS_TO_TICKS(200));
        led_set(0);
        vTaskDelay(pdMS_TO_TICKS(800));

        if (++tick % 5 == 0) {
            printf("[%3d] tick 剩余堆: %u bytes\n",
                   tick, (unsigned)esp_get_free_heap_size());
        }
    }
}
