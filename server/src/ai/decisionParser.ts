/**
 * DecisionParser —— LLM 输出 JSON 解析 + 非法值清洗。
 * LLM 输出视为不可信文本：解析失败/目标非法一律返回 null，由 AIEngine 退回规则化决策。
 */

import type { Action, NightActionType } from '@werewolf/shared';

const VALID_NIGHT_ACTIONS: NightActionType[] = ['wolf_kill', 'seer_check', 'witch_save', 'witch_poison', 'skip'];

/** 从原始文本中提取首个 JSON 对象（兼容 markdown 代码围栏与前后缀杂讯） */
function extractJson(raw: string): unknown | null {
  const cleaned = raw.replace(/```json/gi, '```').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 目标座位清洗：必须在合法集合内 */
export function sanitize(target: unknown, validSeats: number[]): number | null {
  const n = typeof target === 'number' ? target : typeof target === 'string' ? Number(target) : NaN;
  if (!Number.isInteger(n)) return null;
  return validSeats.includes(n) ? n : null;
}

/** 解析夜间行动（含哨兵 JSON：模板兜底） */
export function parseAction(raw: string, validSeats: number[], selfSeat: number): Action | null {
  const json = extractJson(raw) as Record<string, unknown> | null;
  if (!json) return null;
  // 路线 C 哨兵：交给 AIEngine 走规则化决策
  if (json['fallback_template'] === true) return null;
  const action = typeof json['action'] === 'string' ? json['action'] : '';
  const target = sanitize(json['target'], validSeats);

  if (action === 'skip') return { type: 'skip' };
  if (!VALID_NIGHT_ACTIONS.includes(action as NightActionType)) return null;
  if (action !== 'skip' && target === null) {
    // 缺 target：狼刀/验人给一个合法随机目标会破坏策略，宁可交回规则决策
    return null;
  }
  // 女巫不可自救类边界由引擎 witchConstraints 二次校验
  if (target === selfSeat && (action === 'wolf_kill' || action === 'seer_check')) return null;
  return { type: action as NightActionType, targetSeat: target ?? undefined };
}

/** 解析投票（返回目标座位；非法返回 null） */
export function parseVote(raw: string, validSeats: number[], selfSeat: number): number | null {
  const json = extractJson(raw) as Record<string, unknown> | null;
  if (!json) return null;
  if (json['fallback_template'] === true) return null;
  const action = typeof json['action'] === 'string' ? json['action'] : '';
  const target = sanitize(json['target'], validSeats);
  if (action !== 'vote' || target === null || target === selfSeat) return null;
  return target;
}

/** 发言文本清洗：去 markdown、去引号包裹、截断到限长 */
export function sanitizeSpeech(text: string, maxLength: number): string {
  let safe = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_#>]/g, '')
    .trim();
  // 剥离整段被引号包裹的情况
  if (safe.length >= 2 && ((safe[0] === '"' && safe.at(-1) === '"') || (safe[0] === '“' && safe.at(-1) === '”'))) {
    safe = safe.slice(1, -1).trim();
  }
  if (safe.length > maxLength) safe = safe.slice(0, maxLength);
  return safe;
}
