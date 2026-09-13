# 将源码上传 GitHub

本源码包以项目文件夹为根目录，解压后可以直接建立仓库。运行版本为 1.4.2，未填写未知的 GitHub 用户名或仓库地址。

## 网页上传

1. 在 GitHub 新建仓库，名称建议 `napcat-plugin-bili-recognizer`。
2. 新建页面不要勾选自动添加 README、`.gitignore` 或许可证，本包已包含。
3. 解压源码 ZIP，进入里面的 `napcat-plugin-bili-recognizer` 文件夹。
4. 使用 GitHub 的上传文件入口，上传该文件夹里的内容。根目录应直接看到 `README.md`、`package.json`、`index.mjs`、`lib/`、`webui/`，不要把 ZIP 本身或额外一层文件夹当作源码上传。
5. 同时保留 `.gitignore` 和 `.gitattributes`，提交说明可填写 `Initial release: v1.4.2`。

建议仓库简介：

> NapCat 原生 B站插件：链接识别、扫码登录、视频下载、WebUI 与多时段直播开播／下播通知。

可选 Topics：`napcat`、`napcat-plugin`、`bilibili`、`qq-bot`、`javascript`、`webui`。

## 使用 Git 上传

在解压出的项目根目录执行，最后一段仓库地址需替换为自己新建仓库的地址：

```sh
git init
git add .
git commit -m "Initial release: v1.4.2"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/napcat-plugin-bili-recognizer.git
git push -u origin main
```

若尚未设置 Git 提交姓名和邮箱，先按自己希望公开的署名配置，可使用 GitHub 提供的隐私邮箱。

## 发布可安装 ZIP

运行 `python3 tools/package.py` 生成 `dist/napcat-plugin-bili-recognizer-1.4.2.zip`，在仓库 Releases 新建 `v1.4.2` 发布并上传该 ZIP。更新说明可以参考 `CHANGELOG.md`。

GitHub 自动生成的 Source code ZIP 带仓库文件夹层级，与安装包不同；安装说明应指向你上传的插件 ZIP。只上传 GitHub 仓库并不等于进入 NapCat 插件商店，如需收录可另按 [NapCat 发布插件文档](https://napneko.github.io/develop/plugin/)处理。

本次交付只准备源码和文档，不会替你创建公开仓库或向 GitHub 推送。
