/**
 * SeatGrid —— 6 席网格（迭代7 改版：大尺寸方正卡片 + 大头像，增强交互感）：
 * 头像/昵称/AI 标识/死亡置灰/打字中动效/结算翻牌角色名。
 * 迭代2：空座渲染"等待玩家加入"占位态（2 号真人预留席附房间码邀请提示，拍板①）。
 */

import { Phase, Role } from '@werewolf/shared';

import { AvatarBadge } from './avatars';
import { useGameContext } from '../state/GameContext';

interface SeatGridProps {
  /** 点选座位回调（夜间技能/投票用）；空数组表示不可点选 */
  selectableSeats?: number[];
  onSeatClick?: (seat: number) => void;
  /** 高亮座位（当前发言者/刀口提示等） */
  highlightSeat?: number | null;
}

/** 结算翻牌后的角色展示名 */
const ROLE_LABEL: Record<string, { text: string; cls: string }> = {
  [Role.WEREWOLF]: { text: '🐺 狼人', cls: 'bg-red-500/20 text-red-300' },
  [Role.SEER]: { text: '🔮 预言家', cls: 'bg-sky-500/20 text-sky-300' },
  [Role.WITCH]: { text: '⚗️ 女巫', cls: 'bg-purple-500/20 text-purple-300' },
  [Role.VILLAGER]: { text: '🧑‍🌾 平民', cls: 'bg-emerald-500/20 text-emerald-300' },
};

export default function SeatGrid({ selectableSeats = [], onSeatClick, highlightSeat }: SeatGridProps): JSX.Element {
  const { view, identity, typingSeats } = useGameContext();
  if (!view) return <div />;

  const seatCount = Math.max(6, ...view.players.map((p) => p.seat));
  const occupied = new Map(view.players.map((p) => [p.seat, p]));
  const seats = Array.from({ length: seatCount }, (_, i) => i + 1);
  const showPlaceholder = view.phase === Phase.LOBBY;

  return (
    <div className="grid grid-cols-2 gap-3 px-2 xl:grid-cols-3">
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
              className="rounded-2xl border border-dashed border-white/20 bg-night-900/40 p-4 text-left"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-2xl">⏳</div>
                <div className="min-w-0">
                  <div className="truncate text-base font-bold text-white/40">{seat}号 等待玩家加入…</div>
                  <div className="text-xs text-white/40">空座开局时自动补 AI</div>
                </div>
              </div>
              {isReservedForHuman && identity && (
                <div className="mt-2 text-xs text-amber-300/80">
                  邀请好友输入房间码 <span className="font-bold">{identity.roomCode}</span> 即可坐此席
                </div>
              )}
            </div>
          );
        }
        const isSelf = p.seat === view.self.seat;
        const selectable = selectableSeats.includes(p.seat);
        const typing = typingSeats.includes(p.seat);
        const revealedRole = p.role ? ROLE_LABEL[p.role] : null;
        return (
          <button
            key={p.seat}
            type="button"
            disabled={!selectable}
            onClick={() => selectable && onSeatClick?.(p.seat)}
            className={`flex min-h-[148px] flex-col justify-between rounded-2xl border p-3.5 text-left shadow-lg shadow-black/30 transition ${
              p.alive ? '' : 'opacity-45 grayscale'
            } ${
              selectable
                ? 'cursor-pointer border-amber-400/80 bg-amber-400/10 hover:bg-amber-400/20'
                : 'border-white/10 bg-night-800/60'
            } ${highlightSeat === p.seat ? 'ring-2 ring-emerald-400' : ''} ${
              isSelf && highlightSeat !== p.seat ? 'ring-1 ring-amber-300/40' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              {/* 迭代4 F4：AI 使用英雄联盟原画风格形象图（缺失回退 emoji）；迭代7：大头像 */}
              <div className="rounded-full ring-2 ring-white/15">
                <AvatarBadge avatarId={p.avatarId} size={56} dead={!p.alive} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-bold">
                  {p.seat}号 {p.name}
                  {isSelf && <span className="ml-1 text-xs text-amber-300">(你)</span>}
                </div>
                <div className="text-xs text-white/60">{p.isHuman ? '👤 真人' : '🤖 AI'}</div>
              </div>
            </div>
            {/* 结算翻牌：角色名徽章（迭代7） */}
            {revealedRole && (
              <div className="mt-2">
                <span className={`inline-block rounded-lg px-2.5 py-1 text-xs font-bold ${revealedRole.cls}`}>
                  {revealedRole.text}
                </span>
              </div>
            )}
            <div className="mt-2">
              {p.alive ? (
                typing ? (
                  <span className="inline-block animate-pulse rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300">
                    打字中…
                  </span>
                ) : (
                  <span className="inline-block rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400">
                    ✔ 存活
                  </span>
                )
              ) : (
                <span className="inline-block rounded-full bg-red-500/15 px-2.5 py-1 text-xs text-red-400">
                  ✖ 出局
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
