# PRODUCT.md —— 6 人局 AI 狼人杀 产品文档

> 产品经理：许清楚（Xu）| 日期：2026-11-14
> 用途：业务规则与产品功能的权威速查表，供后续「对照实现做功能自查」。
> 每一条均标注代码出处（文件路径），可逐一对照验证。
> 依据代码：`shared/src/*`、`server/src/*`、`client/src/*`（本目录 WORKBERRY 项目 werewolf-demo，npm workspaces：shared/server/client）。

---

## 1. 游戏概览

| 维度 | 内容 | 代码出处 |
| --- | --- | --- |
| 一句话定位 | 6 人局网页 AI 狼人杀：2 真人 + 4 AI，法官引擎全自动主持，LLM 驱动 AI 发言与决策 | `docs/PRD.md`；`server/src/ai/AIEngine.ts` |
| 玩家人数 | 固定 6 席：最多 2 真人（1、2 号位），其余由 AI 补满；单人也可开局（自动补 5 AI） | `server/src/room/RoomManager.ts:24`（MAX_HUMANS=2）；`Room.fillAI`（Room.ts:186-198） |
| 角色构成 | 2 狼人 + 1 预言家 + 1 女巫 + 2 平民；无警长 | `shared/src/gameConfig.ts:55-75`（SIX_PLAYER_CONFIG） |
| 夜晚顺序 | 狼刀 → 预言家验人 → 女巫用药 | `gameConfig.ts:66`（nightOrder）；`JudgeEngine.runNight` |
| 狼人胜（屠城） | 存活好人数 ≤ 存活狼人数即狼胜（提前判定，不等好人全灭） | `shared/src/gameConfig.ts:68`（slaughterWin=true）；`server/src/game/rules.ts:120-133`（checkWin） |
| 好人胜 | 所有狼人被放逐或死亡（aliveWolves===0） | `rules.ts:126-128` |
| 房间生命周期 | WAITING（大厅）→ RUNNING（对局中）→ FINISHED（胜负已分）；重开走 FINISHED→WAITING→RUNNING | `shared/src/types.ts:32`（RoomStatus）；`Room.startGame/restart/onGameOver` |
| 房间码 | 4 位数字（0000-9999），即简易鉴权 | `RoomManager.allocRoomCode`（RoomManager.ts:161-167） |
| 局域网联机 | 服务端监听 0.0.0.0:3000，CORS=*；客户端同源连接（socket/REST 均相对路径） | `server/src/config.ts:53-55`；`server/src/index.ts:206-208`；`client/src/api/socket.ts:21-26` |

## 2. 完整游戏规则

### 2.1 角色能力

| 角色 | 能力 | 精确规则 | 代码出处 |
| --- | --- | --- | --- |
| 狼人 | 夜间刀人 | 双狼各提交刀口后引擎仲裁：目标一致→用之；不一致→随机取狼方提交之一；全部空刀→空刀（allowEmptyKnife=true）。UI 上狼不能选自己与狼队友 | `rules.ts:54-63`（arbitrateWolfKill）；`JudgeEngine.stageWolf`（JudgeEngine.ts:352-365）；UI `client/src/components/NightPanel.tsx:56-75` |
| 预言家 | 每夜验一人 | 法官私发结果「狼人/好人」（check:result）；查验史由 nights 记录推导，随视图终身携带 | `JudgeEngine.stageSeer`（368-388）；`Room.buildView`（Room.ts:353-360） |
| 女巫 | 解药 1 瓶 + 毒药 1 瓶 | ①解药只能救当晚刀口；②全程不可自救（含首夜被刀）；③同夜不可双药（引擎每夜只收集一个动作，结构性保证）；④跨夜不互限（第 1 夜用毒后第 2 夜仍可用解药，反之亦然）；⑤解药未用时法官才告知刀口，用掉后永不再告知 | `rules.ts:27-51`（witchConstraints）；`JudgeEngine.collectWitchAction`（417-454）；`Room.buildView` witchKnifeTarget（Room.ts:362-370）；文案 `shared/src/rulesText.ts:40-46` |
| 平民 | 无技能 | 白天发言与投票 | `RoleCard.tsx` desc |

### 2.2 昼夜完整流程

