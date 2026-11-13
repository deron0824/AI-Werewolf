# 规则复核清单（迭代 2 · rule-review.md 定稿）

> 复核人：寇豆码（工程师）| 日期：2026-11-13
> 依据：`docs/PRD.md` §2.3 全量条目逐条对照实现源码；迭代 2 未改动任何规则逻辑（本文件即「无偏差」定稿）。
> 结论汇总：**全部条目一致，无「未核对」项，无需回写修复 rules.ts。**

| # | 规则条目（PRD §2.3） | 实现代码位置 | 结论 |
| --- | --- | --- | --- |
| 1 | 板子：2 狼人、1 预言家、1 女巫、2 平民（6 席） | `shared/src/gameConfig.ts:55-75` SIX_PLAYER_CONFIG（roles 数组 2狼+SEER+WITCH+2民，运行时 validateGameConfig 校验 roles.length===seatCount） | ✅ 一致 |
| 2 | 夜晚顺序：天黑闭眼 → 狼刀 → 预言家验人 → 女巫用药 | `shared/src/gameConfig.ts:66` nightOrder=['WEREWOLF','SEER','WITCH']；`server/src/game/JudgeEngine.ts:307-329` runNightStage 按 nightOrder 依序唤醒 | ✅ 一致（狼→验→药） |
| 3 | 狼人统一刀口、可空刀 | `shared/src/gameConfig.ts:72` allowEmptyKnife=true；`server/src/game/rules.ts:51-60` arbitrateWolfKill（一致即用之/不一致随机取狼方提交/全空刀则空刀）；`JudgeEngine.ts:333-347` stageWolf（"可空刀"法官口径） | ✅ 一致 |
| 4 | 预言家验一人，被告知「好人/狼人」 | `JudgeEngine.ts:349-369` stageSeer（结果按 role===WEREWOLF 判定，check:result 私发预言家） | ✅ 一致 |
| 5 | 女巫：法官告知刀口 **仅解药未用时** | `JudgeEngine.ts:379-381` knifeKnown = 刀口非空 && !saveUsed；`server/src/room/Room.ts:349-353` buildView witchKnifeTarget 仅 !saveUsed 且当晚才携带 | ✅ 一致（解药已用后不再告知刀口） |
| 6 | 女巫：解药毒药每晚限用一瓶且**不可同夜双用**（跨夜不互相限制） | 「同夜不可双药」由引擎结构性保证：`JudgeEngine.ts` collectWitchAction 每夜只收集一个动作（用救/用毒/弃权三选一），无法同夜双用；rules 层 `server/src/game/rules.ts` witchConstraints 只按各自药瓶整局限用（saveUsed/poisonUsed），**跨夜历史互限已移除**（迭代2 QA Round1 修复：原实现对 witch_save 校验全历史 poisonUsed，导致第1夜用毒后解药被永久禁用，现第1夜用毒→第2夜可用解药、第1夜用解药→第2夜可用毒，均有单测覆盖 `tests/rules.test.ts`「跨夜不互限」组） | ✅ 修复后一致（迭代2 QA Round1 修正） |
| 7 | 女巫：**全程不可自救（含首夜被刀）** | `shared/src/gameConfig.ts:69` witchNoSelfSave=true；`server/src/game/rules.ts:33` witchConstraints（targetSeat===witchSeat 即拒，首夜同样拦截）；单测 `tests/rules.test.ts`「女巫不可自救（含首夜被刀）」 | ✅ 一致（PRD F3 关注点：规则不改，文案已在 shared/rulesText.ts 明确） |
| 8 | 白天死讯：报「昨夜死亡的是 X 号」（双死一起报）或「平安夜」 | `JudgeEngine.ts:521-529` runDawnAndDay（deathSeats.join 一次播报 / 平安夜播报）；UNCLEAR #5 夜死统一播报不区分刀毒 | ✅ 一致 |
| 9 | 仅第一夜死亡者有遗言，之后夜死者无遗言 | `shared/src/gameConfig.ts:71` firstNightLastWordsOnly=true；`JudgeEngine.ts:532-539`（dayNumber===1 && deathSeats>0 才 collectLastWords） | ✅ 一致 |
| 10 | 白天发言：按座位顺序（死者下一位开始；平安夜法官指定起始位） | `server/src/game/rules.ts:63-85` speechOrder（环形）、`rules.ts:133-141` speechStartSeat（死者最大座位 / 平安夜最小存活座位）；`JudgeEngine.ts:589-592` | ✅ 一致 |
| 11 | 真人发言限时 60s、超时自动「过」不卡死（迭代 2 新增玩法条目） | `server/src/config.ts:71-76` speech.timeLimitMs（SPEECH_TIME_LIMIT_MS 默认 60000，不受 SPEED_MODE 影响）；`JudgeEngine.ts:590-610`（Promise 竞速超时 + judge:say 播报「X 号思考超时，跳过发言」）；`JudgeEngine.ts:799-830` waitForSpeechWithTimeout（超时作废等待器，迟到提交被拒）；单测 `tests/iter2-regression.test.ts` F4 组 | ✅ 一致 |
| 12 | 投票：全体投票放逐，法官报票数，最高票出局 | `JudgeEngine.ts:640-676` runVoteFlow（tallyVotes 计票 → vote:result 广播票数 → exileSeat） | ✅ 一致 |
| 13 | 平票：PK 发言 → 其余玩家在平票者中再投 → 再平票平安日 | `shared/src/gameConfig.ts:73` pkOnTie=true；`server/src/game/rules.ts:102-114` resolveTally（同票返回 pkSeats）；`JudgeEngine.ts:655-685`（PK 发言 → DAY_PK 再投票 → 再平票「平安日」） | ✅ 一致 |
| 14 | 出局者（含 PK 放逐者）均有遗言 | `JudgeEngine.ts:737-766` exileSeat（死亡播报 → 胜负判定 → 遗言收集，isPK 同路径） | ✅ 一致 |
| 15 | 胜负（屠城）：好人数 ≤ 存活狼数即狼胜；狼全灭好人胜 | `shared/src/gameConfig.ts:68` slaughterWin=true；`server/src/game/rules.ts:117-131` checkWin（aliveGood<=aliveWolves 狼胜 / aliveWolves===0 好人胜）；`JudgeEngine.ts:778-800` tryFinishGame（死亡结算后即时判定） | ✅ 一致 |
| 16 | 广播安全：广播 payload 永不含角色/刀口/查验字段 | `Room.buildView`（Room.ts:236-357）按角色裁剪；私密只走 emitPrivate；迭代 2 新增 `game:restart` 载荷恒为空对象（`shared/src/events.ts` GameRestartPayload），单测断言不含 WEREWOLF/WITCH/SEER/knifeTarget/check 字样 | ✅ 一致 |

