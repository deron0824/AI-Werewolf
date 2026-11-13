/**
 * NightPanel —— 夜间技能面板（狼刀/验人/用药三形态）+ 请闭眼遮罩（P0-10 / P0-5）。
 * 无权限时整体显示“🌙 请闭眼”遮罩，夜间私密信息不串屏。
 */

import { useMemo, useState } from 'react';

import { Phase, Role } from '@werewolf/shared';
import SeatGrid from './SeatGrid';
import { useGameContext } from '../state/GameContext';

export default function NightPanel(): JSX.Element {
  const { view, witchInfo, submitNightAction, showToast } = useGameContext();
  const [poisonTarget, setPoisonTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const myRole = view?.self.role ?? null;
  const phase = view?.phase;

  /** 当前夜间阶段我是否有行动权 */
  const myNightAction = useMemo(() => {
    if (!view || !view.isNight || !myRole || !view.self.alive) return null;
    if (phase === Phase.NIGHT_WOLF && myRole === Role.WEREWOLF) return 'wolf' as const;
    if (phase === Phase.NIGHT_SEER && myRole === Role.SEER) return 'seer' as const;
    if (phase === Phase.NIGHT_WITCH && myRole === Role.WITCH) return 'witch' as const;
    return null;
  }, [view, phase, myRole]);

  if (!view || !view.isNight) {
    return <div className="rounded-lg border border-white/10 bg-night-800/60 p-3 text-sm text-white/60">夜晚技能面板在夜晚开放。</div>;
  }

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  // 无权限：请闭眼遮罩
  if (myNightAction === null) {
    return (
      <div className="rounded-lg border border-white/10 bg-night-900/80 p-6 text-center">
        <div className="text-4xl">🌙</div>
        <div className="mt-2 text-sm text-white/70">请闭眼。当前阶段：{phaseLabel(phase)}</div>
      </div>
    );
  }

  const aliveOthers = view.players.filter((p) => p.alive && p.seat !== view.self.seat);

  if (myNightAction === 'wolf') {
    const teammates = view.wolfTeammates ?? [];
    const targets = aliveOthers.filter((p) => !teammates.includes(p.seat)).map((p) => p.seat);
    return (
      <div className="space-y-2">
        <div className="text-sm text-white/80">
          🐺 你的狼队友：{teammates.map((s) => `${s}号`).join('、') || '（无）'} · 队友正在决策中，刀口由引擎统一仲裁
        </div>
        <SeatGrid selectableSeats={targets} onSeatClick={(seat) => run(() => submitNightAction('wolf_kill', seat))} />
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => submitNightAction('wolf_kill'))}
          className="w-full rounded border border-white/20 py-1 text-sm text-white/70 hover:bg-white/5"
        >
          空刀（不出刀）
        </button>
      </div>
    );
  }

  if (myNightAction === 'seer') {
    const checked = new Set((view.checkRecords ?? []).map((c) => c.targetSeat));
    const targets = aliveOthers.map((p) => p.seat);
    return (
      <div className="space-y-2">
        <div className="text-sm text-white/80">🔮 请选择要查验的玩家（优先未验过的可疑位）：</div>
        <SeatGrid selectableSeats={targets} onSeatClick={(seat) => run(() => submitNightAction('seer_check', seat))} />
        {checked.size > 0 && (
          <div className="text-[11px] text-white/50">已验过：{[...checked].map((s) => `${s}号`).join('、')}</div>
        )}
      </div>
    );
  }

  // 女巫
  const potions = view.potions ?? { saveUsed: false, poisonUsed: false };
  const knife = view.witchKnifeTarget ?? witchInfo?.knifeTargetSeat ?? null;
  return (
    <div className="space-y-2 text-sm">
      <div className="text-white/80">⚗️ 今晚刀口：{knife !== null ? `${knife} 号` : '（解药已用/无刀口，不可知）'}</div>
      <div className="text-white/60 text-[12px]">
        药水：解药 {potions.saveUsed ? '已用' : '未用'} / 毒药 {potions.poisonUsed ? '已用' : '未用'} ·
        不可自救 · 不可同夜双用
      </div>
      {!potions.saveUsed && knife !== null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => submitNightAction('witch_save', knife))}
          className="w-full rounded bg-emerald-600/80 py-1.5 hover:bg-emerald-600"
        >
          用解药救 {knife} 号
        </button>
      )}
      {!potions.poisonUsed && (
        <div className="space-y-1">
          <div className="text-white/70">毒药目标：</div>
          <SeatGrid
            selectableSeats={aliveOthers.map((p) => p.seat)}
            onSeatClick={(seat) => setPoisonTarget(seat)}
            highlightSeat={poisonTarget}
          />
          <button
            type="button"
            disabled={busy || poisonTarget === null}
            onClick={() => poisonTarget !== null && run(() => submitNightAction('witch_poison', poisonTarget))}
            className="w-full rounded bg-purple-700/80 py-1.5 hover:bg-purple-700 disabled:opacity-40"
          >
            用毒药毒 {poisonTarget !== null ? `${poisonTarget} 号` : '（先选择目标）'}
          </button>
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => submitNightAction('skip'))}
        className="w-full rounded border border-white/20 py-1 text-sm text-white/70 hover:bg-white/5"
      >
        不用药
      </button>
    </div>
  );
}

function phaseLabel(phase: Phase | undefined): string {
  switch (phase) {
    case Phase.NIGHT_WOLF:
      return '狼人行动';
    case Phase.NIGHT_SEER:
      return '预言家查验';
    case Phase.NIGHT_WITCH:
      return '女巫用药';
    default:
      return '夜晚';
  }
}
