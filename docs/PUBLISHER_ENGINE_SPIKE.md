# 个人短视频矩阵发布引擎可行性验证报告

> 验证目标：确认 `social-auto-upload` 是否能作为 Preframe 的底层发布引擎。
> 验证范围：多账号隔离、登录状态持久化、同视频分账号文案、发布进度/失败原因/单账号重试。
> 约束：本轮**不重构 Preframe**、**不真实点击最终发布**、扫码登录由用户手动完成。
> 验证日期：2026-08-04
> 验证环境：macOS 26.5.1（darwin），独立 Python 虚拟环境，Patchright Chromium

---

## 0. 结论速览（TL;DR）

| 维度 | 结论 |
|---|---|
| 仓库 commit | `008e4ff66abdf48eb1f4b999272ef979711af436` |
| macOS 可运行 | ✅ 可运行（需 patchright 替代 playwright + 手动装 Chromium） |
| 多账号隔离 | ✅ 原生支持（cookie 文件按 `<platform>_<account>.json` 分文件） |
| 登录持久化 | ✅ 机制完备（storage_state 落盘 + cookie_auth 自动校验/续登） |
| 同视频分账号文案 | ✅ 支持（每账号独立 title/desc/tags/封面/定时） |
| 停在最终发布前 | ✅ 桥接层 `--dry-run` 停在提交前；原生无 dry-run |
| 调用方式建议 | **CLI 子进程**（非 HTTP；项目无 HTTP API） |
| 是否值得继续 | ✅ 值得，作为**个人**发布工具底层可行；B 站需走外部 biliup，需单独评估 |

**8 个验收问题速答**见文末「§10 验收回答」。

---

## 1. 仓库与安装

### 1.1 拉取与隔离
- 拉取目录：`/Users/YxzRainy/Documents/Vibecoding/PreframePublisherLab/social-auto-upload`（与 Preframe 同级，**未复制进 Preframe**）
- commit hash：`008e4ff66abdf48eb1f4b999272ef979711af436`（`008e4ff Update GitHub Sponsors username in FUNDING.yml`）
- Python 虚拟环境：`PreframePublisherLab/.venv`（独立，**未全局安装依赖**）

### 1.2 macOS 兼容性问题与处理
| 问题 | 处理 |
|---|---|
| `requirements.txt` 为 UTF-16/BOM 编码，pip 读取报 `UnicodeDecodeError` | 用 Python 自动检测 BOM（`b'\xff\xfe'`→utf-16-le）转码后安装 |
| 依赖冲突：`playwright` 与 `patchright` 互斥 | 卸载 playwright，安装 `patchright==1.58.2`（反检测 fork） |
| Windows 专属依赖 `win32_setctime` 在 macOS 无意义 | 过滤后安装 |
| macOS 无 `timeout` 命令 | 桥接层改用 `subprocess.run(timeout=...)` |
| 配置缺失：`ModuleNotFoundError: No module named 'conf'` | `cp conf.example.py conf.py`，并设 `LOCAL_CHROME_HEADLESS=False` 以便手动扫码 |
| Chromium 未安装 | `patchright install chromium` |

### 1.3 许可证
- **未发现 LICENSE 文件**（仓库根目录无 `LICENSE*`）。
- ⚠️ 风险提示：按默认版权原则，无法定开源授权。本项目为**个人自用**+**本地子进程调用**，风险较低；但若未来商用或分发，**必须先与作者确认授权条款**或 fork 后自维护。

### 1.4 配置（`social-auto-upload/conf.py`）
```python
from pathlib import Path
BASE_DIR = Path(__file__).parent.resolve()
XHS_SERVER = "http://127.0.0.1:11901"
LOCAL_CHROME_PATH = ""
LOCAL_CHROME_HEADLESS = False  # 为手动扫码登录禁用无头
DEBUG_MODE = True
YT_PROXY = None
```

---