| 步骤 | 行为 | 代码出处 |
| --- | --- | --- |
| 发牌 | Fisher-Yates 洗角色牌按座位发放；狼私收 wolf:teammates | `JudgeEngine.dealCards`（275-304） |
| 夜晚 | 按 nightOrder 逐阶段收集行动 → 结算死亡（刀口未被救 + 毒杀，双死合并） | `JudgeEngine.runNight/resolveNightDeaths`（307-327、509-523） |
| 天亮播报 | 平安夜：「昨夜是平安夜，无人死亡」；有死：「昨夜死亡的是 X 号、Y 号」（双死一起报，不区分刀/毒） | `JudgeEngine.runDawnAndDay`（535-549）；UNCLEAR #5 |
| 首夜遗言 | 仅 dayNumber===1 且有死时，按死者座位顺序收遗言 | `JudgeEngine.ts:552-559`（firstNightLastWordsOnly） |
| 白天发言起始位 | 有死者：从「最大死者座位」的下一位存活者开始环形发言；平安夜：从最小存活座位开始 | `rules.ts:136-144`（speechStartSeat）+ `rules.ts:66-88`（speechOrder 环形） |
| 发言限时 | 真人 60s（SPEECH_TIME_LIMIT_MS，玩法时长不受 SPEED_MODE 影响）；超时法官播报「X 号思考超时，跳过发言」并视为「过」；AI 发言按 8 字/秒字幕节奏推进（上限 60s） | `server/src/config.ts:109/118/123`；`JudgeEngine.waitForSpeechWithTimeout`（918-942）；`paceSpeechDisplay`（969-976） |
| 投票 | 全体存活者投票；候选=全部存活座位；禁自投（服务端拒绝）；实时广播已投人数（不显示谁投谁）；投票结束广播完整票型明细 | `JudgeEngine.runVoteFlow/collectVotes`（716-829）；`JudgeEngine.submitVote`（200-224） |
| 计票与放逐 | 最高票唯一→放逐；多人同最高票→PK | `rules.ts:105-117`（resolveTally）；`tallyVotes`（91-99） |
| PK 流程 | 平票者 PK 发言 → 其余玩家（非平票者）在平票者中再投 → 出最高票放逐 → 再平票则平安日无人出局 | `JudgeEngine.ts:746-781`（pkOnTie=true） |
| 遗言 | 仅第一夜死者 + 被放逐者（含 PK 放逐者）有遗言；遗言输入由客户端解析法官播报「请 X 号留遗言」触发 | `JudgeEngine.collectLastWords/exileSeat`（570-602、832-874）；解析在 `GameContext.tsx:153-156` |
| 胜负判定时机 | 夜死结算后（DAWN）、放逐后即时判定；分出胜负即全员翻牌（roleRevealed=true）+ 广播 game:over | `JudgeEngine.tryFinishGame`（877-896） |

### 2.3 超时与无限等待行为汇总

| 环节 | 超时参数 | 超时行为 | 代码出处 |
| --- | --- | --- | --- |
| 真人发言 | 60s（speech.timeLimitMs） | 自动视为「过」，法官播报后流程继续 | `JudgeEngine.ts:918-942` |
| 真人夜间行动 | humanActionTimeoutMs 默认 **0=无限等待** | 无超时，玩家不行动则全房卡在该夜 | `config.ts:127`（UNCLEAR #2）；`collectNightActions`（456-467） |
| 真人投票 | 同上（复用 humanActionTimeoutMs）默认无限等待；且投票面板**无弃票按钮**，必须点选才能推进 | 一名真人不投票 → 全场卡 DAY_VOTE | `collectVotes`（786-797）；`VotePanel.tsx`（无弃票入口） |
| 真人遗言 | **无任何超时**（waitForLastWords 纯 Promise） | 已定位 P0-1，见 §6 | `JudgeEngine.waitForLastWords`（944-948） |
| AI 全部环节 | LLM 调用统一 10s 超时 + A 路熔断 60s + 模板句兜底 | 永不阻塞流程 | `config.ts:70/83`；`LLMPipeline.chat`（LLMPipeline.ts:85-106） |

## 3. 阶段状态机表

