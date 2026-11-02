# 构建说明

这是基于 Joplin 的衍生应用。源码固定为官方仓库 `https://github.com/laurent22/joplin` 的提交 `e41516e669efb693b009bedb21f3eb1fcbea4fc9`。源包内的独立功能代码使用 MIT；组合应用按上游 AGPL-3.0-or-later 及各目录、第三方依赖的许可分发，不能把整个应用称为 MIT。保留上游版权及许可说明。应用名称、包名、桌面配置目录及启动图标已分离。

## 还原

把官方固定提交检出到与 `dot-notes` 同级的 `upstream-joplin` 目录。运行 `node dot-notes/scripts/build.cjs`，再运行 `node dot-notes/scripts/integrate.cjs`。集成脚本会验证提交，生成内置界面资源，并应用所有平台入口修改；不需要发布或下载自定义插件。

固定上游源码也可从 https://github.com/laurent22/joplin/archive/e41516e669efb693b009bedb21f3eb1fcbea4fc9.zip 获取。源码附件中的 `upstream-overlay` 保存全部修改或新增的上游文件；将其覆盖到该固定源码即可还原修改（这种方式不运行检查 Git 提交的集成脚本）。官方仓库内的锁文件与各第三方目录许可保持有效。附件是完整修改集，基础源码在上述固定地址，并非脱离上游即可单独编译的小型项目。

## Android

本次使用 Windows、Node 24.16、JDK 21、Yarn 4.16.0（仓库自带）、Gradle 8.14.3、Android SDK/Build Tools 36、NDK 27、CMake 3.22.1。Windows 下 CMake 自带的 Ninja 1.10.2 遇到长路径错误，专用目录内换为官方 Ninja 1.13.2 后继续构建。

依赖固定安装：在上游根目录运行 `node .yarn/releases/yarn-4.16.0.cjs install --immutable --mode=skip-build`，设置 `YARN_ENABLE_SCRIPTS=false` 与 `YARN_CHECKSUM_BEHAVIOR=throw`。随后只执行审查过的移动端构建脚本 `scripts/build-mobile-js.ps1`。该脚本不运行整个上游仓库的发布或清理流程。

`scripts/build-android.ps1` 使用已安装的工具，不下载 SDK、不接受协议、不创建生产签名、不部署。默认专用构建根目录为 `F:\DotNotesBuild`。上游 `profileable` 变体包含 JS 资源，使用仓库已有公共测试签名，不是生产发行签名；不能用于正式商店发布。正式分发需另行配置用户持有的签名，并保留可升级的签名身份。

Android 应用 ID 为 `local.dotnotes.app`。签名、CPU 架构、系统最低版本和运行检查以对应安装包的交付报告为准。不要将中间 JS bundle 或源码 ZIP 当作安装包。

Pixel 8 单架构包：`scripts/build-android.ps1 -Architectures arm64-v8a`。这会同步限制应用和依赖的 ABI，再正常打包和测试签名，不编辑已有已签名 APK。省略参数保留四架构默认值。

## macOS

已提供桌面入口集成和独立图标、应用标识，尚无获授权的 Mac 构建环境。需要在获授权的 Mac 上安装符合上游要求的依赖，完成桌面构建、运行及本地持久化验证；本次未生成经过验证的 DMG/APP，也未签名或公证。

## 连接和验证

运行 `node --test dot-notes/test/*.test.cjs` 检查本地存储、版本去重、失败重试及合成数据 MCP 协议逻辑。HTTP 测试只监听本机。Android 实际运行检查需独立进行。

默认 dot 适配器未连接。MCP 本地代码不等于可用的账户接入：真实认证、可达服务、插件安装、事件订阅和端到端接收仍待授权与验证。普通 OpenAI Responses API 不是现有 dot 的收件接口。