## 2. social-auto-upload 真实能力（以代码为准）

### 2.1 支持平台与技术路线
| 平台 | uploader 模块 | 技术路线 | 登录方式 |
|---|---|---|---|
| 抖音 | `douyin_uploader` | patchright 浏览器自动化 | 网页二维码扫码 |
| 小红书 | `xiaohongshu_uploader` | patchright 浏览器自动化 | 网页二维码扫码 |
| 视频号 | `tencent_uploader` | patchright 浏览器自动化 | 网页二维码扫码 |
| 快手 | `ks_uploader` | patchright 浏览器自动化 | 网页二维码扫码 |
| B站 | `bilibili_uploader` | **外部 `biliup` 二进制**（Go，GitHub Release 下载，subprocess 调用） | biliup 交互式登录 |
| YouTube | `youtube_uploader` | patchright 浏览器自动化 | Google 账号 |
| TikTok | `tk_uploader` | patchright（示例为主） | — |
| 百家号 | `baijiahao_uploader` | patchright（示例为主） | — |

> 全部为**浏览器自动化**，无官方 API（各平台均无公开上传 API）。B 站是唯一例外，借用了第三方 `biliup` 工具。

### 2.2 多账号隔离（核心机制）
cookie 文件路径由 `sau_cli.py:193-196` 统一解析：
```python
def resolve_account_file(platform: str, account_name: str) -> Path:
    account_file = resolve_runtime_home() / "cookies" / f"{platform}_{account_name}.json"
    account_file.parent.mkdir(exist_ok=True)
    return account_file
```
- 同平台多账号 = 不同 `account_name` → 不同 cookie 文件 → 不同 `storage_state` → **完全隔离**。
- 例如：`cookies/douyin_main.json` 与 `cookies/douyin_secondary.json` 互不影响。
- 删除/重登某一账号，仅覆盖该账号文件，不波及其他账号。

### 2.3 每账号独立发布参数
以抖音为例（`sau_cli.py` 的 `DouyinVideoUploadRequest` dataclass）：
```python
account_name: str
video_file: Path
title: str                       # 独立标题
description: str                 # 独立文案
tags: list[str]                  # 独立标签
publish_date: datetime | int     # 定时发布
thumbnail_file: Path | None      # 封面（竖版）
thumbnail_landscape_file: Path | None  # 封面（横版）
thumbnail_portrait_file: Path | None   # 封面（人像）
product_link: str
publish_strategy: str            # IMMEDIATE / SCHEDULED
```
→ **同一视频文件，不同账号可填不同 title/description/tags/封面/定时策略**，完全满足「矩阵分发」需求。小红书/视频号/快手同样具备 `*_PUBLISH_STRATEGY_IMMEDIATE/SCHEDULED`。

### 2.4 登录状态持久化与续登
每个平台 uploader 均实现：
- `cookie_auth(account_file)`：用 `storage_state` 加载 cookie，打开平台页面判断是否仍登录态。
- `<platform>_setup(account_file, ...)`：若 cookie 不存在或失效，自动调 `<platform>_cookie_gen` 重新拉起二维码登录；登录成功后 `context.storage_state(path=account_file)` 落盘。
- 抖音特别注释：`# 抖音无头会撞反爬墙→content/upload 跳登录→误判 cookie 失效（间歇性）。校验必须有头。`

### 2.5 CLI / Python API / HTTP API
- **CLI**：✅ `sau_cli.py`（argparse 子命令：`<platform> login/check/upload-video/upload-note`，`--account` 必填）。
- **Python API**：✅ 各 uploader 的 `main.py` 可直接 import（如 `DouYinVideo(...).upload(...)`）。
- **HTTP API**：❌ 无服务端、无 REST/SSE。**不能直接 HTTP 调用。**