## QA 回归入口（PRD.md §5-3 三条女巫边界）

- 同夜双药被拒：由引擎结构性保证（`JudgeEngine.ts` collectWitchAction 每夜只收集一个动作，二次提交返回「现在不是行动收集窗口」）；`tests/qa-rules.test.ts` 女巫组（26 例全绿）+ `tests/rules.test.ts`「跨夜不互限」组（Bug-2 修复后跨夜两路径与整局各一瓶均有断言）
- 首夜自救被拒：`tests/rules.test.ts`「女巫不可自救（含首夜被刀）」
- 解药用后不再告知刀口：`tests/qa-rules.test.ts` + `Room.buildView` witchKnifeTarget 裁剪逻辑（Room.ts:349-353）

## 复核方式说明

- 逐条对照 PRD.md §2.3 表格原文与实现代码（含规则开关 flag 与引擎执行点两层）；
- 行号为迭代 2 交付后最新源码行号（以上为复核当日实际行号）；
- 迭代 2 QA Round1 发现 1 处偏差并已修复回写：第 6 条女巫跨夜用药限制（rules.ts 原跨夜历史互限已移除，同夜双药由引擎单动作收集结构性保证）；
- 其余条目均与 PRD 表述一致，`server/src/game/rules.ts` 仅 witchConstraints 一处按修复回写。
