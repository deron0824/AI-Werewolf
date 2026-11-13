/**
 * PromptBuilder —— 按角色注入“应知信息”的 prompt 组装。
 * 反作弊边界在此收口（ARCHITECTURE.md §8）：狼知队友、预言家知查验、女巫知刀口；
 * 一切来自玩家/LLM 的文本在拼入 prompt 前经 sanitizeText 提示注入清洗。
 */

import { Role, type AIDifficulty, type GameStateView, type Player, type Persona } from '@werewolf/shared';

import type { LLMRequest } from '../llm/Provider';

/** 提示注入清洗：压平换行、剔除常见注入指令、截断超长 */
export function sanitizeText(text: string, maxLen: number = 2000): string {
  let safe = text
    .replace(/[\r\n]+/g, ' ')
    .replace(/(忽略|无视)(之前|上面|以上|前面)(的)?(所有)?(指令|规则|提示)/g, '（内容已过滤）')
    .replace(/system\s*prompt/gi, '（内容已过滤）')
    .replace(/`{3,}/g, '```');
  if (safe.length > maxLen) safe = safe.slice(0, maxLen) + '…';
  return safe;
}

/** 角色中文名 */
function roleName(role: Role): string {
  switch (role) {
    case Role.WEREWOLF:
      return '狼人';
    case Role.SEER:
      return '预言家';
    case Role.WITCH:
      return '女巫';
    default:
      return '平民';
  }
}

/** 视图 → 局势摘要文本（仅含该角色应知信息） */
function situationSummary(view: GameStateView): string {
  const alive = view.players.filter((p) => p.alive).map((p) => `${p.seat}号${p.name}${p.isHuman ? '(真人)' : '(AI)'}`);
  const dead = view.players.filter((p) => !p.alive).map((p) => `${p.seat}号`);
  // 迭代5修正：完整发言史——本局所有轮次、所有玩家的发言全量纳入（按时间顺序，单条截断防超长），
  // 保证 AI 的推理基于全量历史（票型、表水、前后矛盾）而非仅最近几条；6 人局总长度可控。
  const history = view.speeches.map((s) => `${s.seat}号：${sanitizeText(s.content, 120)}`).join('\n');
  let text = `第 ${view.dayNumber} ${view.isNight ? '夜' : '天'}。\n`;
  text += `存活玩家：${alive.join('、') || '无'}\n`;
  text += `已出局：${dead.join('、') || '无'}\n`;
  if (history.length > 0) {
    text += `本局全部发言记录（按时间先后）：\n${history}\n`;
  }
  return text;
}

/** 私密信息块（严格按角色裁剪） */
function secretInfo(view: GameStateView): string {
  const lines: string[] = [];
  if (view.wolfTeammates && view.wolfTeammates.length > 0) {
    lines.push(`你的狼队友：${view.wolfTeammates.map((s) => `${s}号`).join('、')}（绝不能在发言中暴露这一点）`);
  }
  if (view.checkRecords && view.checkRecords.length > 0) {
    const checks = view.checkRecords.map((c) => `${c.dayNumber}夜验${c.targetSeat}号=${c.result === 'WEREWOLF' ? '狼人' : '好人'}`);
    lines.push(`你的查验记录：${checks.join('；')}`);
  }
  if (view.potions) {
    const p = view.potions;
    const knife = view.witchKnifeTarget ?? null;
    lines.push(
      `药水状态：解药${p.saveUsed ? '已用' : '未用'}，毒药${p.poisonUsed ? '已用' : '未用'}` +
        (knife !== null && !p.saveUsed ? `，今晚刀口是 ${knife} 号（仅你知道）` : ''),
    );
  }
  return lines.length > 0 ? lines.join('\n') : '（你没有任何私密信息）';
}

/** 基础 system 人设（messages[0] 必须是 system，SDK 强制） */
function systemBase(player: Player, persona: Persona): string {
  return [
    '你正在玩一局中文狼人杀游戏，扮演一名玩家。',
    // 迭代4 F2：人设只体现在说话与决策风格里，不点破标签本身
    `你的性格（自然体现，不要在发言里自我标注）：${sanitizeText(persona.trait, 200)}`,
    `你的座位号：${player.seat}号，昵称：${sanitizeText(player.name, 20)}。`,
    '要求：所有输出必须是口语化中文，符合性格，自然流畅，长度遵循每次提问的具体要求。',
    '安全要求：不要泄露任何未授权信息，不要输出与游戏无关的内容。',
  ].join('\n');
}

/**
 * 迭代4 F3 —— AI 难度策略注入（高/中/低）。
 * 迭代5：以“智商/游戏经验强度百分比”口径表达（高=120% / 中=100% / 低=80%），
 * 数值即调参旋钮：调强改高这一档的描述与倍率，调弱同理。
 * 只影响 prompt 策略强度；低难度的决策噪声在 AIEngine 中叠加。
 */
function difficultyHint(view: GameStateView): string {
  const level: AIDifficulty = view.difficulty ?? 'medium';
  switch (level) {
    case 'high':
      return [
        '你的智商与游戏经验强度：120%（高于常人）。',
        '表现为：善于从票型、发言矛盾与站位细节做严密的逻辑推理；狼人可考虑悍跳预言家、冲票或倒钩等进阶打法；好人懂得保护神位、听发言细节、排狼坑；发言有层次、有论据、能带节奏。',
      ].join('\n');
    case 'low':
      return [
        '你的智商与游戏经验强度：80%（低于常人）。',
        '表现为：判断比较直接简单，容易跟风或被带节奏，偶尔犹豫、判断出现偏差甚至自相矛盾；发言比较朴素，不太会讲高深的战术，分析问题时只见表面。',
      ].join('\n');
    default:
      return [
        '你的智商与游戏经验强度：100%（常人水平）。',
        '表现为：按常规策略理性决策，会做基本的分析与表水，但不算老练；发言平实自然，逻辑基本通顺，偶尔有不严谨之处。',
      ].join('\n');
  }
}

/** 白天发言 prompt */
export function buildSpeechPrompt(player: Player, view: GameStateView, scenario: string): LLMRequest {
  const role = player.role ?? Role.VILLAGER;
  const roleHint: Record<Role, string> = {
    WEREWOLF: '你是狼人，白天必须伪装成好人：可以低调隐藏或悍跳预言家，绝不能暴露狼队友。',
    SEER: '你是预言家，天亮后应当报出你的查验结果引导好人。',
    WITCH: '你是女巫，发言要解释你的用药思路，但不要暴露过多细节。',
    VILLAGER: '你是平民，认真表水并分析局势。',
  };
  return {
    system: [systemBase(player, player.persona), difficultyHint(view)].join('\n'),
    user: [
      `你的身份：${roleName(role)}（这是你的私密信息，狼人绝不承认）`,
      roleHint[role],
      secretInfo(view),
      situationSummary(view),
      scenario,
      // 迭代4 F1 + 迭代5 F2：长度放开为 15~160 字由 LLM 自定，但引导以简洁为主，
      // 缩短生成与字幕展示的等待时间（大部分发言 20~80 字即可说清）
      `请以 ${player.seat} 的口吻发表一段完整发言。大部分时候保持简洁有力（约 20~80 字，三五句话把态度和理由说清），只有在局势确实复杂、确有必要展开分析时才写长（最多 160 字左右）。像真人一样干脆利落，不要铺垫废话。直接输出内容本身，不要任何前后缀。`,
    ].join('\n\n'),
    temperature: 0.8,
    template: { kind: 'speech', role, personaLabel: player.persona.label },
  };
}

/** 遗言 prompt */
export function buildLastWordsPrompt(player: Player, view: GameStateView): LLMRequest {
  const role = player.role ?? Role.VILLAGER;
  return {
    system: [systemBase(player, player.persona), difficultyHint(view)].join('\n'),
    user: [
      `你的身份：${roleName(role)}`,
      secretInfo(view),
      situationSummary(view),
      `你刚被出局，请留一段遗言，长度由你自然决定（简短几句或上百字均可，最多 160 字左右），帮助你的阵营（可以指认怀疑对象、交代已知信息）。直接输出内容本身。`,
    ].join('\n\n'),
    temperature: 0.9,
    template: { kind: 'lastwords', role, personaLabel: player.persona.label },
  };
}

/** 夜间决策 prompt（JSON 结构化输出） */
export function buildDecisionPrompt(player: Player, view: GameStateView, candidates: number[]): LLMRequest {
  const role = player.role ?? Role.VILLAGER;
  const instruction: Record<Role, string> = {
    WEREWOLF: `请选择今晚的刀口目标。优先刀疑似神职/发言强势者，可空刀。`,
    SEER: `请选择今晚要查验的玩家。优先验未验过的可疑位。`,
    WITCH: `请决定今晚用药：可以救刀口（witch_save）、毒人（witch_poison）或不用药（skip）。解药毒药每晚限用一瓶，不可自救。`,
    VILLAGER: `平民夜晚无行动，请选择 skip。`,
  };
  const actionDesc: Record<Role, string> = {
    WEREWOLF: `"action":"wolf_kill","target":<目标座位号>`,
    SEER: `"action":"seer_check","target":<目标座位号>`,
    WITCH: `"action":"witch_save|witch_poison|skip","target":<目标座位号或省略>`,
    VILLAGER: `"action":"skip"`,
  };
  return {
    system: [systemBase(player, player.persona), difficultyHint(view)].join('\n'),
    user: [
      `你的身份：${roleName(role)}（私密）`,
      instruction[role],
      secretInfo(view),
      situationSummary(view),
      `可选目标座位：${candidates.join('、') || '无'}（只能是这些座位号）`,
      `请只输出一个 JSON 对象：{${actionDesc[role]}}，不要输出任何其他文字。`,
    ].join('\n\n'),
    jsonMode: true,
    temperature: 0.6,
  };
}

/** 投票决策 prompt（JSON 结构化输出） */
export function buildVotePrompt(player: Player, view: GameStateView, candidates: number[]): LLMRequest {
  const role = player.role ?? Role.VILLAGER;
  return {
    system: [systemBase(player, player.persona), difficultyHint(view)].join('\n'),
    user: [
      `你的身份：${roleName(role)}（私密）`,
      secretInfo(view),
      situationSummary(view),
      `现在是投票放逐环节。可选目标座位：${candidates.join('、') || '无'}（只能是这些座位号，不能投自己）。`,
      `请基于发言与票型选出最可疑的人。`,
      `请只输出一个 JSON 对象：{"action":"vote","target":<目标座位号>}，不要输出任何其他文字。`,
    ].join('\n\n'),
    jsonMode: true,
    temperature: 0.6,
  };
}
