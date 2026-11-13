/**
 * 内置 AI 形象集（迭代4 F4/F5）：英雄联盟原画风格形象库。
 * avatarId 与 server RoomManager.AI_ROSTER 对应；
 * image 为形象图（/assets/img/*.jpg，ImageGen 预生成），缺失时回退 emoji。
 * 注意：persona 字段仅供展示兜底，服务端已不在 UI 层下发人设（每局随机洗牌，隐藏）。
 */

export interface AvatarDef {
  id: string;
  /** 头像 emoji（形象图缺失时的回退） */
  emoji: string;
  /** 展示名（AI 的默认昵称，中性名，与服务端花名册一致） */
  name: string;
  /** 性格标签（仅客户端兜底展示用；对局中人设由服务端隐藏） */
  persona: string;
  /** 头像底色 */
  color: string;
  /** 形象图 URL（英雄联盟原画风格，迭代4 F4） */
  image?: string;
}

export const AVATARS: Record<string, AvatarDef> = {
  human: {
    id: 'human',
    emoji: '🧑',
    name: '真人玩家',
    persona: '真人',
    color: '#4a6fa5',
  },
  'ai-1': {
    id: 'ai-1',
    emoji: '🛡️',
    name: '阿澈',
    persona: '—',
    color: '#4a6fa5',
    image: '/assets/img/ai-1.png',
  },
  'ai-2': {
    id: 'ai-2',
    emoji: '❄️',
    name: '青禾',
    persona: '—',
    color: '#3b7bd4',
    image: '/assets/img/ai-2.png',
  },
  'ai-3': {
    id: 'ai-3',
    emoji: '🎻',
    name: '陆离',
    persona: '—',
    color: '#7a4fb0',
    image: '/assets/img/ai-3.png',
  },
  'ai-4': {
    id: 'ai-4',
    emoji: '🏹',
    name: '白羽',
    persona: '—',
    color: '#4f8a5b',
    image: '/assets/img/ai-4.png',
  },
  'ai-5': {
    id: 'ai-5',
    emoji: '🗡️',
    name: '一鸣',
    persona: '—',
    color: '#d97a2b',
    image: '/assets/img/ai-5.png',
  },
  'ai-6': {
    id: 'ai-6',
    emoji: '📜',
    name: '望舒',
    persona: '—',
    color: '#2b7a78',
    image: '/assets/img/ai-6.png',
  },
};

/** 取头像定义（未知 id 回退到通用 AI 形象） */
export function avatarOf(avatarId: string): AvatarDef {
  return AVATARS[avatarId] ?? { id: avatarId, emoji: '🤖', name: 'AI 玩家', persona: 'AI', color: '#546e7a' };
}

/** 随机分配 AI 头像（发牌场景预留） */
export function randomAvatarId(): string {
  const ids = ['ai-1', 'ai-2', 'ai-3', 'ai-4', 'ai-5', 'ai-6'];
  return ids[Math.floor(Math.random() * ids.length)];
}

/** 形象图渲染组件：有 image 用图，无图回退 emoji（座位区/发言区共用） */
export function AvatarBadge({
  avatarId,
  size = 36,
  dead = false,
}: {
  avatarId: string;
  size?: number;
  dead?: boolean;
}): JSX.Element {
  const avatar = avatarOf(avatarId);
  const dim = { width: size, height: size };
  if (avatar.image) {
    return (
      <img
        src={avatar.image}
        alt={avatar.name}
        style={{ ...dim, objectFit: 'cover' }}
        className={`rounded-full border border-white/20 ${dead ? 'opacity-40 grayscale' : ''}`}
      />
    );
  }
  return (
    <div
      style={{ ...dim, backgroundColor: avatar.color }}
      className="flex items-center justify-center rounded-full text-xl"
    >
      {dead ? '💀' : avatar.emoji}
    </div>
  );
}
