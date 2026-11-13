# 🐺 AI Werewolf（AI 狼人杀）

本地/局域网运行的 **6 人局狼人杀**：**2 真人 + 4 AI**，法官（主持人）引擎自动主持完整昼夜流程。
AI 玩家由大模型驱动发言与决策——有隐藏人设、可调智商、按全量发言史推理，三级降级保证永不卡死。

> A local-first 6-player Werewolf (Mafia) game: 2 humans + 4 LLM-driven AI players, with a fully automated judge engine.

## 特性

- 🎭 **LLM 驱动 AI 玩家**：发言/夜间决策/投票全部由大模型生成，基于**本局全量发言史** + 角色应知信息推理，后发言者会回应真人的发言
- 🧠 **AI 智商分级**：房主可设 高 120% / 中 100% / 低 80%，低难度带决策噪声与思路掉线
- 👤 **隐藏人设**：AI 人设每局随机洗牌，不与昵称/座位绑定，真人需从发言风格推断身份
- 🖼️ **原画风格形象**：AI 头像、角色身份卡、昼夜背景（AI 生成的占位素材，可自行替换 `client/public/assets/img/`）
- 🌗 **昼夜氛围**：背景交叉淡入 + WebAudio 合成音效（鸡鸣/狼嚎/水晶/鼓点，可放 mp3 覆盖）
- 💬 **流式字幕 + 语音**：AI 发言按 8 字/秒打字机字幕；可选 AI 语音播报与玩家语音输入（Web Speech API）
- ⚡ **节奏优化**：AI 发言预取接力、真人提交即过轮、发言长度由 LLM 自定（15~160 字）
- 🔒 **反作弊边界**：服务端唯一权威，按角色裁剪视图，广播永不含角色/刀口/查验字段

## 板子与规则

- **6 人局标准板**：2 狼人 + 1 预言家 + 1 女巫 + 2 平民，**屠城规则**，无警长
- 夜晚顺序：狼刀（可空刀）→ 预言家验人 → 女巫用药（不可自救、同夜限一瓶、解药用后不再告知刀口）
- 白天：死讯播报 → 按座位顺序发言 → 投票放逐（出局者有遗言；仅第一夜死者有遗言）
- 平票：平票者 PK 发言 → 其余玩家再投 → 再平票则平安日
- 胜负：好人全出局（好人 ≤ 狼数）狼胜；狼全灭好人胜

## 快速开始

```bash
npm install              # 根目录安装三端依赖（npm workspaces）

npm run dev              # 同时启动 server(3000) 与 client(5173)
# 或分开启动：
npm run dev:server
npm run dev:client
```

两个真人通过 **同一局域网内两台设备的浏览器**（或同机双标签页）进入：

1. 甲：输入昵称 → **创建房间** → 拿到 4 位房间码
2. 乙：输入昵称 + 房间码 → **加入**
3. 甲选择 AI 难度 → 点击 **开始游戏**，法官自动主持全程

### 局域网联机（两台电脑）

前端全部为相对路径/同源代理，dev 模式已绑定 `0.0.0.0`，局域网设备无需改配置：

1. 主机 `npm run dev` 后，`ipconfig` 查主机 IPv4（如 `192.168.1.100`）
2. 第二台电脑浏览器打开 `http://<主机IP>:5173`
3. Windows 防火墙放行（管理员命令行）：

```powershell
netsh advfirewall firewall add rule name="ai-werewolf" dir=in action=allow protocol=TCP localport=5173,3000
```

连不上时排查：同一网段？IP 变动？防火墙已放行？主机自测 `http://localhost:5173` 是否正常？

### Docker 一键启动

```bash
docker compose up --build -d
# 访问 http://localhost（nginx 已反代 /api 与 /socket.io）
```

## LLM 三级降级（AI 发言/决策）

