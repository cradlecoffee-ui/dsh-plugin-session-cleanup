# dsh-session-cleanup

给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）用的插件：**停用历史会话，并把这场对话产生的文件收进工作区的 `手动删除` 文件夹。**

侧边栏会越用越长，而真正占地方的往往不是聊天记录，是那些会话留下的产物文件。这个插件把「清理」拆成两步都可见的动作：先改名归档，再把产物集中到一处，等你自己确认后再删。

> ⚠️ 它**不会删除任何数据**。归档只是从侧边栏隐藏，会话日志仍在磁盘上；产物只是移动，仍在 `手动删除` 里。

---

## 它长什么样

输入框右下角有一个常驻的悬浮按钮：

```
                              ┌──────────────────────────────┐
                              │ 会话清理        10 个（已停用 3）│
                              │ ☐ HARNESS清理插件开发   [当前] │
                              │ ☐ 能否控制 Blender 生成动画    │
                              │ ☐ 本地部署 COMUI 与 MiniMaxH3  │
                              │ [停用所选] [显示已停用] [刷新]  │
                              └──────────────────────────────┘
                                       ⌫ 会话清理 v1.2.0
```

点「停用所选」会切到卡片内的确认视图，逐条列出改名结果和产物去向，再点一次才真正执行。

---

## 安装

```bash
# 从 GitHub Release 的 tgz 安装
plugin_manager install_bundle \
  target: https://github.com/cradlecoffee-ui/dsh-plugin-session-cleanup/releases/download/v1.2.0/dsh-session-cleanup-1.2.0.tgz
```

或者从本地目录安装（开发时）：

```bash
plugin_manager install_bundle target: /path/to/dsh-session-cleanup
```

安装后**刷新页面**（客户端代码需要重新加载）。

---

## 停用到底做了什么

对每个被选中的会话，依次执行：

| 步骤 | 动作 | 通过什么 |
| --- | --- | --- |
| 1 | 标题改成 `已停用 YYYYMMDD` | `session.rename` |
| 2 | 从工作区导航移除 | `workspace.archiveSession`（会先停止运行中的任务） |
| 3 | 产物移入 `工作区/手动删除/已停用 YYYYMMDD/` | 宿主监听 `workspace/session-archived` 事件后自动执行 |

第 3 步**不经过界面**——界面只负责调用官方接口，产物移动是宿主在事件触发后自己完成的。

同一天停用多个时，第二个起自动加序号：`已停用 20261114-2`。

---

## 它会碰哪些文件（透明说明）

| 读 | 写 |
| --- | --- |
| `~/.dsh/sessions/**/session.v4.jsonl.zstd`（会话日志） | `<工作区>/手动删除/<标签>/`（移动产物） |
| `~/.dsh/storages/workspace.json`（默认工作区路径） | `~/.dsh/session-cleanup.log`（运行日志） |
| 工作区内被引用过的文件 | 工作区内被引用过的文件（移动，不是删除） |

**不读凭据、不联网、不碰工作区以外的文件。**

---

## 界面上的标记

| 标记 | 含义 |
| --- | --- |
| **当前** | 你正在用的会话；复选框禁用，执行前还有二次拦截 |
| **运行中** | 该会话此刻有任务在跑 |
| **最近** | 3 分钟内有活动，确认视图会额外提醒 |
| 已停用 | 标题以 `已停用` 开头，默认隐藏；「显示已停用」可展开 |

---

## 已知限制

- **不能恢复**：插件不提供「取消归档」，归档后标题会一直是 `已停用 …`。
- **产物按「这场对话引用过的路径」归属**：多个会话共同编辑过同一个文件时，会被**先停用的那场**带走。
- **只移动文件，不移动目录**：空目录会留在工作区。
- **产物必须仍存在**：日志里记过但后来被删掉的文件不会被移动。
- **早期会话**可能因为日志里没有完整路径而扫不到产物。

---

## 附带的工具

宿主注册了一个工具 `session_cleanup`，可用于排查或手动补做：

| action | 作用 |
| --- | --- |
| `list` | 列出工作区会话（id、时间、日志大小） |
| `scan` | 只读：列出某会话引用过的现存文件 |
| `collect` | 扫描并移动某个会话的全部产物 |
| `move` | 移动指定的文件列表 |

---

## 排查

```bash
cat ~/.dsh/session-cleanup.log
```

正常情况下会看到：

```
listener registered
event workspace/session-archived {"sessionId":"session-..."}
auto moved 11/11 session-...
```

- 只有 `listener registered`、没有 `event` → 事件没触发（检查 DSH 版本）
- 有 `event` 但没有 `auto moved` → 产物提取失败，先跑 `session_cleanup scan` 看能否扫到文件

---

## 开发

```bash
pnpm pack                       # 打成 tgz
plugin_manager remove_bundle    # 卸载旧版
plugin_manager install_bundle   # 装新版
# 然后刷新页面
```

改界面只需要动 `client.js` 顶部的 `UI` 对象。

---

## License

MIT
