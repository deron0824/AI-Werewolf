/**
 * VotePanel —— 投票面板（迭代7 改版）：
 * - 收集窗口开启 + 有投票权：头像点选 + 提交，实时已投票人数；
 * - 收集窗口开启 + 无投票权（出局 / PK 被投对象）：只读等待态；
 * - 收集窗口关闭：展示完整票型明细（谁投给谁 + 各席位票数）。
 */

import { useState } from 'react';

import { Phase } from '@werewolf/shared';
import SeatGrid from './SeatGrid';
import { useGameContext } from '../state/GameContext';

export default function VotePanel(): JSX.Element {
  const { view, voteProgress, voteResult, submitVote, showToast } = useGameContext();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  if (!view || (view.phase !== Phase.DAY_VOTE && view.phase !== Phase.DAY_PK)) {
    return <div />;
  }

  const isPK = view.phase === Phase.DAY_PK;
  const nameOf = (seat: number): string => {
    const p = view.players.find((pl) => pl.seat === seat);
    return p ? `${seat}号 ${p.name}` : `${seat}号`;
  };

  // ===== 投票已结束：票型明细公示（迭代7 F3）=====
  if (view.voteCollecting === false && voteResult !== null) {
    const detailText =
      voteResult.details.length > 0
        ? voteResult.details.map((d) => `${nameOf(d.voterSeat)} → ${nameOf(d.targetSeat)}`).join('，')
        : '无人投票（全部弃票）';
    return (
      <div className="mx-2 mb-2 rounded-xl border border-sky-400/30 bg-night-800/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-base font-bold text-sky-300">🗳️ {isPK ? 'PK 投票' : '投票'}结果公示</span>
          {voteResult.exiledSeat !== null && (
            <span className="rounded-full bg-red-500/20 px-3 py-1 text-sm font-bold text-red-300">
              {voteResult.exiledSeat} 号被放逐
            </span>
          )}
        </div>
        <div className="mb-2 text-sm text-white/85 leading-relaxed">🧾 票型：{detailText}</div>
        <div className="flex flex-wrap gap-2">
          {voteResult.tally.map((t) => (
            <span
              key={t.seat}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
                t.count > 0 ? 'bg-amber-400/15 text-amber-300' : 'bg-white/5 text-white/40'
              }`}
            >
              {t.seat}号 · {t.count} 票
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ===== 收集窗口 + 无投票权（出局 / PK 被投对象）→ 只读等待态 =====
  if (view.selfCanVote !== true) {
    return (
      <div className="mx-2 mb-2 rounded-xl border border-white/10 bg-night-800/50 p-4 text-sm text-white/60">
        <div className="flex items-center justify-between">
          <span className="text-base font-bold text-white/70">{isPK ? 'PK 投票进行中' : '投票进行中'}</span>
          <span className="text-xs text-white/50">
            已投票：{voteProgress?.votedCount ?? 0} / {voteProgress?.totalVoters ?? 0}
          </span>
        </div>
        <div className="mt-1.5 text-xs">
          {isPK
            ? '你是本次 PK 的被投对象，本环节由其他玩家投票，请等待结果。'
            : view.self.alive
              ? '等待所有玩家完成投票……'
              : '你已出局，可旁观投票进程。'}
        </div>
      </div>
    );
  }

  // ===== 收集窗口 + 有投票权 → 点选投票 =====
  const candidates = view.voteCandidates ?? view.players.filter((p) => p.alive && p.seat !== view.self.seat).map((p) => p.seat);

  const submit = async (): Promise<void> => {
    if (selected === null) return;
    setBusy(true);
    try {
      await submitVote(selected);
      setSelected(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '投票失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-2 mb-2 rounded-xl border border-amber-400/30 bg-night-800/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-base font-bold text-amber-300">{isPK ? 'PK 投票（只能在平票者中选）' : '投票放逐'}</span>
        <span className="text-white/60 text-sm">
          已投票：{voteProgress?.votedCount ?? 0} / {voteProgress?.totalVoters ?? candidates.length + 1}
        </span>
      </div>
      <SeatGrid selectableSeats={candidates} onSeatClick={(seat) => setSelected(seat)} highlightSeat={selected} />
      <button
        type="button"
        disabled={busy || selected === null}
        onClick={() => void submit()}
        className="mt-3 w-full rounded-xl bg-amber-500 py-3 text-base font-bold text-night-900 hover:bg-amber-400 disabled:opacity-40"
      >
        {selected !== null ? `投给 ${selected} 号` : '请先点选要放逐的座位'}
      </button>
    </div>
  );
}