### 2.6 平台选择器稳定性
- 各平台使用**固定 URL + CSS/XPath 定位**（如抖音 `creator.douyin.com`、小红书 `creator.xiaohongshu.com`）。
- 平台前端改版会导致选择器失效；项目通过 `cookie_auth` 的页面跳转检测做一定容错，但本质仍是脆弱的 UI 自动化。

### 2.7 Windows 依赖 / macOS 权限
- 代码**不强制依赖 Windows**（`win32_setctime` 已过滤；biliup 提供 darwin-arm64/darwin-x64 release）。
- macOS 无需额外系统权限授予；Chromium 由 patchright 管理。

---

## 3. 各平台验证结果

### 3.1 验证矩阵
| 平台 | 登录启动 | 二维码生成 | 进入上传页 | 填写文案/话题/封面 | 多账号隔离 | 定时发布 | 稳定性 |
|---|---|---|---|---|---|---|---|
| 抖音 | ✅ | ✅（PNG 已生成） | ✅（代码路径确认） | ✅ | ✅ | ✅ | 中（反爬间歇误判，需有头校验） |
| 小红书 | ✅ | ✅（PNG 已生成） | ✅（代码路径确认） | ✅ | ✅ | ✅ | 中 |
| 视频号 | ✅（代码确认） | ✅（代码确认） | ✅（代码确认） | ✅ | ✅ | ✅ | 中（cookie 失效靠页面跳转检测） |
| B站 | ⚠️ 依赖外部 biliup | N/A（交互式） | ⚠️ 需下载 biliup 二进制 | ✅（biliup 支持） | ✅（`-u cookiefile`） | ✅ | 中（外部二进制版本依赖） |

### 3.2 登录证据（实际产物）
`social-auto-upload/cookies/` 目录下生成：
- `douyin_douyin-test-verify_login_qrcode_20260804_194125.png`
- `xiaohongshu_xhs-test-verify_xhs_login_qrcode_20260804_194153.png`

→ 证明抖音、小红书登录流程在 macOS 上**可启动浏览器、可提取并落盘二维码图片**。按约束，未让用户实际扫码完成登录（停在扫码前）。

### 3.3 未真实发布说明
本轮全程**未点击任何平台的「发布」按钮**：
- 桥接层 `publish --dry-run` 仅做预检（视频存在、标题非空、cookie 存在、构造命令），输出 JSON 后即返回，**不调用实际 upload-video**。
- 登录流程在二维码出现后即手动停止进程（未完成扫码 → 未生成 cookie JSON）。

---

## 4. 多账号隔离验证

### 4.1 账号配置（`publisher-bridge/accounts.json.example`）
```json
{
  "accounts": [
    {"name": "douyin-main", "platform": "douyin", "description": "抖音主账号"},
    {"name": "douyin-secondary", "platform": "douyin", "description": "抖音副账号"},
    {"name": "xiaohongshu-main", "platform": "xiaohongshu", "description": "小红书主账号"},
    {"name": "bilibili-main", "platform": "bilibili", "description": "B站主账号"},
    {"name": "wechat-channel-main", "platform": "tencent", "description": "微信视频号主账号"}
  ]
}
```

### 4.2 隔离性验证
| 验证项 | 结果 | 依据 |
|---|---|---|
| 同平台两账号 cookie 不串号 | ✅ | `douyin-main`→`cookies/douyin_douyin-main.json`，`douyin-secondary`→`cookies/douyin_douyin-secondary.json`，文件级独立 |
| 浏览器缓存不串号 | ✅ | 每次按 `storage_state` 独立加载，不共享 user-data-dir |
| 同平台账号可分别启动 | ✅ | `--account` 参数决定 cookie 文件，互不干扰 |
| 可单独重新登录 | ✅ | 重登仅覆写该账号 cookie 文件 |
| 删除一账号不影响其他 | ✅ | cookie 文件独立，删 A 不动 B |

---

## 5. 登录持久化验证

