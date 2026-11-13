/**
 * VotePanel —— 投票面板：头像点选 + 提交，实时已投票人数（不显示投给谁），
 * PK 阶段只允许选平票者（P0-5 / PRD §3.3）。
 * 迭代6修复：无投票权的玩家（平票者本人/出局者）渲染等待态，不再展示可点选面板——
 * 修复“PK 轮本人是被投对象时点投票报错、界面像坏掉”的问题。
 */

import { useState } from 'react';

import { Phase } from '@werewolf/shared';
import SeatGrid from './SeatGrid';
import { useGameContext } from '../state/GameContext';

export default function VotePanel(): JSX.Element {
  const { view, voteProgress, submitVote, showToast } = useGameContext();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  if (!view || (view.phase !== Phase.DAY_VOTE && view.phase !== Phase.DAY_PK)) {
    return <div />;
  }

  const isPK = view.phase === Phase.DAY_PK;

  // 迭代6：本轮无投票权（出局 / PK 被投对象）→ 只读等待态
  if (view.selfCanVote !== true) {
    return (
      <div className="mx-2 mb-2 rounded-xl border border-white/10 bg-night-800/50 p-3 text-sm text-white/60">
        <div className="flex items-center justify-between">
          <span className="font-bold text-white/70">{isPK ? 'PK 投票进行中' : '投票进行中'}</span>
          <span className="text-xs text-white/50">
            已投票：{voteProgress?.votedCount ?? 0} / {voteProgress?.totalVoters ?? 0}
          </span>
        </div>
        <div className="mt-1 text-xs">
          {isPK
            ? '你是本次 PK 的被投对象，本环节由其他玩家投票，请等待结果。'
            : view.self.alive
              ? '等待所有玩家完成投票……'
              : '你已出局，可旁观投票进程。'}
        </div>
      </div>
    );
  }

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
    <div className="mx-2 mb-2 rounded-xl border border-amber-400/30 bg-night-800/60 p-2">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-bold text-amber-300">{isPK ? 'PK 投票（只能在平票者中选）' : '投票放逐'}</span>
        <span className="text-white/60 text-xs">
          已投票：{voteProgress?.votedCount ?? 0} / {voteProgress?.totalVoters ?? candidates.length + 1}
        </span>
      </div>
      <SeatGrid selectableSeats={candidates} onSeatClick={(seat) => setSelected(seat)} highlightSeat={selected} />
      <button
        type="button"
        disabled={busy || selected === null}
        onClick={() => void submit()}
        className="mt-2 w-full rounded-lg bg-amber-500 py-1.5 text-sm font-bold text-night-900 hover:bg-amber-400 disabled:opacity-40"
      >
        {selected !== null ? `投给 ${selected} 号` : '请先点选要放逐的座位'}
      </button>
    </div>
  );
}
