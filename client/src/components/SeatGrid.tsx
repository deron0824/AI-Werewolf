/**
 * SeatGrid —— 6 席网格：头像/昵称/AI 标识/死亡置灰/打字中动效。
 * 迭代2：空座渲染“等待玩家加入”占位态（2 号真人预留席附房间码邀请提示，拍板①）。
 */

import { Phase } from '@werewolf/shared';

import { AvatarBadge } from './avatars';
import { useGameContext } from '../state/GameContext';

interface SeatGridProps {
  /** 点选座位回调（夜间技能/投票用）；空数组表示不可点选 */
  selectableSeats?: number[];
  onSeatClick?: (seat: number) => void;
  /** 高亮座位（当前发言者/刀口提示等） */
  highlightSeat?: number | null;
}

export default function SeatGrid({ selectableSeats = [], onSeatClick, highlightSeat }: SeatGridProps): JSX.Element {
  const { view, identity, typingSeats } = useGameContext();
  if (!view) return <div />;

  const seatCount = Math.max(6, ...view.players.map((p) => p.seat));
  const occupied = new Map(view.players.map((p) => [p.seat, p]));
  const seats = Array.from({ length: seatCount }, (_, i) => i + 1);
  const showPlaceholder = view.phase === Phase.LOBBY;

  return (
    <div className="grid grid-cols-3 gap-2 px-3">
      {seats.map((seat) => {
        const p = occupied.get(seat);
        // 空座占位态：仅大厅阶段渲染（对局中席位恒满员）
        if (!p) {
          if (!showPlaceholder) return <div key={`empty-${seat}`} />;
          // 2 号位是第二真人预留席（房主占 1 号座、AI 预览占 3-6 号座，空座只可能是 2 号）
          const isReservedForHuman = seat === 2;
          return (
            <div
              key={`empty-${seat}`}
              className="rounded-lg border border-dashed border-white/20 bg-night-900/40 p-2 text-left"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl">⏳</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-white/40">{seat}号 等待玩家加入…</div>
                  <div className="text-[10px] text-white/40">空座开局时自动补 AI</div>
                </div>
              </div>
              {isReservedForHuman && identity && (
                <div className="mt-1 text-[11px] text-amber-300/80">
                  邀请好友输入房间码 <span className="font-bold">{identity.roomCode}</span> 即可坐此席
                </div>
              )}
            </div>
          );
        }
        const isSelf = p.seat === view.self.seat;
        const selectable = selectableSeats.includes(p.seat);
        const typing = typingSeats.includes(p.seat);
        return (
          <button
            key={p.seat}
            type="button"
            disabled={!selectable}
            onClick={() => selectable && onSeatClick?.(p.seat)}
            className={`rounded-lg border p-2 text-left transition ${
              p.alive ? '' : 'opacity-40 grayscale'
            } ${selectable ? 'border-amber-400/80 bg-amber-400/10 cursor-pointer hover:bg-amber-400/20' : 'border-white/10 bg-night-800/60'} ${
              highlightSeat === p.seat ? 'ring-2 ring-emerald-400' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              {/* 迭代4 F4：AI 使用英雄联盟原画风格形象图（缺失回退 emoji） */}
              <AvatarBadge avatarId={p.avatarId} dead={!p.alive} />
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">
                  {p.seat}号 {p.name}
                  {isSelf && <span className="ml-1 text-amber-300 text-xs">(你)</span>}
                </div>
                <div className="text-[10px] text-white/60">
                  {p.isHuman ? '👤 真人' : `🤖 AI`}
                  {p.role && <span className="ml-1 text-amber-300">·已翻牌</span>}
                </div>
              </div>
            </div>
            <div className="mt-1 text-[11px]">
              {p.alive ? (
                typing ? (
                  <span className="text-emerald-300 animate-pulse">打字中…</span>
                ) : (
                  <span className="text-emerald-400">✔ 存活</span>
                )
              ) : (
                <span className="text-red-400">✖ 出局</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