| 路线 | 说明 | 配置 |
| --- | --- | --- |
| **A（优先）** | WorkBuddy 云服务免密钥大模型 | 参照 `cloudConfig.example.json` 创建 `cloudConfig.json`（endpoint + publishableKey），缺失自动跳过 |
| **B（兜底）** | OpenAI 兼容接口 | 前端“LLM 设置”：Base URL / 模型 / API Key（只存本地 `server/data/settings.json`，0600，掩码回显，不进日志） |
| **C（保底）** | 本地模板句库 + 规则化决策 | 零配置，永不失败 |

- 路线 A 需要你自己的 WorkBuddy 云服务应用凭据（**不要提交真实凭据到仓库**，`cloudConfig.json` 已在 `.gitignore`）
- 首选模型可用 `.env` 的 `WB_PREFERRED_MODEL_ID` 指定（见 `.env.example`）；不指定则取模型列表第一个可用模型
- 单次调用超时默认 10s（`LLM_TIMEOUT_MS`），超时/报错自动降级，A 失败后熔断 60s；顶栏状态灯实时显示当前路线
- 手动健康检查：`npm run check-llm`

## 节奏与环境变量

全部集中在 `server/src/config.ts`，支持环境变量覆盖 + `.env` 文件 + `SPEED_MODE` 倍率：

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `SPEED_MODE` | 1 | 0.5 = 全部延迟减半；0 = 最小延迟 |
| `WB_PREFERRED_MODEL_ID` | （空=自动） | 路线 A 首选模型 id（如 `deepseek-v4.1-flash`） |
| `LLM_TIMEOUT_MS` | 10000 | LLM 单次调用超时 |
| `AI_TYPING_DELAY_MIN_MS` / `MAX_MS` | 1000 / 3000 | AI“打字中”动效区间 |
| `SPEECH_DISPLAY_CPS` | 8 | AI 发言字幕流式速度（字/秒） |
| `AI_SPEECH_DISPLAY_MAX_MS` | 60000 | AI 发言节奏上限（受 SPEED_MODE 缩放） |
| `HUMAN_ACTION_TIMEOUT_MS` | 0 | 真人行动超时（0 = 法官无限等待） |
| `SPEECH_TIME_LIMIT_MS` | 60000 | 真人白天发言限时（超时自动视为“过”；不受 SPEED_MODE 影响，0 = 不限时） |

## 开发与测试

```bash
npm run typecheck        # 三端 tsc
npm run test:server      # 服务端 vitest（62 用例：规则引擎/女巫/回归/e2e）
npm run build:client     # 前端产物构建
npm run e2e              # 无头整局模拟（E2E_TIMEOUT_MS 可配）
```

## 扩展点

- **9 人局**：`shared/src/gameConfig.ts` 已附示例数据，换 `ACTIVE_GAME_CONFIG` 即可
- **真人/AI 数量**：席位由配置驱动，代码不写死 6
- **复盘**：对局结束后 `GET /api/rooms/:id/record` 下载完整 JSON（刀口/查验/用药/发言/投票/胜负）
- **云端 TTS**：实现 `client/src/speech/tts.ts` 的 `TTSEngine` 接口即可接入火山/腾讯 TTS
- **素材替换**：`client/public/assets/img/` 全部为 AI 生成的占位原画，直接同名替换即可换成你自己的美术

## 目录结构

```
shared/    跨端共享类型真相源（types/events/gameConfig/rulesText）
server/    Express + Socket.IO + 裁判状态机 + AI/LLM 降级链
client/    Vite + React + MUI + Tailwind（大厅/对局/设置/复盘）
docs/      PRD 与架构设计文档
```

## 安全与隐私

- **凭据不入库**：`cloudConfig.json`（路线 A）、`.env`、`server/data/settings.json`（路线 B API Key）均已被 `.gitignore` 排除
- 路线 B 的 API Key 仅存本地（0600），界面输入不回显明文、日志出口全部脱敏
- 广播 payload 永不含角色/刀口/查验字段；私密信息只定向私发对应角色
- LLM 输入前经 `sanitizeText` 提示注入清洗

## License

[MIT](./LICENSE)
