/**
 * VotePanel —— 投票面板：头像点选 + 提交，实时已投票人数（不显示投给谁），
 * PK 阶段只允许选平票者（P0-5 / PRD §3.3）。
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

  const candidates = view.voteCandidates ?? view.players.filter((p) => p.alive && p.seat !== view.self.seat).map((p) => p.seat);
  const isPK = view.phase === Phase.DAY_PK;

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
    <div className="mx-2 mb-2 rounded-lg border border-amber-400/30 bg-night-800/60 p-2">
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
        className="mt-2 w-full rounded bg-amber-500 py-1.5 text-sm font-bold text-night-900 hover:bg-amber-400 disabled:opacity-40"
      >
        {selected !== null ? `投给 ${selected} 号` : '请先点选要放逐的座位'}
      </button>
    </div>
  );
}
