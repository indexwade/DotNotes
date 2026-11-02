# DotNotes

基于 Joplin 本地数据层的简洁记事本，目标平台为 Android 和 macOS。笔记在设备本地保存，普通保存不会发送。明确点击“完成并发送”才创建按笔记 ID 和版本标识的提交快照。

## 当前状态

- Android 独立预览版已构建；离线保存、重启恢复、重复完成与重试在 Android 16 x86_64 模拟器验证。
- ARM64 APK：82,997,255 字节，仅 arm64-v8a；版本 3.7.11（2097820），应用 ID local.dotnotes.app。测试签名，ARM64 真机尚未验证。16 KB 静态对齐通过，未做 16 KB 运行测试。
- APK SHA-256：ACE4F391A22C6D4A34EC8C00062C34BC6DA943D7DBC3FFC9E997241CC897A091。
- dot 尚未连接，界面诚实显示未连接。桥接代码仅经过本地合成数据测试；需要单独完成服务认证、账户插件及事件订阅配置。普通 OpenAI Responses API 不是现有 dot 对话的收件接口。
- macOS 入口集成源码已有，尚未在 Mac 编译、运行、签名或公证。
- 本仓库发布源码与构建修改，不包含 APK、凭证、用户笔记或构建缓存。

## 源码与恢复

`dot-notes/` 是本项目界面、共享逻辑、发送适配器、测试与集成脚本；`upstream-overlay/` 是修改后的上游文件。

固定上游：[laurent22/joplin](https://github.com/laurent22/joplin)，提交 `e41516e669efb693b009bedb21f3eb1fcbea4fc9`。克隆本仓库后，在根目录执行：

```sh
git clone https://github.com/laurent22/joplin.git upstream-joplin
git -C upstream-joplin checkout e41516e669efb693b009bedb21f3eb1fcbea4fc9
node dot-notes/scripts/build.cjs
node dot-notes/scripts/integrate.cjs
node --test dot-notes/test/*.test.cjs
```

需要 Node.js 24+ 和系统 tar。本地逻辑测试没有 npm 依赖。也可从固定提交的官方源码归档恢复，将 upstream-overlay 内文件覆盖到 upstream-joplin；上游未修改文件及各目录许可证必须保留。

Android 完整构建需要另外准备 JDK、Android SDK/NDK、Gradle 和上游依赖。详见 [构建说明](dot-notes/BUILDING.md)。PowerShell 脚本提供可配置的 BuildRoot 和 JavaHome；默认路径仅为原开发机配置，需要按本机修改。macOS 构建必须在获授权的 Mac 上进行。

## 许可

合并的 Joplin 衍生应用遵循 AGPL-3.0-or-later 及上游目录各自的许可；根 LICENSE 为 AGPL。独立编写的 dot-notes 模块使用其目录内 MIT LICENSE。参见 [上游许可与商标声明](dot-notes/UPSTREAM-LICENSE.txt)。重新分发应用须同时提供对应源码及构建修改，并保留相关许可和版权声明；Joplin 商标和图标授权不由代码许可授予。
