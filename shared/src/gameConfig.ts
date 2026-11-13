/**
 * 游戏板子配置（数据化、配置驱动）
 *
 * 规则约束（ARCHITECTURE.md §8.9）：板子/人数/夜晚顺序只改本文件数据；
 * 规则引擎与 UI 按 seatCount / roles 数组渲染，禁止写死席位数字。
 * roles 数组长度必须等于 seatCount（运行时校验）。
 */

import { Phase, Role } from './types';

/** 板子配置 */
export interface GameConfig {
  /** 板子名称 */
  name: string;
  /** 总席位数 */
  seatCount: number;
  /** 角色牌数组（洗牌发牌），长度 = seatCount */
  roles: Role[];
  /** 夜晚行动顺序（角色轮次），引擎按此顺序推进夜晚阶段 */
  nightOrder: NightStage[];
  /** 规则开关 */
  rules: GameRuleFlags;
}

/**
 * 夜晚阶段定义：config.nightOrder 中的元素决定夜晚流程。
 * WEREWOLF 刀人 / SEER 验人 / WITCH 用药；扩展新神职时在此追加。
 */
export type NightStage = 'WEREWOLF' | 'SEER' | 'WITCH';

/** Phase 与 NightStage 的映射（阶段枚举 → 夜晚行动序） */
export const PHASE_TO_NIGHT_STAGE: Record<string, NightStage> = {
  [Phase.NIGHT_WOLF]: 'WEREWOLF',
  [Phase.NIGHT_SEER]: 'SEER',
  [Phase.NIGHT_WITCH]: 'WITCH',
};

/** 规则开关 */
export interface GameRuleFlags {
  /** 屠城规则：好人数 ≤ 狼人数即狼胜 */
  slaughterWin: boolean;
  /** 女巫不可自救 */
  witchNoSelfSave: boolean;
  /** 解药/毒药每晚限用一瓶且不可同夜双用 */
  witchOnePotionPerNight: boolean;
  /** 仅第一夜死者有遗言 */
  firstNightLastWordsOnly: boolean;
  /** 空刀允许（狼可不出刀） */
  allowEmptyKnife: boolean;
  /** 同票 PK：平票者 PK 发言 + 再投票，再平票则平安日 */
  pkOnTie: boolean;
}

/** 【默认】6 人局「2狼+预言家+女巫+2平民」标准板，屠城，无警长（PRD §2.3） */
export const SIX_PLAYER_CONFIG: GameConfig = {
  name: '6人局标准板（2狼+预言家+女巫+2平民，屠城）',
  seatCount: 6,
  roles: [
    Role.WEREWOLF,
    Role.WEREWOLF,
    Role.SEER,
    Role.WITCH,
    Role.VILLAGER,
    Role.VILLAGER,
  ],
  nightOrder: ['WEREWOLF', 'SEER', 'WITCH'],
  rules: {
    slaughterWin: true,
    witchNoSelfSave: true,
    witchOnePotionPerNight: true,
    firstNightLastWordsOnly: true,
    allowEmptyKnife: true,
    pkOnTie: true,
  },
};

/** 【示例数据】9 人局「3狼3神3民」（+猎人板位预留；本次 Demo UI 不暴露，P2-1） */
export const NINE_PLAYER_EXAMPLE_CONFIG: GameConfig = {
  name: '9人局示例板（3狼+预言家+女巫+守卫+3民，屠边）',
  seatCount: 9,
  roles: [
    Role.WEREWOLF,
    Role.WEREWOLF,
    Role.WEREWOLF,
    Role.SEER,
    Role.WITCH,
    Role.VILLAGER,
    Role.VILLAGER,
    Role.VILLAGER,
    // 9 人局需猎人板，当前 Role 枚举未含，以平民占位说明扩展点
    Role.VILLAGER,
  ],
  nightOrder: ['WEREWOLF', 'SEER', 'WITCH'],
  rules: {
    slaughterWin: false,
    witchNoSelfSave: true,
    witchOnePotionPerNight: true,
    firstNightLastWordsOnly: true,
    allowEmptyKnife: true,
    pkOnTie: true,
  },
};

/** 当前生效的板子（本次 Demo 只暴露 6 人局；切板子改这一行即可） */
export const ACTIVE_GAME_CONFIG: GameConfig = SIX_PLAYER_CONFIG;

/** 校验板子配置完整性（房间创建时调用） */
export function validateGameConfig(config: GameConfig): string | null {
  if (config.roles.length !== config.seatCount) {
    return `角色牌数(${config.roles.length})与席位数(${config.seatCount})不一致`;
  }
  const wolfCount = config.roles.filter((r) => r === Role.WEREWOLF).length;
  if (wolfCount < 1) {
    return '板子中必须至少有 1 张狼人牌';
  }
  if (config.roles.filter((r) => r === Role.SEER).length > 1) {
    return '板子中预言家不得超过 1 张';
  }
  if (config.roles.filter((r) => r === Role.WITCH).length > 1) {
    return '板子中女巫不得超过 1 张';
  }
  for (const stage of config.nightOrder) {
    const need = stage === 'WEREWOLF' ? Role.WEREWOLF : stage === 'SEER' ? Role.SEER : Role.WITCH;
    if (!config.roles.includes(need)) {
      return `夜晚顺序含 ${stage} 但板子无对应角色牌`;
    }
  }
  return null;
}
