---
summary: "Memory (LanceDB) plugin: enable long-term memory with auto-recall and optional auto-capture"
read_when:
  - You want automatic injection of relevant memories into every turn (auto-recall)
  - You are switching from memory-core to memory-lancedb
  - You need a step-by-step guide to enable the LanceDB memory plugin
title: "Memory (LanceDB) Plugin"
---

# Memory (LanceDB) — 启用手册

Memory (LanceDB) 是 OpenClaw 自带的长期记忆插件：用 LanceDB 存向量记忆，并在每次对话前**自动**把与当前输入最相关的记忆注入到上下文中（auto-recall），还可选**自动抓取**对话中的重要信息（auto-capture）。

本手册按步骤说明如何从默认的 memory-core 切换到 memory-lancedb 并完成基本配置。

## 前置条件

- **OpenAI API Key**：memory-lancedb 使用 OpenAI 的 embedding 接口（如 `text-embedding-3-small`）。需要有效的 API Key；也可在配置里用环境变量 `${OPENAI_API_KEY}`。
- **Gateway 有权限写磁盘**：数据库默认落在 `~/.openclaw/memory/lancedb`，需确保该目录可写。

## 第一步：启用插件并占用 memory 槽位

memory-lancedb 是**捆绑插件**，需要显式启用并指定为当前记忆实现。  
**注意**：该插件的 `config` 必填 `embedding.apiKey`。若先只执行 `plugins enable` 而不写 config，保存配置时会校验失败。建议按下面顺序：先写好 embedding 配置（第二步），再启用并切槽位；或启用后立刻补上 `config.embedding.apiKey`。

### 1.1 启用插件

```bash
openclaw plugins enable memory-lancedb
```

若此时报错 `must have required property 'embedding'`，说明尚未配置 embedding。请先执行第二步，或手动在 `plugins.entries.memory-lancedb.config` 下添加 `embedding: { apiKey: "..." }` 后再保存。

或手动编辑配置（如 `~/.openclaw/config.json` 或项目下的 `openclaw.json`），在 `plugins.entries` 里加上（**同时写上 config.embedding**，否则校验会失败）：

```json5
{
  plugins: {
    entries: {
      "memory-lancedb": {
        enabled: true,
        config: {
          embedding: {
            apiKey: "${OPENAI_API_KEY}",
          },
        },
      },
    },
  },
}
```

### 1.2 将 memory 槽位切到 memory-lancedb

```bash
openclaw config set plugins.slots.memory memory-lancedb
```

或手动在配置里写：

```json5
{
  plugins: {
    slots: {
      memory: "memory-lancedb",
    },
  },
}
```

此时 memory-core 会不再占用 memory 槽位，由 memory-lancedb 接管。

---

## 第二步：配置 embedding（必填）

memory-lancedb 必须配置 **embedding**，用于把文本变成向量并做检索。支持：

- **OpenAI**：直接填 `embedding.apiKey`（及可选 `model`）。
- **OpenAI 兼容接口**：任意提供 `/v1/embeddings` 的端点（如 OpenRouter、vLLM、本地推理服务），通过 `embedding.baseUrl` + `embedding.apiKey`（或占位 key）+ 可选 `embedding.model`、`embedding.dimension` 配置。

当前**不内置** Hugging Face 等其它 provider；若你的服务暴露 OpenAI 兼容的 embedding API，用 `baseUrl` 即可。

### 2.1 最少配置：只填 API Key（OpenAI）

在 `plugins.entries["memory-lancedb"].config` 下设置 `embedding.apiKey`：

```bash
openclaw config set plugins.entries.memory-lancedb.config.embedding.apiKey "sk-proj-..."
```

或使用环境变量（配置里写占位符，运行时解析）：

```json5
{
  plugins: {
    entries: {
      "memory-lancedb": {
        enabled: true,
        config: {
          embedding: {
            apiKey: "${OPENAI_API_KEY}",
          },
        },
      },
    },
    slots: {
      memory: "memory-lancedb",
    },
  },
}
```

确保运行 Gateway 时 `OPENAI_API_KEY` 已导出。

### 2.2 可选：指定 embedding 模型

默认模型为 `text-embedding-3-small`。可改为 `text-embedding-3-large`（维度更大、通常效果更好、成本更高）：

```json5
"config": {
  "embedding": {
    "apiKey": "${OPENAI_API_KEY}",
    "model": "text-embedding-3-small"
  }
}
```

允许值：`text-embedding-3-small`、`text-embedding-3-large`。

### 2.3 使用火山引擎 Ark（Volcengine）embedding

火山引擎方舟的 embedding 接口**不是** OpenAI 协议，需在配置里指定 `embedding.provider: "volcengine"`，插件会走其原生 REST（`/embeddings/multimodal`，仅文本输入）。