主循环：`JudgeEngine.runLoop`（JudgeEngine.ts:264-272）。阶段枚举 `shared/src/types.ts:18-29`。

| 阶段 | 进入条件 | 谁能做什么 | 退出条件 / 超时行为 | 玩家应看到 |
| --- | --- | --- | --- | --- |
| LOBBY | 建房/重开后 | 房主：开始游戏、调 AI 难度；真人 2 号席可加入 | 房主点开始 → 发牌 | 大厅：座位卡（2 号位邀请提示+房间码）、AI 难度选择、开始按钮 |
| NIGHT_WOLF | 发牌或入夜 | 存活狼：提交刀口/空刀（无限等待） | 全狼提交后仲裁 | 狼：刀口选择+队友提示；非狼：「请闭眼」遮罩（NightPanel） |
| NIGHT_SEER | 狼环节结束 | 存活预言家：验一人（无限等待） | 验毕私发 check:result | 预言家：验人面板+已验记录；他人：闭眼遮罩 |
| NIGHT_WITCH | 预言家环节结束 | 存活女巫：救/毒/skip 三选一（无限等待）；非法动作服务端降级为 skip | 收到一个动作即结算 | 女巫：刀口提示（解药未用时）+双药按钮；他人：闭眼遮罩 |
| DAWN | 夜结算完成 | 无操作（纯播报） | 播报+死讯广播后即时进入遗言/发言 | 法官播报死讯/平安夜；死亡座位置灰 |
| DAY_SPEECH | DAWN 及首夜遗言后 | 当前发言者：输入发言（≤300 字，真人 60s）；AI 自动生成 | 全员轮完 → DAY_VOTE；个人超时=自动「过」 | 发言侧栏流式字幕；轮到本人时输入框+倒计时条 |
| DAY_VOTE | 发言结束 | 存活者：投一名存活者（禁自投）；无超时默认无限等待 | 全员投完 → 公示票型 | 投票面板（点选头像+提交）或无权等待态；实时已投人数 |
| DAY_PK | 普通轮平票 | 平票者：PK 发言；其余存活者：在平票者中再投（平票者本人无投票权 selfCanVote=false） | 再投出结果或再平票（平安日） | PK 投票面板/「你是被投对象」等待态 |
| DAY_EXILE | **枚举中存在但引擎从未进入**（放逐在 DAY_VOTE/DAY_PK 内同步完成） | — | — | StatusBar 有此文案但实际不会出现（见 §7 疑点 Y1） |
| GAME_OVER | checkWin 判出胜负 | 真人：点「继续游戏」确认；两人齐→原子重开 | 双人确认后 restart | 结算弹窗：胜负原因+全员翻牌+全部票型+「X/2 已确认」 |

## 4. 界面功能映射表（核心）

「服务端处理」列均指 `server/src/index.ts` socket handler → `RoomManager` → `Room`/`JudgeEngine`。

