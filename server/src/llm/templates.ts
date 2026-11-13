/**
 * 模板句库（路线 C 兜底）：按角色/场景的口语化模板 + 规则化决策。
 * 保证 LLM 全挂时游戏依然完整可玩、AI 发言不冷场。
 */

import { Role, type Action, type GameStateView } from '@werewolf/shared';

/** 按角色的发言模板（{seat}=自己座位号，口语化 30-80 字） */
const SPEECH_TEMPLATES: Record<Role, string[]> = {
  WEREWOLF: [
    '我是好人，{seat} 号这轮发言逻辑很怪，我建议把票压给Ta。',
    '我没什么信息，但我觉得场上表面平静的人更可疑，先听听后面几位怎么说。',
    '我站边刚才发言真诚的那位，狼人一般在发言里闪烁其词，大家注意细节。',
    '我觉得投票要稳一点，别轻易放逐一个没有明显破绽的人。',
    '目前局势不明，我建议今天先放逐发言最少的那位，狼人最爱藏在我的位置后面。',
  ],
  SEER: [
    '我是预言家，我的查验信息很关键，请大家先听我把话说完再决定。',
    '先声明我的身份，我手里有查验结果，今天我的发言是全场最重要的信息。',
    '我相信我的验人思路没问题，请大家按我的信息来排狼坑。',
    '我的身份经得起验，如果有人悍跳我，请对比我们两人的发言质量。',
  ],
  WITCH: [
    '我是好人，昨晚的情况让我判断场上狼人刀法很谨慎，大家小心别被带偏。',
    '我的用药思路是为了保住好人的信息位，这个决定我认为是对的。',
    '我手里有一些信息，但今天先不全盘托出，避免被狼人针对。',
    '请大家关注昨晚的死亡情况，那是我判断局势的重要依据。',
  ],
  VILLAGER: [
    '我是普通村民，没有技能只能靠听发言找狼，大家把信息都摊开说。',
    '我表个水，我是好人，昨天谁发言躲闪我心里已经有个名单了。',
    '我觉得应该重点关注发言前后矛盾的人，狼人很难圆住两天的话。',
    '我没有什么有力的信息，但我愿意跟有身份的人走，请神位带带我。',
    '从票型看，昨天投票很齐，狼人可能在跟风票，大家留意投同一票的人。',
  ],
};

/** 遗言模板 */
const LAST_WORDS_TEMPLATES: string[] = [
  '我被投出去了，但我坚持自己是好人，请大家重新审视今天的票型。',
  '好吧，我走了，希望你们别再冤枉好人，狼就在你们中间。',
  '我的遗言很简单：留意发言最强势的那位，狼人往往用气势掩盖破绽。',
  '我出局了没关系，但场上的信息请记住，别浪费我这一票的价值。',
  '走得冤，但游戏还要继续，好人阵营别内讧，集中票型找狼。',
];

/** 从模板池随机取一条并替换占位符 */
export function pickSpeech(role: Role, selfSeat: number, rng: () => number = Math.random): string {
  const pool = SPEECH_TEMPLATES[role] ?? SPEECH_TEMPLATES.VILLAGER;
  const template = pool[Math.floor(rng() * pool.length)];
  return template.replaceAll('{seat}', String(selfSeat)).replace(/^ /, '');
}

/** 取遗言模板 */
export function pickLastWords(rng: () => number = Math.random): string {
  return LAST_WORDS_TEMPLATES[Math.floor(rng() * LAST_WORDS_TEMPLATES.length)];
}

/** 规则化夜间决策（C 路线兜底；只依据该角色视图内信息，无作弊） */
export function decideNightByRules(view: GameStateView, rng: () => number = Math.random): Action {
  const aliveSeats = view.players.filter((p) => p.alive).map((p) => p.seat);
  const role = view.self.role;
  const aliveOthers = aliveSeats.filter((s) => s !== view.self.seat);
  const randomOf = (arr: number[]): number | undefined =>
    arr.length > 0 ? arr[Math.floor(rng() * arr.length)] : undefined;

  switch (role) {
    case Role.WEREWOLF: {
      // 刀人：排除自己与狼队友
      const teammates = new Set(view.wolfTeammates ?? []);
      const targets = aliveOthers.filter((s) => !teammates.has(s));
      const target = randomOf(targets);
      return target === undefined ? { type: 'wolf_kill' } : { type: 'wolf_kill', targetSeat: target };
    }
    case Role.SEER: {
      // 验人：优先验未验过的存活位
      const checked = new Set((view.checkRecords ?? []).map((c) => c.targetSeat));
      const unverified = aliveOthers.filter((s) => !checked.has(s));
      const target = randomOf(unverified.length > 0 ? unverified : aliveOthers);
      return target === undefined ? { type: 'seer_check' } : { type: 'seer_check', targetSeat: target };
    }
    case Role.WITCH: {
      // 用药：解药可用且知道刀口 → 救刀口（毒药谨慎不用）
      const knife = view.witchKnifeTarget ?? null;
      const potions = view.potions ?? { saveUsed: false, poisonUsed: false };
      if (!potions.saveUsed && knife !== null && knife !== view.self.seat) {
        return { type: 'witch_save', targetSeat: knife };
      }
      return { type: 'skip' };
    }
    default:
      return { type: 'skip' };
  }
}

/** 规则化投票：跟随发言置信度的简单加权——默认投给（跳预言家的/最近发言的）以外的随机存活位 */
export function decideVoteByRules(view: GameStateView, rng: () => number = Math.random): number {
  const aliveSeats = view.players.filter((p) => p.alive && p.seat !== view.self.seat).map((p) => p.seat);
  const candidates = (view.voteCandidates ?? aliveSeats).filter((s) => s !== view.self.seat);
  const pool = candidates.length > 0 ? candidates : aliveSeats;
  if (pool.length === 0) return view.self.seat;
  return pool[Math.floor(rng() * pool.length)];
}
