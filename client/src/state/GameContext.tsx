/**
 * GameContext —— useReducer 管理服务端推送的 GameStateView（状态权威在服务端，本地无派生逻辑）。
 * 身份持久化 localStorage，断线后凭 rejoinToken 自动重连（P1-5）。
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { Phase } from '@werewolf/shared';
import type {
  CheckResultPayload,
  GameOverPayload,
  GameStateView,
  LLMSettingsView,
  RoomIdentity,
  VoteProgressPayload,
  VoteResultPayload,
  WitchInfoPayload,
} from '@werewolf/shared';

import { api, getSocket, type AppSocket } from '../api/socket';
import { speakAI, speakJudge, initSpeechUnlock } from '../speech/tts';
import { playSfx, initSfxUnlock } from '../speech/sfx';

// ===== 身份持久化 =====

const IDENTITY_KEY = 'werewolf-demo-identity';

function loadIdentity(): RoomIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RoomIdentity;
    return parsed.roomId && parsed.playerId ? parsed : null;
  } catch {
    return null;
  }
}

function saveIdentity(identity: RoomIdentity | null): void {
  if (identity) {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } else {
    localStorage.removeItem(IDENTITY_KEY);
  }
}

// ===== 状态 =====

export interface GameState {
  identity: RoomIdentity | null;
  view: GameStateView | null;
  connected: boolean;
  llmStatus: { activeRoute: 'A' | 'B' | 'C'; message: string } | null;
  /** 法官播报流水（judge:say 追加） */
  judgeMessages: string[];
  /** 死讯流水 */
  deaths: { seats: number[]; cause: string }[];
  /** 需要留遗言的座位（解析法官播报“请 X 号留遗言”） */
  lastWordsSeat: number | null;
  /** 私密：查验结果（预言家） */
  checkResults: CheckResultPayload[];
  /** 私密：狼队友（狼人） */
  wolfTeammates: number[] | null;
  /** 私密：女巫刀口 */
  witchInfo: WitchInfoPayload | null;
  /** 投票进度/结果 */
  voteProgress: VoteProgressPayload | null;
  voteResult: VoteResultPayload | null;
  /** AI 打字中座位 */
  typingSeats: number[];
  /** 胜负 */
  gameOver: GameOverPayload | null;
  /** 全局提示（操作失败原因等） */
  toast: string | null;
}

type GameAction =
  | { type: 'identity'; identity: RoomIdentity | null }
  | { type: 'connected'; connected: boolean }
  | { type: 'view'; view: GameStateView }
  | { type: 'llm'; status: { activeRoute: 'A' | 'B' | 'C'; message: string } }
  | { type: 'judge'; text: string }
  | { type: 'deaths'; payload: { seats: number[]; cause: string } }
  | { type: 'check'; payload: CheckResultPayload }
  | { type: 'wolf'; payload: { seats: number[] } }
  | { type: 'witch'; payload: WitchInfoPayload }
  | { type: 'voteProgress'; payload: VoteProgressPayload }
  | { type: 'voteResult'; payload: VoteResultPayload }
  | { type: 'typing'; seat: number; on: boolean }
  | { type: 'gameOver'; payload: GameOverPayload | null }
  | { type: 'gameRestart' }
  | { type: 'toast'; message: string | null }
  | { type: 'settings'; view: LLMSettingsView }
  | { type: 'lastWordsSeat'; seat: number | null };

const initialState: GameState = {
  identity: null,
  view: null,
  connected: false,
  llmStatus: null,
  judgeMessages: [],
  deaths: [],
  lastWordsSeat: null,
  checkResults: [],
  wolfTeammates: null,
  witchInfo: null,
  voteProgress: null,
  voteResult: null,
  typingSeats: [],
  gameOver: null,
  toast: null,
};

function reducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'identity': {
      const identity = action.identity;
      if (!identity) return { ...initialState };
      return {
        ...state,
        identity,
        view: null,
        judgeMessages: [],
        deaths: [],
        checkResults: [],
        wolfTeammates: null,
        witchInfo: null,
        voteProgress: null,
        voteResult: null,
        typingSeats: [],
        gameOver: null,
        toast: null,
      };
    }
    case 'connected':
      return { ...state, connected: action.connected };
    case 'view': {
      // 迭代2 F6 兜底：回到大厅且无胜者（重开后的 state:sync）也清掉旧局弹窗
      const backToLobby = action.view.phase === Phase.LOBBY && (action.view.winner ?? null) === null;
      return { ...state, view: action.view, gameOver: backToLobby ? null : state.gameOver };
    }
    case 'llm':
      return { ...state, llmStatus: action.status };
    case 'judge': {
      // 解析“请 X 号留遗言”用于开启遗言输入
      const match = action.text.match(/请\s*(\d+)\s*号留遗言/);
      const seat = match ? Number(match[1]) : null;
      return {
        ...state,
        judgeMessages: [...state.judgeMessages, action.text].slice(-80),
        lastWordsSeat: seat,
      };
    }
    case 'deaths':
      return { ...state, deaths: [...state.deaths, action.payload] };
    case 'check':
      return { ...state, checkResults: [...state.checkResults, action.payload] };
    case 'wolf':
      return { ...state, wolfTeammates: action.payload.seats };
    case 'witch':
      return { ...state, witchInfo: action.payload };
    case 'voteProgress':
      return { ...state, voteProgress: action.payload };
    case 'voteResult':
      return { ...state, voteResult: action.payload, voteProgress: null };
    case 'typing': {
      const set = new Set(state.typingSeats);
      if (action.on) set.add(action.seat);
      else set.delete(action.seat);
      return { ...state, typingSeats: [...set] };
    }
    case 'gameOver':
      return { ...state, gameOver: action.payload };
    case 'gameRestart':
      // 迭代2 F6 主修复（RC1）：收到 game:restart 立即清空全部会话级状态，
      // 胜负弹窗随之关闭；紧随其后的 state:sync（新局发牌）即新局起点
      return {
        ...state,
        gameOver: null,
        judgeMessages: [],
        deaths: [],
        checkResults: [],
        wolfTeammates: null,
        witchInfo: null,
        voteProgress: null,
        voteResult: null,
        typingSeats: [],
        lastWordsSeat: null,
      };
    case 'toast':
      return { ...state, toast: action.message };
    case 'settings':
      return { ...state, toast: null };
    case 'lastWordsSeat':
      return { ...state, lastWordsSeat: action.seat };
    default:
      return state;
  }
}

// ===== Context =====

