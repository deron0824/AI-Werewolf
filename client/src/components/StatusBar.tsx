/**
 * StatusBar —— 顶部状态栏：天数 + 昼/夜图标 + 当前阶段名 + LLM 连接状态指示灯（P0-10）。
 */

import type { Phase } from '@werewolf/shared';
import { useGameContext } from '../state/GameContext';

/** 阶段中文名（与服务端 phases.phaseLabel 保持一致） */
function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'LOBBY':
      return '大厅';
    case 'NIGHT_WOLF':
      return '狼人行动';
    case 'NIGHT_SEER':
      return '预言家查验';
    case 'NIGHT_WITCH':
      return '女巫用药';
    case 'DAWN':
      return '天亮公布死讯';
    case 'DAY_SPEECH':
      return '白天发言';
    case 'DAY_VOTE':
      return '投票放逐';
    case 'DAY_PK':
      return 'PK 发言与再投票';
    case 'DAY_EXILE':
      return '放逐结果';
    case 'GAME_OVER':
      return '游戏结束';
    default:
      return '未知阶段';
  }
}

export default function StatusBar(): JSX.Element {
  const { view, llmStatus } = useGameContext();
  if (!view) return <div className="p-3 text-sm text-white/60">正在同步游戏状态…</div>;

  const route = llmStatus?.activeRoute ?? 'C';
  const routeText =
    route === 'A' ? 'WorkBuddy LLM' : route === 'B' ? 'OpenAI 兼容 LLM' : '模板句库（本地兜底）';
  const dotColor = route === 'C' ? 'bg-amber-400' : 'bg-emerald-400';

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-night-800/80 border-b border-white/10 text-sm">
      <div className="flex items-center gap-3">
        <span className="text-lg">{view.isNight ? '🌙' : '☀️'}</span>
        <span className="font-bold">
          {view.dayNumber > 0 ? `第 ${view.dayNumber} ${view.isNight ? '夜' : '天'}` : '未开局'}
        </span>
        <span className="text-white/60">·</span>
        <span>{phaseLabel(view.phase)}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-white/70" title={llmStatus?.message ?? ''}>
        <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
        <span>{routeText}</span>
        <span className="text-white/40">●已连接</span>
      </div>
    </div>
  );
}