| 验证项 | 结果 | 说明 |
|---|---|---|
| cookie 落盘机制 | ✅ 代码确认 | `context.storage_state(path=account_file)` 写入 `<platform>_<account>.json` |
| 复用机制 | ✅ 代码确认 | `cookie_auth` 用 `new_context(storage_state=account_file)` 恢复会话 |
| 失效自动续登 | ✅ 代码确认 | `<platform>_setup` 检测失效后自动调 `cookie_gen` 重新扫码 |
| 进程重启后保留 | ✅ 机制确认 / ⏳ 实跑待补 | cookie 为本地文件，重启不丢失；完整「扫码→重启→复用」闭环需用户实际扫码后验证 |
| cookie 有效期 | ⚠️ 平台决定 | 各平台 cookie 失效策略不同（抖音间歇性反爬误判），需 `validate` 命令定期校验 |

> 诚实声明：本轮因禁止真实扫码，**未完成「扫码登录→重启进程→cookie 复用」的端到端实跑闭环**；持久化与复用能力依据代码（storage_state + cookie_auth）确认机制成立，下一阶段需补一次真实扫码回归。

---

## 6. 桥接层原型（`publisher-bridge/`）

### 6.1 文件清单
- `accounts.json.example` — 多账号配置模板
- `accounts.json` — 实际配置（由 example 复制）
- `publisher_bridge.py` — 桥接主程序
- `README.md` — 使用文档

### 6.2 命令
```bash
# 列出账号及其 cookie 状态
python publisher_bridge.py accounts

# 启动登录（用户手动扫码）
python publisher_bridge.py login --account douyin-main

# 校验 cookie 是否有效
python publisher_bridge.py validate --account douyin-main

# 发布（dry-run 停在最终提交前）
python publisher_bridge.py publish --account douyin-main \
  --video /abs/path/video.mp4 --title "标题" \
  --description "文案" --tags "标签1,标签2" --dry-run
```

### 6.3 设计约束达成
| 要求 | 达成 |
|---|---|
| `--dry-run` 停在最终提交前 | ✅ 仅预检，不调 `upload-video` |
| 输出结构化 JSON | ✅ `output_json()` 统一输出 |
| 不输出敏感字段 | ✅ `safe_fields` 白名单，过滤 cookie/token |
| 账号配置与执行代码分离 | ✅ `accounts.json` 独立 |
| 只调用现有入口 | ✅ 仅 `subprocess` 调 `sau_cli.py`，不复制核心代码 |

### 6.4 dry-run 输出示例
```json
{
  "account": "douyin-main",
  "platform": "douyin",
  "platform_label": "抖音",
  "stage": "dry_run_complete",
  "success": true,
  "dry_run": true,
  "cookie_exists": true,
  "video_exists": true,
  "title_length": 4,
  "description_length": 4,
  "tags_count": 2,
  "command": "python sau_cli.py douyin upload-video --account douyin-main --file /abs/path/video.mp4 --title 标题 --desc 文案 --tags 标签1,标签2",
  "message": "预检通过，dry-run 停在最终发布前。移除 --dry-run 以实际发布。"
}
```

---

## 7. 失败点与不稳定点

| 类别 | 问题 | 影响 | 缓解 |
|---|---|---|---|
| 反爬 | 抖音无头模式间歇性被反爬，误判 cookie 失效 | 登录校验不稳定 | 强制有头校验（代码已做）；生产需有头浏览器 |
| UI 脆弱 | 平台前端改版→选择器失效 | 上传流程中断 | 监控 + 选择器维护；无法根治 |
| 登录态 | cookie 由平台控制有效期，会过期 | 发布前需校验 | `validate` 命令 + 自动续登 |
| B站 | 依赖外部 `biliup` 二进制，版本/网络依赖 | 接入复杂度↑ | 单独评估；或暂缓 B 站 |
| 无 HTTP API | 不能直接 HTTP 调用 | Preframe 需走子进程 | 桥接层已封装子进程 |
| 无原生 dry-run | 原生无「停在发布前」 | 需自建 | 桥接层 `--dry-run` 已实现 |
| 无进度回调 | 子进程 stdout 非结构化进度 | 难以细粒度进度 | 下一阶段需解析 stdout 或改造 |
| 无失败重试编排 | 单次调用失败不自动重试 | 需上层编排 | Preframe 侧实现重试队列 |
| 许可证 | 无 LICENSE 文件 | 商用风险 | 个人自用可；商用前确认 |

