/**
 * 阶段定义：裁判状态机的显式节点、阶段间推进顺序、阶段→所需行动映射。
 * 配置驱动：夜晚阶段顺序由 GameConfig.nightOrder 决定，不硬编码。
 */

import { Phase, Role } from '@werewolf/shared';
import type { GameConfig } from '@werewolf/shared';

/** 夜晚阶段枚举 → GameConfig.nightOrder 元素 */
export const NIGHT_PHASE_ORDER: Partial<Record<Phase, number>> = {
  [Phase.NIGHT_WOLF]: 0,
  [Phase.NIGHT_SEER]: 1,
  [Phase.NIGHT_WITCH]: 2,
};

/** nightOrder 元素（NightStage）→ 对应 Phase */
export function stageToPhase(stage: string): Phase {
  switch (stage) {
    case 'WEREWOLF':
      return Phase.NIGHT_WOLF;
    case 'SEER':
      return Phase.NIGHT_SEER;
    case 'WITCH':
      return Phase.NIGHT_WITCH;
    default:
      return Phase.NIGHT_WOLF;
  }
}

/** 阶段中文名（前端与法官播报共用） */
export function phaseLabel(phase: Phase): string {
  switch (phase) {
    case Phase.LOBBY:
      return '大厅';
    case Phase.NIGHT_WOLF:
      return '狼人行动';
    case Phase.NIGHT_SEER:
      return '预言家查验';
    case Phase.NIGHT_WITCH:
      return '女巫用药';
    case Phase.DAWN:
      return '天亮公布死讯';
    case Phase.DAY_SPEECH:
      return '白天发言';
    case Phase.DAY_VOTE:
      return '投票放逐';
    case Phase.DAY_PK:
      return 'PK 发言与再投票';
    case Phase.DAY_EXILE:
      return '放逐结果';
    case Phase.GAME_OVER:
      return '游戏结束';
    default:
      return '未知阶段';
  }
}

/** 该角色在夜晚是否有行动（配置驱动：有该角色牌且 nightOrder 含该环节） */
export function roleHasNightAction(config: GameConfig, role: Role): boolean {
  const stage = role === Role.WEREWOLF ? 'WEREWOLF' : role === Role.SEER ? 'SEER' : role === Role.WITCH ? 'WITCH' : null;
  return stage !== null && config.nightOrder.includes(stage);
}

/** 是否夜晚阶段 */
export function isNightPhase(phase: Phase): boolean {
  return phase === Phase.NIGHT_WOLF || phase === Phase.NIGHT_SEER || phase === Phase.NIGHT_WITCH;
}
