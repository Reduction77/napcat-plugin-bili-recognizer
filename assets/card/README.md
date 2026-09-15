# 直播卡片资源目录

| 文件/目录 | 用途 |
| --- | --- |
| `custom/` | 自备贴纸，见 `custom/README.md` |
| `card-live.html` | 卡片模板的只读副本，方便对照修改（实际渲染由 `lib/live-card.mjs` 生成） |
| `theme-*.css` | 主题样式的只读副本（实际样式在 `lib/live-card.mjs` 的 `THEME_CSS`） |

卡片由外部文转图服务渲染（默认对接 AstrBot 的 astrbot-t2i-service）。要改配色或布局，直接改
`lib/live-card.mjs` 里的 `THEME_CSS` 与 `renderCardHtml()`，改完重载插件即可，不需要重新打包前端。