| 界面元素 | 位置（组件文件） | 玩家操作 | 触发事件 | 服务端处理与校验 | 业务约束 |
| --- | --- | --- | --- | --- | --- |
| 昵称输入/建房 | `client/src/pages/LobbyPage.tsx` | 输昵称点「创建房间」 | REST POST /api/rooms | 昵称 1-12 字校验（index.ts:81-89）；首个真人=房主占 1 号座，AI 预览占 3-6 号座 | 昵称为空/超 12 字不可提交；建房即入房 |
| 输码加入 | `LobbyPage.tsx` | 输 4 位数字房间码+昵称 | REST POST /api/rooms/join | 房间码无效 1001 / 真人满 1002 / 已开局 1003（RoomManager.joinByCode、Room.addHuman） | 房间码即鉴权；开局后锁定加入 |
| 房间码展示 | `GamePage.tsx:92`（顶栏）+ `SeatGrid.tsx`（2 号席邀请提示） | 只读展示 | — | — | 好友输码加入 2 号真人席 |
| AI 难度选择 | `GamePage.tsx:127-145`（大厅内） | 房主点低/中/高 | socket `room:set-difficulty` | 仅房主（RoomManager.setDifficulty）且仅 WAITING 可改（Room.setDifficulty），开局锁定、重开保留 | 非房主/开局后按钮无守卫提示，靠服务端拒绝 |
| 开始游戏 | `GamePage.tsx:146` | 房主点「开始游戏」 | socket `game:start` | 仅房主 + 仅 WAITING/RUNNING 守卫（Room.startGame）；fillAI 补满空座 + 人设洗牌（Room.shuffleAIPersonas） | 单人开局自动补 AI；FINISHED 需先重开 |
| 座位卡 | `client/src/components/SeatGrid.tsx` | 技能/投票时点选（selectableSeats 控制） | 随面板上送 | 服务端二次校验候选/存活 | 存活 ✔/出局 ✖ 置灰、AI「打字中…」动效（typing:start/stop）、结算翻牌角色徽章、空座占位态（仅 LOBBY） |
| 身份牌 | `client/src/components/RoleCard.tsx` | 只读 | — | 视图按角色裁剪：狼→wolfTeammates；预言家→checkRecords；女巫→potions+witchKnifeTarget（Room.buildView 347-370） | 仅本人可见；开局前显示「身份牌将在开局后发放」 |
| 夜间行动面板 | `client/src/components/NightPanel.tsx` | 狼：点座位刀/空刀；预言家：点座位验；女巫：救/选毒目标/不用药 | socket `action:night` | phaseAllowsAction 阶段-角色权限校验 + actionGate 收集窗口校验（JudgeEngine.submitAction 163-179）；女巫边界 witchConstraints 校验，非法降级 skip | 无权限角色显示「🌙 请闭眼」遮罩（防私密信息串屏）；死人/已提交者被拒 |
| 发言输入框（键盘+🎤） | `client/src/components/ActionArea.tsx` | 输入 ≤300 字或点 🎤 语音听写，确认后提交 | socket `speech:submit` / `lastwords:submit` | 空文本拒、>300 字拒（JudgeEngine.submitSpeech 182-197）；遗言仅认 lastWordsWaiter 当前座位（227-238） | 仅 isMySpeechTurn=true（DAY_SPEECH/DAY_PK 且 currentSpeakerSeat=我且存活）显示发言框；遗言框由法官播报解析触发（GameContext lastWordsSeat） |
| 🎤 麦克风语音输入 | `client/src/speech/stt.ts` + `ActionArea.tsx:43-67` | 点🎤开始/⏹结束，识别草稿并入输入框 | 无（纯前端，随发言提交） | — | 仅 Chromium + 安全上下文（localhost/HTTPS）显示按钮（getSttSupport）；权限拒绝/网络不可用/无设备→中文 toast 回退键盘 |
| 发言流式字幕 | `client/src/components/SpeechFeed.tsx`（TypewriterText） | 只读 | 服务端节奏（8 字/秒） | 服务端 paceSpeechDisplay 等待等长时长再过轮 | AI 发言打字机流式；真人发言即时全显；确定性队列保证一次只有一条在打字（迭代5 F-顺序修复） |
| 投票面板 | `client/src/components/VotePanel.tsx` | 点选候选头像→提交 | socket `vote:submit` | 死者拒投、目标须在候选内、禁自投（JudgeEngine.submitVote 200-224）；已投者重复提交拒 | 有权=存活且窗口开启（DAY_PK 时非平票者）；无权显示等待态/「你已出局」；无弃票按钮（见 §7 Y3） |
| 票型公示 | `VotePanel.tsx:30-60` + `SpeechFeed.tsx:172-186` | 只读 | 服务端广播 `vote:result`（含 details 谁投给谁） | 投票结束才广播；结算后随视图 voteHistory 永久可查 | 收集窗口关闭后才展示明细；弃票真人不在 details |
| 发言侧栏聊天记录 | `SpeechFeed.tsx` | 滚动查看、悬停显示 🔊 重播 | 无 | — | 含发言/遗言标记/死讯/票型/胜负；重播走 SpeechQueue 串行不重叠 |
| 法官播报区 | `client/src/components/JudgeAnnouncer.tsx` | 只读（最近 4 条） | socket `judge:say` | 法官文案由引擎 say() 广播并记录 timeline | 刷新后历史播报丢失（P0-2） |
| 昼夜背景/音效 | `GamePage.tsx:35-64`（背景图）；`GameContext.tsx:272-285`（音效触发）；`speech/sfx.ts` | 只读/开关 | phase:change 驱动 | — | 夜晚入夜各阶段短特效（wolf/seer/witch/night/dawn/vote/death/victory）；首次点击解锁自动播放 |
| TTS 开关 | `client/src/components/SettingsDialog.tsx:78-117`；`speech/tts.ts` | 开关 AI 播报（默认关）/音效（默认开）/法官配音（默认关） | 无（localStorage 持久化） | — | 全部语音经 SpeechQueue 串行仲裁；发言条目 🔊 重播跳过开关 |
| LLM 设置 | `SettingsDialog.tsx:40-70` | 配路线 A 开关、路线 B baseUrl/模型/Key | REST GET/POST /api/settings | Key 只写不读、掩码回显 sk-****last4、存 server/data/settings.json 0600（security/secrets.ts）；保存后 refreshChain + 广播 settings:updated | 设置变更影响全部房间下一轮调用 |
| LLM 状态灯 | `client/src/components/StatusBar.tsx:36-66` | 只读 | socket `llm:status` | A/B/C 路状态变化即广播；新连接主动推一次（index.ts:149） | A=WorkBuddy / B=OpenAI 兼容 / C=模板句库（黄灯） |
| 规则弹窗 | `client/src/components/RuleDialog.tsx` | 只读 | — | 数据唯一来源 `shared/src/rulesText.ts`（组件禁止另写文案） | 大厅与对局内均可查看 |
| 复盘下载 | `client/src/components/GameRecordDialog.tsx`；REST GET /api/rooms/:roomId/record | 查看/下载 JSON | REST | 未终局返回最近一局归档（Room.exportRecord，Room.ts:543-547）；重开不删旧局（archivedRecords） | 复盘含座位/角色/夜晚/发言/全部票型/timeline |
| 结算画面 | `GamePage.tsx:176-250` | 点「继续游戏」或「退出房间」 | socket `game:restart-request` | requestContinue：仅真人、仅 FINISHED；continueVotes 达 humanCount → 原子重开（Room.restart） | 全员翻牌+全部票型；弹窗不可点关（onClose 空实现）；单人确认显示「X/2 已确认」 |
| 重开（双人确认） | 同上 | 双真人各点一次 | 同上 | reset→重建引擎→广播 game:restart（载荷恒空对象）→立即开新局；身份/发言/票型全归零，难度保留，rejoinToken 跨局有效 | 任一真人可发起（不限定房主）；对方经 continueConfirmed 看到进度 |