必填：`apiKey`（Ark API Key）、`model`（如 `doubao-embedding-vision-250615`）、`dimension`（向量维度，需与模型输出一致）。可选：`baseUrl`（默认 `https://ark.cn-beijing.volces.com/api/v3`）。

示例（可用环境变量 `${ARK_API_KEY}`）：

```json5
"config": {
  "embedding": {
    "provider": "volcengine",
    "apiKey": "${ARK_API_KEY}",
    "model": "doubao-embedding-vision-250615",
    "dimension": 1024
  }
}
```

`dimension` 需与所用模型一致，请查阅火山引擎文档或接口返回。常见多模态 embedding 为 1024 维，文本模型可能不同。

### 2.4 使用 OpenAI 兼容的 embedding 接口（无 OpenAI Key 时）

若你没有 OpenAI Key，可使用任意 **OpenAI 兼容**的 embedding 服务（同一套请求/响应格式）。在 `embedding` 里增加 **baseUrl**，并视情况设置 **model** 和 **dimension**。

示例（按需替换 URL 和 key）：

```json5
"config": {
  "embedding": {
    "apiKey": "your-service-key-or-placeholder",
    "baseUrl": "https://your-embedding-server.com/v1",
    "model": "text-embedding-3-small",
    "dimension": 1536
  }
}
```

说明：

- **baseUrl**：embedding 接口的基础 URL，请求会发到 `{baseUrl}/embeddings`。例如 OpenRouter 的 embedding、自建 vLLM/llama.cpp 等提供的兼容端点。
- **model**：该端点上的模型名（默认 `text-embedding-3-small`）。若端点用别的名字（如 `BAAI/bge-small-en`），改成对应名称即可。
- **dimension**：向量维度，须与模型输出一致（默认 1536）。若模型输出 384 维，则填 `384`；否则检索会出错。常见值：384、768、1536、3072 等，需在 256–4096 之间。

若该服务需要 API key，把 key 填到 `apiKey`；若本地服务不校验 key，可填占位符（如 `dummy`），但配置项仍需存在。

---

## 第三步：确认 auto-recall / auto-capture（可选）

- **autoRecall**（自动召回）：默认 **开启**。每次用户发消息前，用当前输入做向量检索，把相关记忆注入到该轮 prompt 前面。一般保持开启即可。
- **autoCapture**（自动抓取）：默认 **关闭**。开启后会在对话结束时分析本轮内容，把符合规则的重要信息（偏好、决定、实体等）写入 LanceDB。若你希望“聊过的设定自动被记下来”，可开启。

在配置里显式写即可，例如：

```json5
"config": {
  "embedding": { "apiKey": "${OPENAI_API_KEY}" },
  "autoRecall": true,
  "autoCapture": true
}
```

---

## 第四步：重启 Gateway

修改插件或槽位后，必须重启 Gateway 才能生效。

- **macOS 菜单栏**：退出并重新打开 OpenClaw 应用，或从菜单里重启 Gateway。
- **命令行**：若你是用 `openclaw gateway run` 等方式起的进程，先停掉再重新执行一次。

重启后，memory 槽位会由 memory-lancedb 提供，`memory_search` / `memory_get` 等能力由该插件提供（若它注册了这些工具）；同时 before_agent_start 的 auto-recall 会开始往 prompt 里注入相关记忆。

---

## 第五步：验证是否生效

1. **看状态**  
   运行 `openclaw channels status` 或 `openclaw status`（视你当前版本），确认 memory 插件显示为 `memory-lancedb` 或类似说明。

2. **看日志**  
   Gateway 启动后，可查看日志中是否有 memory-lancedb 的初始化信息（例如 db 路径、embedding 模型）。若配置错误（如缺 apiKey），插件会报错并可能不加载。

3. **实际对话**  
   先和助手聊几句并刻意说一些“要记住”的内容（例如“记住：主角的能力是……”），开启 autoCapture 时这些可能被写入 LanceDB；下一轮问相关问题时，若 autoRecall 正常，回复里应能体现之前记下的内容。

---

## 配置项速查

