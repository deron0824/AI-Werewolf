/**
 * sfx —— 游戏音效（迭代4 F6）：昼夜转换、角色行动、死讯、胜负。
 * 两层设计：
 * 1) 素材优先：public/assets/sfx/{name}.mp3 存在则播放真实素材（后续放更好的音频即可，无需改代码）；
 * 2) WebAudio 合成兜底：零素材离线可用（鸡鸣/狼嚎/猫头鹰/铃音/气泡/鼓点均为合成近似音）。
 * 全部走用户手势解锁后的 AudioContext；不支持环境静默降级；开关持久化 localStorage。
 */

const SFX_ENABLED_KEY = 'werewolf-sfx-enabled';

/** 音效名 → 素材文件名（public/assets/sfx/ 下放同名 .mp3 即自动生效） */
const SFX_ASSETS: Record<string, string> = {
  dawn: '/assets/sfx/dawn.mp3',
  night: '/assets/sfx/night.mp3',
  wolf: '/assets/sfx/wolf.mp3',
  seer: '/assets/sfx/seer.mp3',
  witch: '/assets/sfx/witch.mp3',
  death: '/assets/sfx/death.mp3',
  vote: '/assets/sfx/vote.mp3',
  victory: '/assets/sfx/victory.mp3',
};

export function getSfxEnabled(): boolean {
  try {
    return localStorage.getItem(SFX_ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setSfxEnabled(on: boolean): void {
  try {
    localStorage.setItem(SFX_ENABLED_KEY, on ? '1' : '0');
  } catch {
    // 忽略持久化失败
  }
}

// ===== 播放基础设施 =====

let audioCtx: AudioContext | null = null;
const unlocked = { value: false };
/** 素材加载缓存：name → HTMLAudioElement（可播） */
const assetCache = new Map<string, HTMLAudioElement>();

/** 用户手势解锁（首次 click/keydown 调用一次即可） */
export function initSfxUnlock(): void {
  if (unlocked.value) return;
  const unlock = (): void => {
    unlocked.value = true;
    try {
      audioCtx = new AudioContext();
      void audioCtx.resume();
    } catch {
      audioCtx = null; // 不支持 WebAudio：仅素材路径仍可用
    }
    window.removeEventListener('click', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('click', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

/** 尝试取已缓存的素材音频（首次加载后缓存；加载失败返回 null） */
function loadAsset(name: string): HTMLAudioElement | null {
  if (assetCache.has(name)) return assetCache.get(name)!;
  const file = SFX_ASSETS[name];
  if (!file) return null;
  const el = new Audio(file);
  el.addEventListener('error', () => assetCache.set(name, null as unknown as HTMLAudioElement), { once: true });
  el.addEventListener('canplaythrough', () => assetCache.set(name, el), { once: true });
  el.load();
  // 首次加载未就绪：返回 null（本次走合成，下次起用素材）
  return null;
}

// ===== WebAudio 合成音效 =====

type SynthFn = (ctx: AudioContext, gain: GainNode) => void;

/** 白天（近似鸡鸣：两个上扬滑音 + 泛音） */
const synthDawn: SynthFn = (ctx, out) => {
  const cock = (t0: number, f0: number, f1: number, dur: number): void => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur * 0.6);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.7, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur);
  };
  const t = ctx.currentTime + 0.05;
  cock(t, 660, 990, 0.45);
  cock(t + 0.5, 700, 1050, 0.5);
};

/** 夜晚（低沉风声 + 猫头鹰两声） */
const synthNight: SynthFn = (ctx, out) => {
  const t = ctx.currentTime + 0.05;
  // 风声：滤波噪声
  const buf = ctx.createBuffer(1, ctx.sampleRate * 1.6, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 320;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.1, t + 0.6);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  noise.connect(filter).connect(ng).connect(out);
  noise.start(t);
  // 猫头鹰：两声低频正弦
  const hoot = (t0: number): void => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, t0);
    osc.frequency.exponentialRampToValueAtTime(255, t0 + 0.35);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.45);
  };
  hoot(t + 0.3);
  hoot(t + 0.95);
};

/** 狼人行动（近似狼嚎：低频正弦上扬再回落） */
const synthWolf: SynthFn = (ctx, out) => {
  const t = ctx.currentTime + 0.05;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(440, t + 0.7);
  osc.frequency.exponentialRampToValueAtTime(300, t + 1.5);
  const vib = ctx.createOscillator();
  const vg = ctx.createGain();
  vib.frequency.value = 5.5;
  vg.gain.value = 12;
  vib.connect(vg).connect(osc.frequency);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  osc.connect(g).connect(out);
  osc.start(t);
  vib.start(t);
  osc.stop(t + 1.7);
  vib.stop(t + 1.7);
};

/** 预言家行动（神秘水晶琶音） */
const synthSeer: SynthFn = (ctx, out) => {
  const t = ctx.currentTime + 0.05;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    const t0 = t + i * 0.14;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.55);
  });
};

/** 女巫行动（药水气泡：短促上滑音簇） */
const synthWitch: SynthFn = (ctx, out) => {
  const t = ctx.currentTime + 0.05;
  for (let i = 0; i < 6; i++) {
    const t0 = t + i * 0.16 + Math.random() * 0.05;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    const f0 = 300 + Math.random() * 250;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f0 * 1.8, t0 + 0.1);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  }
};

/** 死讯（低沉鼓点） */
const synthDeath: SynthFn = (ctx, out) => {
  const t = ctx.currentTime + 0.05;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.5);
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + 0.65);
};

/** 投票（木槌两击） */
const synthVote: SynthFn = (ctx, out) => {
  const knock = (t0: number): void => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(620, t0);
    osc.frequency.exponentialRampToValueAtTime(240, t0 + 0.08);
    g.gain.setValueAtTime(0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.12);
  };
  const t = ctx.currentTime + 0.05;
  knock(t);
  knock(t + 0.18);
};

/** 胜负（上扬小号式三连音） */
const synthVictory: SynthFn = (ctx, out) => {
  const t = ctx.currentTime + 0.05;
  [392, 523.25, 659.25, 783.99].forEach((f, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const t0 = t + i * 0.18;
    const dur = i === 3 ? 0.7 : 0.22;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  });
};

const SYNTHS: Record<string, SynthFn> = {
  dawn: synthDawn,
  night: synthNight,
  wolf: synthWolf,
  seer: synthSeer,
  witch: synthWitch,
  death: synthDeath,
  vote: synthVote,
  victory: synthVictory,
};

/** 播放一个音效（素材优先，合成兜底；开关关闭/未解锁/不支持时静默跳过） */
export function playSfx(name: keyof typeof SFX_ASSETS & string): void {
  if (!getSfxEnabled()) return;
  // 素材路径（canplaythrough 后缓存命中才走素材）
  const asset = loadAsset(name);
  if (asset) {
    void asset.play().catch(() => undefined);
    return;
  }
  // 合成兜底
  if (!audioCtx) return;
  try {
    const master = audioCtx.createGain();
    master.gain.value = 0.9;
    master.connect(audioCtx.destination);
    SYNTHS[name]?.(audioCtx, master);
  } catch {
    // 静默降级
  }
}