## 5. 玩家异常场景预期行为表（核心，自查重点）

| 场景 | 当前实现预期行为 | 已知问题 |
| --- | --- | --- |
| 玩家刷新页面 | localStorage 身份自动重连（rejoinToken）；state:sync 恢复：阶段/座位/存活/发言全文/投票候选/发言轮次/查验史/药水状态/狼队友/票型历史/继续确认进度 | 瞬态丢失：法官播报、死讯流水、实时投票进度、最后一轮票型公示、待遗言提示、AI 打字动效全部不恢复（P0-2）；见 §6 |
| 玩家掉线重连 | socket.io 自动重连 + rejoinToken 重绑（Room.bindSocket）；席位永久保留（不做离场判定，Room.ts:223）；同一浏览器多标签兼容（sockets Map） | 掉线期间错过的 judge:say/check:result 等一次性事件不补发（私密事件只有 wolfTeammates/checkRecords/witchKnifeTarget 随视图可恢复） |
| 发言超时 | 服务端 60s 判定，播报「思考超时，跳过发言」自动过轮；迟到提交被拒（speechWaiter 已作废） | 前端倒计时仅展示、归零不自动提交（SpeechCountdown 设计约定） |
| 投票/夜间行动超时 | 无超时（humanActionTimeoutMs=0 无限等待） | 单个真人挂机 → 全房卡死在该阶段；投票面板无弃票按钮无法主动放行（Y3/Y4） |
| 玩家被放逐后 | 席位置灰、仍收全部广播（观战）；可留遗言（lastWordsSeat 命中自己）；投票阶段显示「你已出局，可旁观投票进程」 | 无 |
| AI LLM 服务降级（A→B→C） | A 失败→熔断 60s 直接走 B；B 未配置/失败→C 模板句；C 永不失败；状态灯实时展示；决策解析失败回规则化兜底，发言回模板句 | 状态灯只在变化时广播，刷新端靠新连接推送补齐 |
| 麦克风权限拒绝/识别服务不可用/识别中断 | not-allowed→toast「请在地址栏授权」；network→「识别服务不可用，改用键盘」；audio-capture→「未检测到麦克风」；no-speech 静默等待；静默断开自动续起（onend→start） | 自动续起后已确认终稿丢失（P0-3）+ 无限续起无防护；见 §6 |
| 房间内单人开局 | 房主单人可开局，fillAI 自动补满 5 个 AI（花名册优先未上场头像，不足循环复用）；1 号真人 + 5 AI 正常进行 | 无 |
| 游戏结束双人不同时点继续 | 先点者见「1/2 已确认（等待对方）」；对方后点→两人同时收到 game:restart 清空进入新局 | 一人掉线/退出后另一人永远停在结算画面（无单方强制重开/超时通道）；Y5 |
| AI 掉线 | AI 无连接概念，决策全在服务端，不受任何网络影响 | 无 |
| 提交被服务端拒绝 | ack error → 前端 toast 显示原因（如「不能投给自己」「当前不是你的发言轮次」） | 投票面板候选含自己座位，点击提交才报错（Y2） |

