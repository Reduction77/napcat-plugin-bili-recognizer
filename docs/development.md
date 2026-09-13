# 开发、测试与打包

[返回 README](../README.md) · [上传 GitHub](publishing.md)

## 开发环境

源码使用原生 Node.js ESM，二维码库和上游结构化解析模块通过 CommonJS 互操作加载。WebUI 是原生前端，没有打包构建步骤，也没有需要通过 npm 安装的第三方依赖。

使用 Node.js 20.3+；当前自动测试在 Node.js 24 下验证。若要执行真实媒体合并测试，需安装含 H.264／AAC 支持的 FFmpeg 和 ffprobe。测试不连接真实 QQ 和 B站，但部分用例会启动 localhost HTTP 服务。

```sh
npm test
npm run benchmark
```

源码整理后的验证摘要见 [validation.md](validation.md)。测试覆盖链接解析、扫码与换票、凭据保存、群范围、下载重试、FFmpeg 合并、直播多时段、手动通知、WebUI 和性能计数。没有 FFmpeg 时真实合并用例会标记跳过。

性能脚本默认输出本版的模拟计数。对比解压后的旧版目录：

```sh
node scripts/benchmark-performance.mjs /path/to/extracted/1.4.1
```

## 在 NapCat 中调试

修改源码后重载插件或重启 NapCat，前端变更后强制刷新浏览器。排查请求明细时启用调试日志，日常关闭以减少输出。测试应使用另一个 QQ 账号，因为插件忽略自身消息。

`index.mjs` 由 NapCat 加载，直接执行不会创建独立服务；不能把开发测试里的模拟上下文用于真实部署。

## 生成插件安装包

打包工具仅使用 Python 3 标准库。Python 只用于开发者打包，不是插件运行依赖。

```sh
python3 tools/package.py
```

Windows 也可使用：

```powershell
py -3 tools/package.py
```

或执行 `npm run pack:plugin`（要求命令 `python3` 可用）。输出文件为 `dist/napcat-plugin-bili-recognizer-1.4.2.zip`。版本和文件名从 `package.json` 读取。

安装包根目录直接包含入口和运行所需目录，不套项目文件夹。它包含 README、更新日志、许可和使用文档；测试、诊断脚本及性能脚本请从完整源码仓库使用。

工具仅打包显式列出的代码／文档路径，不遍历整个工作目录，不收集配置、下载缓存、Git 历史或旧 ZIP；遇到符号链接会拒绝打包。

## 修改与发布

- 业务修改应补充能覆盖实际行为的测试，尤其是凭据保存、通知去重、冷却和下载失败恢复。
- 发布新版本时，同步 `package.json`、`lib/webui.mjs`、`webui/index.html` 的版本和缓存标识，并更新相关测试及 CHANGELOG。
- 保留根目录 ISC 许可证和二维码库 MIT 声明；第三方来源记录在 `THIRD_PARTY_NOTICES.md`。
- `tools/check.mjs` 和 `tools/diagnose-412.mjs` 是实际服务器诊断工具，会访问 B站；它们不属于离线自动测试，也不会向 QQ 发送消息。

示例：

```sh
node tools/check.mjs "完整B站链接或BV号"
node tools/diagnose-412.mjs BV1xx411c7mD --mode anonymous --output bili-412-diagnostic.json
```

如需使用本地账号，在 CLI 中指定实际 `--config` 和 `--data-path`，不要把 Cookie 写进命令行。独立 CLI 不共享运行中插件的内存冷却，不应在限流时反复启动。