interface GameContextValue extends GameState {
  /** 建房 / 加入 / 退出 */
  createRoom: (nickname: string) => Promise<void>;
  joinRoom: (roomCode: string, nickname: string) => Promise<void>;
  leaveRoom: () => void;
  /** 对局操作（均走 socket ack） */
  startGame: () => Promise<void>;
  restartGame: () => Promise<void>;
  /** 迭代4 F3：房主设置 AI 难度（高/中/低，仅大厅可改） */
  setDifficulty: (difficulty: 'high' | 'medium' | 'low') => Promise<void>;
  submitNightAction: (type: string, targetSeat?: number) => Promise<void>;
  submitSpeech: (content: string) => Promise<void>;
  submitVote: (targetSeat: number) => Promise<void>;
  submitLastWords: (content: string) => Promise<void>;
  showToast: (message: string) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => ({
    ...init,
    identity: loadIdentity(),
  }));
  const socketRef = useRef<AppSocket | null>(null);
  const identityRef = useRef<RoomIdentity | null>(state.identity);
  identityRef.current = state.identity;

  // socket 事件订阅（一次性建立）
  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;
    // TTS 自动播放策略：首次用户手势解锁（一次即可，见 speech/tts.ts）
    initSpeechUnlock();
    // 音效（WebAudio/素材）：同样依赖首次手势解锁
    initSfxUnlock();

    const joinIfHaveIdentity = (): void => {
      const identity = identityRef.current;
      if (!identity) return;
      socket.emit(
        'room:join-socket',
        { playerId: identity.playerId, rejoinToken: identity.rejoinToken },
        (res) => {
          if (!res.ok) {
            // 身份失效（房间解散等）：清身份回大厅
            dispatch({ type: 'identity', identity: null });
            saveIdentity(null);
            dispatch({ type: 'toast', message: res.error ?? '房间已失效，请重新建房/加入' });
          }
        },
      );
    };

    socket.on('connect', () => {
      dispatch({ type: 'connected', connected: true });
      joinIfHaveIdentity();
    });
    socket.on('disconnect', () => dispatch({ type: 'connected', connected: false }));
    socket.on('state:sync', (view) => dispatch({ type: 'view', view }));
    socket.on('llm:status', (status) => dispatch({ type: 'llm', status }));
    socket.on('phase:change', ({ phase, isNight }) => {
      // 迭代4 F6：昼夜转换与角色行动音效（1~3s 短特效）
      if (isNight) {
        if (phase === 'NIGHT_WOLF') playSfx('wolf');
        else if (phase === 'NIGHT_SEER') playSfx('seer');
        else if (phase === 'NIGHT_WITCH') playSfx('witch');
        else playSfx('night');
      } else if (phase === 'DAWN') {
        playSfx('dawn');
      } else if (phase === 'DAY_VOTE' || phase === 'DAY_PK') {
        playSfx('vote');
      }
      // DAY_SPEECH / DAY_EXILE / GAME_OVER / LOBBY：不响短特效（胜负另有 victory 音）
    });
    socket.on('judge:say', ({ text }) => {
      dispatch({ type: 'judge', text });
      // 法官播报配音（可选开关，默认关；经 SpeechQueue 串行仲裁）
      speakJudge(text);
    });
    socket.on('speech:new', (entry) => {
      // AI 发言语音播报（开关默认开；整句入队串行播放，文字面板不受影响）
      if (entry.isAI) speakAI(entry.avatarId, `${entry.name}说：${entry.content}`);
    });
    socket.on('death:announce', (payload) => {
      dispatch({ type: 'deaths', payload: { seats: payload.seats, cause: payload.cause } });
      playSfx('death');
    });
    socket.on('check:result', (payload) => dispatch({ type: 'check', payload }));
    socket.on('wolf:teammates', (payload) => dispatch({ type: 'wolf', payload }));
    socket.on('witch:info', (payload) => dispatch({ type: 'witch', payload }));
    socket.on('vote:progress', (payload) => dispatch({ type: 'voteProgress', payload }));
    socket.on('vote:result', (payload) => dispatch({ type: 'voteResult', payload }));
    socket.on('typing:start', ({ seat }) => dispatch({ type: 'typing', seat, on: true }));
    socket.on('typing:stop', ({ seat }) => dispatch({ type: 'typing', seat, on: false }));
    socket.on('game:over', (payload) => {
      dispatch({ type: 'gameOver', payload });
      playSfx('victory');
    });
    socket.on('game:restart', () => dispatch({ type: 'gameRestart' }));

    if (socket.connected) {
      dispatch({ type: 'connected', connected: true });
      joinIfHaveIdentity();
    }

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('state:sync');
      socket.off('llm:status');
      socket.off('phase:change');
      socket.off('judge:say');
      socket.off('death:announce');
      socket.off('check:result');
      socket.off('wolf:teammates');
      socket.off('witch:info');
      socket.off('vote:progress');
      socket.off('vote:result');
      socket.off('typing:start');
      socket.off('typing:stop');
      socket.off('game:over');
      socket.off('game:restart');
      socket.off('speech:new');
    };
  }, []);

  const showToast = useCallback((message: string) => {
    dispatch({ type: 'toast', message });
  }, []);

  const createRoom = useCallback(async (nickname: string) => {
    const identity = await api.createRoom(nickname);
    saveIdentity(identity);
    dispatch({ type: 'identity', identity });
    getSocket().emit('room:join-socket', { playerId: identity.playerId, rejoinToken: identity.rejoinToken }, (res) => {
      if (!res.ok) showToast(res.error ?? 'socket 绑定失败');
    });
  }, [showToast]);

  const joinRoom = useCallback(async (roomCode: string, nickname: string) => {
    const identity = await api.joinRoom(roomCode, nickname);
    saveIdentity(identity);
    dispatch({ type: 'identity', identity });
    getSocket().emit('room:join-socket', { playerId: identity.playerId, rejoinToken: identity.rejoinToken }, (res) => {
      if (!res.ok) showToast(res.error ?? 'socket 绑定失败');
    });
  }, [showToast]);

  const leaveRoom = useCallback(() => {
    saveIdentity(null);
    dispatch({ type: 'identity', identity: null });
  }, []);

  const startGame = useCallback(async () => {
    const socket = getSocket();
    await new Promise<void>((resolve, reject) => {
      socket.emit('game:start', {}, (res) => {
        if (res.ok) resolve();
        else reject(new Error(res.error ?? '无法开始游戏'));
      });
    });
  }, []);

  /**
   * 结束后“继续游戏”确认（迭代7 F2）：任一真人玩家可点（不再限定房主）。
   * 两名真人都确认后，服务端同房原子重开一局（不带上局任何信息）。
   */
  const restartGame = useCallback(async () => {
    const socket = getSocket();
    await new Promise<void>((resolve, reject) => {
      socket.emit('game:restart-request', {}, (res) => {
        if (res.ok) resolve();
        else reject(new Error(res.error ?? '无法重开游戏'));
      });
    });
  }, []);

  const setDifficulty = useCallback(async (difficulty: 'high' | 'medium' | 'low') => {
    const socket = getSocket();
    await new Promise<void>((resolve, reject) => {
      socket.emit('room:set-difficulty', { difficulty }, (res) => {
        if (res.ok) resolve();
        else reject(new Error(res.error ?? '无法调整难度'));
      });
    });
  }, []);

  const submitNightAction = useCallback(async (type: string, targetSeat?: number) => {
    const socket = getSocket();
    await new Promise<void>((resolve, reject) => {
      socket.emit('action:night', { type: type as never, targetSeat }, (res) => {
        if (res.ok) resolve();
        else reject(new Error(res.error ?? '行动被拒绝'));
      });
    });
  }, []);

  const submitSpeech = useCallback(async (content: string) => {
    const socket = getSocket();
    await new Promise<void>((resolve, reject) => {
      socket.emit('speech:submit', { content }, (res) => {
        if (res.ok) resolve();
        else reject(new Error(res.error ?? '发言被拒绝'));
      });
    });
  }, []);

  const submitVote = useCallback(async (targetSeat: number) => {
    const socket = getSocket();
    await new Promise<void>((resolve, reject) => {
      socket.emit('vote:submit', { targetSeat }, (res) => {
        if (res.ok) resolve();
        else reject(new Error(res.error ?? '投票被拒绝'));
      });
    });
  }, []);

  const submitLastWords = useCallback(async (content: string) => {
    const socket = getSocket();
    await new Promise<void>((resolve, reject) => {
      socket.emit('lastwords:submit', { content }, (res) => {
        if (res.ok) {
          dispatch({ type: 'lastWordsSeat', seat: null });
          resolve();
        } else {
          reject(new Error(res.error ?? '遗言被拒绝'));
        }
      });
    });
  }, []);

  const value = useMemo<GameContextValue>(
    () => ({
      ...state,
      createRoom,
      joinRoom,
      leaveRoom,
      startGame,
      restartGame,
      setDifficulty,
      submitNightAction,
      submitSpeech,
      submitVote,
      submitLastWords,
      showToast,
    }),
    [state, createRoom, joinRoom, leaveRoom, startGame, restartGame, setDifficulty, submitNightAction, submitSpeech, submitVote, submitLastWords, showToast],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext 必须在 GameProvider 内使用');
  return ctx;
}