## 6. 已知问题记录（2026-11-14 已确认，3 处 P0，供对照验证修复）

| # | 问题 | 精确定位 | 影响 |
| --- | --- | --- | --- |
| P0-1 | 服务端遗言等待无超时：`waitForLastWords` 是纯 Promise，永不 resolve | `server/src/game/JudgeEngine.ts:944-948`；调用点 `collectLastWords`（578）、`exileSeat`（844）；对比：发言有 waitForSpeechWithTimeout（918-942）、夜间/投票走 PhaseGate 超时机制 | 真人页面崩溃/关页后引擎永久卡死在「请 X 号留遗言」，全房无法推进 |
| P0-2 | 刷新后瞬态状态全部丢失：法官播报、投票进度、票型公示、查验史提示、待遗言提示不重发 | 瞬态仅存于客户端 reducer（`client/src/state/GameContext.tsx:57-83`），由一次性事件累积；`state:sync`（GameStateView）不含 judgeMessages/deaths/lastWordsSeat/voteProgress/voteResult；服务端无事件重发机制 | 刷新后：法官区空白；投票结束期 VotePanel 误显「投票进行中 0/0」（voteResult 为 null 落入无权等待态，`VotePanel.tsx:63`）；待遗言玩家看不到输入框但引擎正在等他（与 P0-1 叠加成死局） |
| P0-3 | STT 识别终稿跨重启丢失 + 无重启次数防护 + 无 ErrorBoundary | ①`client/src/speech/stt.ts:109` `sessionFinal = finalRebuild` 全量重建式覆盖——onend 自动续起（118-127）后浏览器 results 清零，之前终稿被清空；②onend 无限续起无次数/时长防护；③`client/src/main.tsx` 无 React ErrorBoundary，任何组件渲染异常直接白屏 | 语音输入说着说着内容消失；识别循环异常时无法自愈；页面崩溃白屏无提示（并连带触发 P0-1 死局） |

## 7. 待自查疑点清单（产品经理通读代码时的存疑项，供主理人核对）