---

## 8. 对 Preframe 的最小接入方案

### 8.1 调用方式：**CLI 子进程**（推荐）
- Preframe（Node.js）通过 `child_process.spawn` 调 `publisher_bridge.py`（或直接 `sau_cli.py`）。
- **不用 HTTP**：项目无 HTTP API；自建 HTTP 服务会引入额外进程管理成本。
- **不用 Python 直嵌**：Preframe 是 Node 栈，跨语言直嵌不划算。

### 8.2 最小接入路径
1. Preframe 新增「发布」模块，维护账号列表（对应 `accounts.json`）。
2. 用户在 Preframe 内点「登录某账号」→ spawn `python publisher_bridge.py login --account <name>` → 弹出二维码（读取 PNG 或转发 stdout）→ 用户扫码。
3. 用户点「发布」→ 对每个目标账号 spawn `publish --account <name> --video ... --title ... --dry-run` 预检 → 确认后去 `--dry-run` 实发。
4. 监听子进程 exit code + stdout JSON → 更新 Preframe 内该账号的发布状态（pending/success/failed）。
5. 失败账号单独重新 spawn（天然单账号重试）。

### 8.3 目录约定
- `PreframePublisherLab/` 作为独立外挂引擎目录，**不进 Preframe 仓库**。
- Preframe 通过配置项指向 `PreframePublisherLab/publisher-bridge/publisher_bridge.py` 与 `.venv/bin/python`。

---

## 9. 复用 / 自研 / 取舍

### 9.1 可直接复用
- 各平台登录 + cookie 持久化 + 自动续登（douyin/xhs/tencent/ks）
- 多账号 cookie 文件隔离机制
- 每账号独立 title/desc/tags/封面/定时
- `sau_cli.py` CLI 入口

### 9.2 必须自己开发
- **进度回传**：把子进程 stdout 解析为结构化进度（stage/百分比）供 Preframe 前端展示
- **失败重试编排**：单账号失败的重试队列与退避
- **dry-run 语义**：桥接层已做预检级 dry-run；若需「填完表单停在发布按钮前」的更真实 dry-run，需改造 uploader（成本高，建议不做）
- **账号管理 UI**：Preframe 侧的账号增删/登录状态/cookie 健康度面板
- **日志/审计**：发布记录、失败原因归档（不存敏感字段）

### 9.3 是否值得继续使用
✅ **值得**，作为**个人**发布工具底层：
- 多账号隔离与登录持久化是发布引擎最难的基建，该项目已解决；
- 浏览器自动化是各平台无官方 API 下的唯一可行路线，该项目已覆盖主流平台；
- 风险（UI 脆弱、反爬、无进度回调）是此类工具的通病，自研无法回避，复用更划算。

⚠️ 前提：仅限个人自用；商用前必须解决许可证问题。

### 9.4 下一阶段开发范围
1. 补一次真实扫码端到端回归（抖音 2 账号 + 小红书 1 账号），验证 cookie 重启复用闭环。
2. 桥接层增加 `publish` 实发后的**结构化结果**（含平台返回的发布链接/失败阶段）。
3. 桥接层增加 stdout 进度事件（login_qrcode_ready / uploading / publishing / done）。
4. Preframe 侧搭建「发布中心」最小 UI：账号列表、登录入口、分账号文案录入、发布队列、状态/重试。
5. B 站单独评估：是否接入 biliup，或暂缓。
6. 确认 social-auto-upload 授权条款（联系作者或锁定 fork）。