| 配置路径                                                    | 类型    | 默认                         | 说明                                                                                                        |
| ----------------------------------------------------------- | ------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `plugins.entries.memory-lancedb.enabled`                    | boolean | —                            | 必须为 `true` 才加载插件。                                                                                  |
| `plugins.slots.memory`                                      | string  | `"memory-core"`              | 设为 `"memory-lancedb"` 才用本插件做记忆。                                                                  |
| `plugins.entries.memory-lancedb.config.embedding.apiKey`    | string  | —                            | **必填**。OpenAI API Key，可用 `${OPENAI_API_KEY}`。                                                        |
| `plugins.entries.memory-lancedb.config.embedding.provider`  | string  | `"openai"`                   | 可选。`openai`（默认）或 `volcengine`（火山引擎 Ark 原生 REST）。                                           |
| `plugins.entries.memory-lancedb.config.embedding.model`     | string  | `"text-embedding-3-small"`   | 可选。OpenAI 时仅支持上述两值；baseUrl/volcengine 时为该端点模型名（如 `doubao-embedding-vision-250615`）。 |
| `plugins.entries.memory-lancedb.config.embedding.baseUrl`   | string  | —                            | 可选。OpenAI 兼容时的基础 URL；volcengine 时默认为 `https://ark.cn-beijing.volces.com/api/v3`。             |
| `plugins.entries.memory-lancedb.config.embedding.dimension` | number  | 1536（当设置 baseUrl 时）    | 使用 baseUrl 时可选；**volcengine 时必填**（256–4096），须与模型输出维度一致。                              |
| `plugins.entries.memory-lancedb.config.dbPath`              | string  | `~/.openclaw/memory/lancedb` | 可选。LanceDB 数据目录；可改为工作区路径（如 `~/你的工作区/memory/lancedb`），支持 `~` 与绝对路径。         |
| `plugins.entries.memory-lancedb.config.autoRecall`          | boolean | `true`                       | 是否在每轮前自动注入相关记忆。                                                                              |
| `plugins.entries.memory-lancedb.config.autoCapture`         | boolean | `false`                      | 是否在对话结束时自动抓取并存储记忆。                                                                        |
| `plugins.entries.memory-lancedb.config.dbPath`              | string  | `~/.openclaw/memory/lancedb` | 可选。LanceDB 数据目录。                                                                                    |
| `plugins.entries.memory-lancedb.config.captureMaxChars`     | number  | `500`                        | 可选。单条消息参与 auto-capture 的最大字符数（100–10000）。                                                 |

---

## 完整配置示例

```json5
{
  plugins: {
    enabled: true,
    entries: {
      "memory-lancedb": {
        enabled: true,
        config: {
          embedding: {
            apiKey: "${OPENAI_API_KEY}",
            model: "text-embedding-3-small",
          },
          autoRecall: true,
          autoCapture: true,
          dbPath: "~/.openclaw/memory/lancedb",
          captureMaxChars: 500,
        },
      },
    },
    slots: {
      memory: "memory-lancedb",
    },
  },
}
```

---

## 常见问题

**Q: 执行 `plugins enable memory-lancedb` 后报错 “must have required property 'embedding'”？**  
因为该插件的 config 必须包含 `embedding.apiKey`。先补上再保存即可：

```bash
openclaw config set plugins.entries.memory-lancedb.config.embedding.apiKey '${OPENAI_API_KEY}'
```

或直接写 API Key（勿泄露）。若用环境变量，请先 `export OPENAI_API_KEY`，再启动 Gateway。

**Q: 切到 memory-lancedb 后，原来的 MEMORY.md / memory/\*.md 还能用吗？**  
memory-lancedb 的数据存在 LanceDB 里，和 workspace 里的 MEMORY.md、memory/\*.md 是两套。memory-core 的 `memory_search` 是搜这些 Markdown 文件；memory-lancedb 的 auto-recall 是搜 LanceDB 里由它自己写入或通过工具写入的记忆。若插件也注册了 `memory_search`/`memory_get`，行为以该插件实现为准。两者可以并存：重要设定既可写在 MEMORY.md，也可依赖 memory-lancedb 的 auto-capture 从对话中抽取。

**Q: 没有 OpenAI Key，能用别的 embedding 吗？**  
可以。两种方式：（1）**火山引擎 Ark**：设置 `embedding.provider: "volcengine"`，并填 `apiKey`、`model`、`dimension`，见上文「2.3 使用火山引擎 Ark」。（2）**OpenAI 兼容接口**：设置 **embedding.baseUrl** 指向任意兼容 `/v1/embeddings` 的服务，见「2.4 使用 OpenAI 兼容的 embedding 接口」。Hugging Face 等非兼容格式需通过兼容网关或自建代理再用 baseUrl。

**Q: 数据库可以换目录吗？**  
可以，设置 `config.dbPath` 为你要的路径（如绝对路径或 `~/xxx`）即可。确保 Gateway 对该目录有读写权限。

**Q: 如何关掉长期记忆，回到 memory-core？**  
执行：

```bash
openclaw config set plugins.slots.memory memory-core
```

然后重启 Gateway。无需删除 memory-lancedb 的配置，只要槽位不用它即可。

---

相关文档：

- [Memory 概念](/concepts/memory) — 工作区记忆文件与记忆工具
- [插件系统](/tools/plugin) — 插件安装、槽位与 `plugins.entries`