| # | 疑点 | 代码位置 | 存疑内容 |
| --- | --- | --- | --- |
| Y1 | DAY_EXILE 阶段从未被使用 | `shared/src/types.ts:27`；`JudgeEngine.setPhase` 全部调用点 | Phase 枚举含 DAY_EXILE、StatusBar 有文案，但引擎放逐在 DAY_VOTE/DAY_PK 内同步完成，从不 setPhase(DAY_EXILE)。是残留枚举还是缺实现（放逐应独立成阶段）？ |
| Y2 | 投票候选含自己 | `JudgeEngine.runVoteFlow:720`（candidates=全部存活）；`VotePanel.tsx:84` fallback | 服务端禁自投，但 UI 候选列表包含自己座位，点了提交才 toast 报错。是否应前端直接过滤？ |
| Y3 | 投票无弃票按钮 + 无投票超时 | `VotePanel.tsx`；`config.ts:127` | 玩家必须投一人才能推进；不投则全场无限卡死。是否需要「弃票」按钮或投票限时？ |
| Y4 | 夜间行动无超时且无自动 skip | `collectNightActions`（JudgeEngine.ts:456-467） | 真人狼/预言家/女巫不行动即永久卡夜。发言有 60s 超时，夜间为何没有对齐策略？ |
| Y5 | 结算后单人无法推动重开 | `Room.requestContinue`（Room.ts:430-446） | continueVotes 需达 humanCount（含掉线者）；对方掉线则永远 1/2。是否应允许房主强制重开？ |
| Y6 | 平安日 dayNumber 不递增 | `JudgeEngine.runVoteFlow` 三条平安日路径（753-755、779、782）均直接 return，无 `state.dayNumber += 1`；仅 `exileSeat:872` 递增 | 平安日后进入的下一夜 NightRecord.dayNumber 与当天相同：①复盘记录天数重复；②女巫视图 witchKnifeTarget 以 `lastNight.dayNumber === state.dayNumber` 判定当晚（Room.ts:369），同日两夜记录可能引起刀口归属歧义。疑似逻辑缺陷 |
| Y7 | 夜间行动目标合法性服务端不校验 | `JudgeEngine.submitAction`（163-179）仅校验阶段权限与 gate 收集窗口 | 真人狼可刀死者/刀非法座位、真人女巫可毒死者/毒自己（witchConstraints 不查 target 存活性；不可自救仅限解药 40 行）。UI 已过滤，但协议层可被构造请求绕过 |
| Y8 | 遗言长度限制未生效 | `config.ts:103`（lastWordsMaxLength=200）；`JudgeEngine.submitLastWords`（227-238）只校验非空 | 200 字上限定义了但服务端不校验；前端遗言框按 300 字限制（ActionArea MAX_LEN）。两处不一致 |
| Y9 | settings:updated 事件无客户端订阅 | `shared/src/events.ts:153`；`GameContext.tsx` 订阅清单（317-335） | 服务端保存设置后 io.emit('settings:updated')，客户端从未监听：另一玩家不会收到任何设置变更通知 |
| Y10 | 发言起始位与文案的精确对齐 | `rules.ts:136-144`（取最大死者座位）；`rulesText.ts:51`（"从死者下一位开始"） | 双死时文案未明确从哪个死者的下一位；实现取 max(死者座位)。建议规则文案补一句"取座位号最大死者" |
| Y11 | 女巫毒药可毒狼队友外的任何存活者含自己（UI 层排除自己） | `NightPanel.tsx:115`（aliveOthers 排除自己）；`witchConstraints:47-50` | 与 Y7 同源：服务端毒自己/死者不拒绝。若视为「女巫可毒自杀」的规则选项需拍板 |
| Y12 | 狼刀仲裁不一致时玩家无感知 | `arbitrateWolfKill`（rules.ts:54-63）随机取一狼提交 | 双真人狼提交不同刀口时静默随机，狼方可能以为刀了 A 实际刀了 B。是否需要播报/提示？ |
| Y13 | phase:change 的 deadline 字段恒为 null | `JudgeEngine.setPhase:250-255` | PhaseChangePayload.deadline 设计了但从未下发真实值（发言 deadline 走视图 speechDeadlineMs）。字段是否废弃？ |
| Y14 | 双标签页同账号行动竞态 | `Room.sockets` Map 支持多标签；两个标签都可提交发言/投票 | 同一 playerId 两标签同时操作无互斥，voteGate.resolve 幂等（isPending），但 speechWaiter 单值——第二标签提交可能覆盖第一标签状态。低风险，建议确认 |
| Y15 | AI 发言预取的真人边界 | `startPrefetchForNext`（JudgeEngine.ts:680-695） | 已做「真人隔中间禁止预取」修正，但 PK 发言（isPK=true, order=pkSeats）与普通轮共用 prefetch 逻辑，PK 全真人时无影响；逻辑已审无异常，仅备案 |
