# 第三方来源与许可

## 随包代码

| 文件 | 来源 | 许可 |
| --- | --- | --- |
| `lib/upstream-structured.cjs` | UnsplashZ/bili-qq-bot 的 `src/services/link/structuredLinkParser.js`，参考提交 `8e206ad8939cba5c50e009df9070bdefe4b1a4b8` | ISC；上游版权声明和授权全文保留在 [LICENSE](LICENSE) |
| `lib/vendor/qrcode.cjs` | kazuhikoarase/qrcode-generator，文件头保留作者 Kazuhiko Arase 的版权声明 | MIT；全文见 [LICENSE-qrcode.txt](lib/vendor/LICENSE-qrcode.txt) |

[结构化解析模块来源](https://github.com/UnsplashZ/bili-qq-bot/blob/8e206ad8939cba5c50e009df9070bdefe4b1a4b8/src/services/link/structuredLinkParser.js) · [二维码库来源](https://github.com/kazuhikoarase/qrcode-generator)

## 流程与界面参考

以下项目用于理解流程、兼容参数或页面组织，仓库不包含它们的 AstrBot／Python 运行代码：

- Soulter/astrbot_plugin_bilibili：扫码登录参考提交 `aaa3879c09401578c3f71ac3eb5ec0f2efdb1968`，直播检测参考提交 `2e680c58d3d49a14fbdbd9c4f3603f4dd73572d9`。本项目重新实现为 Node.js 模块。
- Zhalslar/astrbot_plugin_parser：流式下载重试流程参考提交 `e14c0b6ccf6377aefc6ade758a5a8b5881d23bd8`。
- Black-Cyan/napcat-plugin-douyin：侧栏与页面组织参考提交 `2d354b67964f44a0a49b72ab7cf55132fee82848`。
- yt-dlp：B站请求签名参数参考提交 `e8de28e23c1ecb4a12b2c3dec188c07e998c412c`。

NapCat 是宿主程序，FFmpeg 是可选的外部媒体工具，两者均不随本仓库打包。项目以 `package.json` 和根目录 ISC 许可证声明授权；第三方文件原有的独立许可证继续保留。
