# 片策

「片策」是一套本地运行的短视频前期策划工作台。输入选题、平台、内容主体、内容领域与内容风格后，它通过 DeepSeek API 创建短视频内容项目，并生成 8 份前期策划包 Markdown。

项目同时提供本地 CLI 和 Next.js 可视化工作台，不含登录、数据库、云端部署或 SaaS 功能。

## 环境要求

- Node.js 18 或更高版本
- npm
- 可用的 DeepSeek API Key

## 安装

```bash
git clone <你的仓库地址>
cd /path/to/项目目录
npm install
```

## Web 可视化工作台

开发模式启动：

```bash
npm run dev:web
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。首页可以填写选题并预览 8 份 Markdown；“历史项目”页面读取本地 `output` 目录；项目详情页支持 Markdown 渲染、单文件导出、生成修改版和扫描本地素材文件夹。在“07_视觉参考提示词”中还可以选择常用比例并生成封面图片。旧项目中的 `06_视觉参考提示词.md` 仍可继续使用封面生成器。

生产模式本地运行：

```bash
npm run build:web
npm run web
```

Web API Route 只在 Node.js 服务端读取 `.env` 并调用 DeepSeek，API Key 不会进入浏览器代码。Web 服务和素材目录必须位于同一台电脑，素材扫描框应填写服务端可访问的绝对路径。

## 配置封面图片生成 API（可选）

封面模块兼容常见的 OpenAI Images API 请求与返回格式。所有配置仍只保存在服务端 `.env`：

```env
IMAGE_API_KEY=你的图片生成_API_Key
IMAGE_API_URL=https://api.example.com/v1/images/generations
IMAGE_MODEL=你的图片生成模型名
IMAGE_API_SIZE_FIELD=size
IMAGE_API_EXTRA_BODY={}
```

- `IMAGE_API_URL` 填写完整的图片生成接口地址。
- `IMAGE_API_SIZE_FIELD` 默认是 `size`，会发送 `1024x1024` 等尺寸；若供应商使用比例参数，可改为 `aspect_ratio`，此时发送 `3:4`、`9:16` 等比例。
- `IMAGE_API_EXTRA_BODY` 可填写供应商特有参数，例如 `{"quality":"high"}`。必须是单行 JSON 对象。
- 接口响应支持 `data[0].b64_json`、`data[0].url` 以及常见的 `images[0]` 变体。
- 支持 `1:1`、`3:4`、`4:3`、`9:16`、`16:9` 五种常用比例。

生成的封面会保存在 `output/<项目>/covers/`。图片 API 未配置时，不影响策划生成、refine、scan 和其他 Web 功能。

## 配置 DeepSeek API

复制环境变量示例：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
DEEPSEEK_API_KEY=你的DeepSeek_API_Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
```

- `DEEPSEEK_API_KEY` 必填，工具不会在代码或输出文件中保存它。
- `DEEPSEEK_BASE_URL` 可选，默认值为 `https://api.deepseek.com`。
- `DEEPSEEK_MODEL` 可选，默认值为 `deepseek-v4-flash`。可改为你的账号实际支持的 `deepseek-v4-pro` 或其他 OpenAI-compatible 模型名称。
- `.env` 已加入 `.gitignore`，不要将真实密钥提交到 Git。

如果 API Key 缺失、网络失败、API 报错、模型返回为空或输出无法解析，CLI 会显示对应错误，不会写入不完整的项目。

## 使用方法

### 创建内容项目

```bash
npm run generate
```

按照提示输入选题主题、平台、内容主体、内容领域、内容风格、目标用户及可选补充要求。内容主体和领域均支持自由填写。前期策划包保存在 `output/<选题>/`。若项目目录重名，会自动追加 `_2`、`_3`，不会覆盖旧项目。

### 修改已有内容

```bash
npm run refine
```

选择已有项目、要修改的口播脚本/分镜与剪辑节奏/封面标题与发布文案（或全部），再输入修改意见。修改结果以 `_修改版.md` 保存，原文件不会被覆盖。旧项目中的口播脚本、分镜草案和封面标题文件名会自动兼容。

### 扫描素材文件夹

```bash
npm run scan
```

输入本地素材目录，工具会递归整理普通文件的名称、类型、大小、修改时间、子文件夹和可能用途。选择项目后，会写入 `00_素材索引.md`。第一版只读取文件元数据，不识别视频画面或图片内容；符号链接会被跳过。

### 其他命令

```bash
npm run dev -- --help  # 查看 CLI 帮助
npm run build          # 编译 TypeScript 到 dist/
npm start -- generate  # 使用编译产物运行 generate
```

## 示例输出

```text
output/
  水光针适合什么人/
    00_素材索引.md
    01_项目概览.md
    02_选题拆解.md
    03_口播脚本.md
    03_口播脚本_修改版.md
    04_分镜与剪辑节奏.md
    05_拍摄清单.md
    06_封面标题与发布文案.md
    07_视觉参考提示词.md
    08_内容质检报告.md
    covers/
      cover_2026-06-20T15-30-00-000Z_3x4.png
    project.json
```

`project.json` 记录本次输入参数、实际配置的模型名称和生成时间，不包含 API Key。

## 项目结构

```text
src/
  commands/       # generate、refine、scan 交互命令
  prompts/        # 模型提示词与结构化输出解析
  services/       # 模型、文件、项目和素材扫描服务
  utils/          # 文档定义、文件名清理与 Markdown 格式化
  index.ts        # CLI 入口
web/
  app/            # Next.js 页面与 API Route
  components/     # 表单、项目列表与 Markdown 预览
```

命令层、模型调用和文件服务彼此分离，后续 Next.js 页面可直接复用 `prompts/` 与 `services/` 中的核心逻辑。

## 后续可扩展方向

- 增加 Next.js 可视化界面与任务进度
- 支持更多 OpenAI-compatible 模型供应商
- 增加模板、品牌语气与团队工作流
- 接入视频理解，自动标注素材内容
- 增加历史版本比较与导出格式

## 安全提示

请定期轮换 API Key，并在提交代码前确认 `.env` 未被纳入版本控制。生成的内容仍需人工审核，尤其是医疗、金融、法律等高风险领域。