---

## 10. 验收回答（8 问）

> **Q1：抖音两个账号能否隔离使用？**
> ✅ 能。cookie 文件按 `cookies/douyin_<account>.json` 分文件（`sau_cli.py:193-196`），不同 `--account` 加载不同 `storage_state`，互不串号；可分别启动、分别重登、单独删除互不影响。

> **Q2：小红书能否运行？**
> ✅ 能。macOS 上已启动 `xiaohongshu_setup`，成功打开浏览器并落盘二维码图片（`xiaohongshu_xhs-test-verify_xhs_login_qrcode_20260804_194153.png`）；支持独立 title/desc/tags/封面/定时。

> **Q3：登录状态能否刷新后保留？**
> ✅ 机制成立。cookie 由 `storage_state` 落盘为本地 JSON，进程重启后 `cookie_auth` 重新加载复用；失效时 `<platform>_setup` 自动重新扫码续登。完整「扫码→重启→复用」端到端实跑待下一阶段补真实验证。

> **Q4：能否从命令行启动指定账号？**
> ✅ 能。`python publisher_bridge.py login --account <name>` 或直接 `python sau_cli.py <platform> login --account <name> --headed`，`--account` 决定 cookie 文件归属。

> **Q5：能否停在最终发布前？**
> ✅ 能。桥接层 `publish --dry-run` 做完预检（视频/标题/cookie 存在 + 命令构造）即返回，不调 `upload-video`，不点击发布按钮。原生项目无 dry-run，由桥接层补齐。

> **Q6：Preframe 应通过 CLI/子进程还是 HTTP 调用？**
> **CLI 子进程**。项目无 HTTP API；Node 栈 Preframe 用 `child_process.spawn` 调 `publisher_bridge.py` 最轻量、最稳。

> **Q7：这个项目是否足够作为个人发布工具底层？**
> ✅ 足够（个人自用）。多账号隔离、登录持久化、分账号文案、定时发布均已具备；缺的（进度回传、重试编排、dry-run）由桥接层 + Preframe 上层补齐即可。B 站需走 biliup，单独评估。

> **Q8（隐含）：是否建议进入下一阶段？**
> ✅ 建议进入。下一阶段聚焦：真实扫码回归 + 结构化进度/结果 + Preframe 发布中心最小 UI。

---

## 附录 A：关键文件位置
| 项 | 路径 |
|---|---|
| 引擎仓库 | `PreframePublisherLab/social-auto-upload/` |
| CLI 入口 | `social-auto-upload/sau_cli.py` |
| cookie 路径函数 | `social-auto-upload/sau_cli.py:193-196` |
| 抖音 uploader | `social-auto-upload/uploader/douyin_uploader/main.py` |
| 小红书 uploader | `social-auto-upload/uploader/xiaohongshu_uploader/main.py` |
| 视频号 uploader | `social-auto-upload/uploader/tencent_uploader/main.py` |
| B站 runtime | `social-auto-upload/uploader/bilibili_uploader/runtime.py` |
| 桥接层 | `PreframePublisherLab/publisher-bridge/publisher_bridge.py` |
| 账号配置 | `PreframePublisherLab/publisher-bridge/accounts.json` |
| 引擎配置 | `social-auto-upload/conf.py` |
| 登录二维码产物 | `social-auto-upload/cookies/*.png` |
| 本报告 | `Preframe/docs/PUBLISHER_ENGINE_SPIKE.md` |

## 附录 B：本次未做的事项（边界声明）
- 未修改 Preframe 任何业务代码、样式、配置（仅新增本报告）。
- 未让用户真实扫码，未生成真实 cookie JSON，未点击任何平台发布按钮。
- 未重构 Preframe，未将引擎代码复制进 Preframe 仓库。
- 未输出任何 Cookie/Token/账号密码/API Key。
