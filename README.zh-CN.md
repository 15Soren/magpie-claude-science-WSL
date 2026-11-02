# Claude Science for Magpie

[English](README.md) · 简体中文

本项目基于 [Guuuu233/claude-science-for-magpie](https://github.com/Guuuu233/claude-science-for-magpie) 二次开发，感谢 Guuuu233 的工作。该项目基于 [Sia 的原项目](https://github.com/shiyang1026/magpie-claude-science)，同样感谢 Sia 及所有贡献者。本仓库保留原项目的 MIT 版权和许可证声明。

本项目尚未发布独立 npm 包；`magpie-claude-science@latest` 指向原项目，并不包含本仓库的 WSL 修改。

在 Claude Science 中使用 Magpie 的模型。支持 Windows 上运行 Magpie、WSL 中运行 Claude Science：WSL 服务直接连接 Magpie 网关，不需要安装 Magpie 插件。也保留原有 macOS 安装方式。

**实验版。** WSL 模式已在 Science **0.1.71**、Windows Magpie **0.1.2048** 上验证服务启动及模型请求；macOS 模式此前验证 Science **0.1.60**、Magpie **0.1.1219**。

## Windows + WSL 快速开始

需要 Windows 上运行 Magpie，WSL 中安装 Claude Science、Linux 版 Node.js 22+ 和启用了 systemd 的用户服务。WSL 中确认 `systemctl --user status` 可用。网关必须能从 WSL 通过回环地址访问；默认 `http://127.0.0.1:3425`，无法访问时检查 WSL 网络模式及 Magpie 的监听设置。

在本仓库的 WSL 终端中执行：

```sh
npm ci --ignore-scripts
node src/cli.js install --gateway http://127.0.0.1:3425
mycsci
```

安装时用方向键浏览模型，空格选择或取消选择，回车确认；`mycsci` 会启动或检查桥接服务并输出一次性链接，将链接粘贴到 Windows 浏览器。已安装旧版本的用户可在本仓库运行 `node src/cli.js register` 注册该命令，需确保 `~/.local/bin` 在 PATH 中。非交互安装可加 `--model <模型ID>`；使用受保护的网关时，可在安装前通过环境变量 `MAGPIE_GATEWAY_KEY` 提供密钥，密钥存放在 WSL 用户的私有状态文件中。模型目录保留 Magpie 提供的上下文长度、输出上限、模态、工具能力和推理等级，并向 Science 提供；Science 对部分能力和推理选项的实际支持取决于其自身版本。

```sh
node src/cli.js doctor
node src/cli.js models                    # 打开模型多选界面
node src/cli.js models --model <模型ID>    # 添加指定模型
node src/cli.js upgrade --gateway http://127.0.0.1:3425
node src/cli.js restart
node src/cli.js uninstall
```

卸载会停止 WSL 用户服务并恢复 Science 配置，保留独立会话和身份数据。WSL 服务仅在 WSL 和用户 systemd 会话运行时可用；请保持 Windows Magpie 启动。

## macOS 快速开始

需要 macOS、官方发行的 Node.js 22+，以及已安装的 Claude Science 和 Magpie。启动 Magpie，启用至少一个模型，结束正在运行的 Science 任务，然后在本仓库目录中执行：

```sh
npm ci --ignore-scripts
node src/cli.js install
```

按提示选择模型。无人值守安装时，用 `--model` 指定 Magpie 模型列表中的 ID。安装器读取 Magpie 网关端口，并选择空闲的本地端口；更多选项见 `node src/cli.js --help`。

**仅在 Magpie 中添加插件，不能完成全部安装。** 安装器配置 macOS LaunchAgent，把运行文件、生产依赖及 Node 复制到独立版本目录。后台运行不再依赖 checkout 或 npm 缓存。部分 Homebrew Node 依赖外部动态库，会被拒绝，需改用官方 Node。

打开原来的 **Claude Science.app**。首次 “Sign in” 仅确认本地浏览器会话，无需登录 Anthropic。保持 Magpie 运行，在其 Agent 页面切换模型。

### 点 Sign in 后仍显示 Sign in on the web / Paste code instead

这表示当前页面进入了 Science 的账号登录流程；先检查接入是否完成，不要以浏览器已有登录状态判断安装成功：

```sh
node src/cli.js doctor
```

如果提示本地服务未初始化，执行上面的 `install`。如果服务已安装，检查输出中的服务状态和 `sciencePort`，重新打开 App 进入受管服务。仅凭 `localhost:8765` 或其他端口不能判断是否接入成功。如果 `doctor` 仍报错，请提供错误摘要，不要提供令牌、完整私有日志或 `state.json`。

## 管理

```sh
node src/cli.js doctor
node src/cli.js restart
node src/cli.js upgrade    # 从更新后的源码或软件包执行
node src/cli.js rollback   # 恢复上一个托管运行版本
node src/cli.js uninstall  # 恢复原配置，保留会话数据
```

执行上述生命周期操作前，请先结束正在运行的 Science 任务。升级保留本地身份与会话，启动失败时恢复旧服务。早期依赖源码目录的版本可以通过 `upgrade` 迁移；`rollback` 需要已有上一份托管版本。

## 工作方式

```text
Claude Science → 本地兼容服务 → Magpie → 选定的供应商 / 模型
```

数据、本地身份及分版本运行文件保存在 `~/.config/magpie/claude-science-runtime/`，原凭证和 App 二进制保留。只有确认后台进程归属并通过健康检查后，才重定向原配置。停用或卸载会恢复配置；若检测到用户修改，则保留并报告冲突，交由手动处理。

## 当前限制

- macOS 模式使用一个 Magpie 上游模型；WSL 模式可选择多个模型，但 Science 对能力与推理等级的支持取决于其自身版本。
- 不提供 Anthropic 托管的搜索、MCP 和账号服务。
- 完整科研流程、长会话和图片支持尚未验证。
- 已自动化测试受管孤儿进程恢复和程序更新检测；真实 macOS 重启竞态及后续 Science 版本仍需验证。Science 更新后，请先结束任务再重启接入。
- 暂不支持自定义 XDG 配置根或已迁移的 Science 数据目录。

## 开发与发布

```sh
npm test
npm run check:package
npm run test:integration  # 需要 Magpie 和 Bun；使用隔离目录和模拟上游
```

继承的 CI 配置覆盖 Node 22/24 × Linux/macOS、打包部署检查及固定版本的 Magpie 集成。继承的发布工作流仅适用于原仓库，不会发布本二次开发版本；参见[原项目发布配置](docs/publishing.md)。

反馈问题时请附版本、`doctor` 输出和复现步骤，不要附带凭证或私人日志。更多内容：[运维说明](docs/operations.zh-CN.md)、[Magpie 文档](https://usemagpie.ai/docs/zh/plugins)。

## 许可证

[MIT](LICENSE)。独立社区项目，与 Anthropic、Magpie 无隶属关系。

Claude Science 图标归原权利人所有，不适用本项目的 MIT 许可证。
