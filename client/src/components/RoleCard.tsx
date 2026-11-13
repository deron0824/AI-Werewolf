/**
 * RoleCard —— 本人身份牌 + 私密信息（狼队友/查验记录/用药状态），仅本人可见。
 * 迭代4 F5：英雄联盟原画风格角色形象，在身份展示环节增强可视化体验。
 */

import { Role } from '@werewolf/shared';
import { useGameContext } from '../state/GameContext';

const ROLE_META: Record<
  Role,
  { name: string; emoji: string; color: string; desc: string; image: string }
> = {
  [Role.WEREWOLF]: {
    name: '狼人',
    emoji: '🐺',
    color: '#a83232',
    desc: '夜晚与队友统一刀口，白天伪装好人',
    image: '/assets/img/role-werewolf.png',
  },
  [Role.SEER]: {
    name: '预言家',
    emoji: '🔮',
    color: '#5b7fd4',
    desc: '每晚查验一人阵营，白天报信息',
    image: '/assets/img/role-seer.png',
  },
  [Role.WITCH]: {
    name: '女巫',
    emoji: '⚗️',
    color: '#7a4fb0',
    desc: '一瓶解药一瓶毒药，不可自救、不可同夜双用',
    image: '/assets/img/role-witch.png',
  },
  [Role.VILLAGER]: {
    name: '平民',
    emoji: '🧑‍🌾',
    color: '#4f8a5b',
    desc: '靠听发言找狼，投票放逐',
    image: '/assets/img/role-villager.png',
  },
};

export default function RoleCard(): JSX.Element {
  const { view, wolfTeammates } = useGameContext();
  if (!view) return <div />;

  const role = view.self.role;
  if (!role) {
    return (
      <div className="rounded-lg border border-white/10 bg-night-800/60 p-3 text-sm text-white/60">
        身份牌将在开局后发放。
      </div>
    );
  }
  const meta = ROLE_META[role];

  return (
    <div
      className="overflow-hidden rounded-lg border text-sm"
      style={{ borderColor: meta.color }}
    >
      {/* 迭代4 F5：角色原画横幅（形象缺失时浏览器仅不显示图片，不影响信息） */}
      <div className="relative h-32 w-full">
        <img
          src={meta.image}
          alt={meta.name}
          className="h-full w-full object-cover"
          style={{ backgroundColor: `${meta.color}33` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div
          className="absolute bottom-1.5 left-2.5 flex items-center gap-2 font-bold text-lg"
          style={{ color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,.9)' }}
        >
          <span className="text-2xl">{meta.emoji}</span>
          {meta.name}
          <span className="text-[10px] font-normal text-white/70">（仅你可见）</span>
        </div>
      </div>
      <div style={{ backgroundColor: `${meta.color}22` }}>
        <div className="px-3 pt-2 text-[11px] text-white/70">{meta.desc}</div>
        <div className="space-y-1 px-3 pb-2.5 pt-1 text-[12px] text-white/80">
          {role === Role.WEREWOLF && (
            <div>
              狼队友：
              {(view.wolfTeammates ?? wolfTeammates ?? []).length > 0
                ? (view.wolfTeammates ?? wolfTeammates ?? []).map((s) => `${s}号`).join('、')
                : '（暂无存活队友）'}
            </div>
          )}
          {role === Role.SEER && (
            <div>
              查验记录：
              {view.checkRecords && view.checkRecords.length > 0 ? (
                <ul className="mt-1 list-disc pl-4">
                  {view.checkRecords.map((c) => (
                    <li key={`${c.dayNumber}-${c.targetSeat}`}>
                      第{c.dayNumber}夜验 {c.targetSeat}号 =
                      <span className={c.result === 'WEREWOLF' ? 'text-red-400' : 'text-emerald-400'}>
                        {c.result === 'WEREWOLF' ? '狼人' : '好人'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="ml-1 text-white/50">（尚未查验）</span>
              )}
            </div>
          )}
          {role === Role.WITCH && view.potions && (
            <div>
              药水状态：解药 {view.potions.saveUsed ? '✖ 已用' : '✔ 未用'} / 毒药{' '}
              {view.potions.poisonUsed ? '✖ 已用' : '✔ 未用'}
              {view.witchKnifeTarget != null && !view.potions.saveUsed && (
                <div className="mt-1 text-amber-300">今晚刀口：{view.witchKnifeTarget} 号（仅你知道）</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
