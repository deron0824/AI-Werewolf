/**
 * ActionArea —— 操作区：白天发言输入 / 遗言输入，按阶段与发言轮次切换（P0-5）。
 * 迭代3 F3：支持 🎤 麦克风语音输入（Web Speech API 识别 → 字幕草稿 → 确认后提交）；
 * 不支持的环境（非 Chromium / 非安全上下文）不渲染按钮，静默回退键盘输入。
 */

import { useMemo, useRef, useState } from 'react';

import { Phase } from '@werewolf/shared';
import { useGameContext } from '../state/GameContext';
import { getSttSupport, startDictation, type DictationHandle } from '../speech/stt';

/** 发言最大字数（与 server config.speech.maxLength 对齐） */
const MAX_LEN = 300;

export default function ActionArea(): JSX.Element {
  const { view, lastWordsSeat, submitSpeech, submitLastWords, showToast } = useGameContext();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  // 迭代3 F3：语音识别状态（草稿 = 会话累计终稿 + 中间结果；提交时并入全文）
  const sttSupported = useMemo(() => getSttSupport(), []);
  const [listening, setListening] = useState(false);
  // draft 只承担"草稿更新 → 触发重渲染"职责，文本真值在 draftRef（composedText 合成全文）
  const [, setDraft] = useState('');
  const draftRef = useRef('');
  const dictationRef = useRef<DictationHandle | null>(null);

  const clearDraft = (): void => {
    setDraft('');
    draftRef.current = '';
  };

  const stopDictation = (): void => {
    dictationRef.current?.stop();
    dictationRef.current = null;
    setListening(false);
  };

  /** 合成当前全文 = 已确认内容 + 未确认识别草稿 */
  const composedText = (): string => (content + draftRef.current).slice(0, MAX_LEN);

  const toggleMic = (): void => {
    if (listening) {
      stopDictation(); // 草稿保留在 draft 里，textarea 继续显示合成全文
      return;
    }
    const handle = startDictation({
      onDraft: (full) => {
        draftRef.current = full;
        setDraft(full);
      },
      onError: (message) => {
        showToast(message);
        dictationRef.current?.stop();
        dictationRef.current = null;
        setListening(false);
        clearDraft();
      },
      // 非致命通知（如 90s 上限到期）：stt 内部已自动停止并保留草稿，
      // 此处复位按钮态即可，不清草稿
      onNotice: (message) => {
        dictationRef.current = null;
        setListening(false);
        showToast(message);
      },
    });
    if (handle) {
      dictationRef.current = handle;
      setListening(true);
      setDraft('');
      draftRef.current = '';
    }
  };

  if (!view) return <div />;

  /** 显式传参提交（避免闭包旧状态），提交成功后清空输入与草稿 */
  const submit = async (kind: 'speech' | 'lastwords', text: string): Promise<void> => {
    setBusy(true);
    try {
      if (kind === 'speech') await submitSpeech(text);
      else await submitLastWords(text);
      setContent('');
      clearDraft();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '发送失败');
    } finally {
      setBusy(false);
    }
  };

  // 遗言输入：法官播报“请 X 号留遗言”且 X 是我
  const myLastWords = lastWordsSeat !== null && lastWordsSeat === view.self.seat;

  /** 输入框 + 🎤 麦克风按钮（发言/遗言共用） */
  const inputBox = (
    accent: 'amber' | 'red',
    onSubmit: () => void,
    submitLabel: string,
  ): JSX.Element => {
    const accentBorder = accent === 'amber' ? 'border-amber-400/40' : 'border-red-400/40';
    const accentTitle = accent === 'amber' ? 'text-amber-300' : 'text-red-300';
    const accentBtn =
      accent === 'amber'
        ? 'bg-amber-500 text-night-900 hover:bg-amber-400'
        : 'bg-red-500/80 text-white hover:bg-red-500';
    return (
      <div className={`mx-2 mb-2 rounded-lg border ${accentBorder} bg-night-800/60 p-2`}>
        <div className="mb-1 flex items-center justify-between">
          <span className={`text-sm font-bold ${accentTitle}`}>
            {accent === 'amber' ? `轮到你发言（≤${MAX_LEN} 字）：` : `请留下你的遗言（≤${MAX_LEN} 字）：`}
          </span>
          {sttSupported && (
            <button
              type="button"
              onClick={toggleMic}
              className={`rounded px-2 py-0.5 text-xs font-bold ${
                listening ? 'bg-red-500 text-white animate-pulse' : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
            >
              {listening ? '⏹ 结束识别' : '🎤 语音输入'}
            </button>
          )}
        </div>
        <textarea
          value={composedText()}
          maxLength={MAX_LEN}
          onChange={(e) => {
            // 手动打字与识别互斥：识别中先停识别，把当前草稿并入内容，避免草稿反复覆盖用户打字
            if (listening) {
              stopDictation();
              const draft = draftRef.current;
              clearDraft();
              setContent((prev) => (prev + draft).slice(0, MAX_LEN));
            }
            setContent(e.target.value);
          }}
          className="w-full rounded bg-night-900/80 p-2 text-sm outline-none border border-white/10"
          rows={3}
          placeholder={
            accent === 'amber'
              ? '结合你的身份与已知信息发言……（也可以点 🎤 直接说）'
              : '说点对局势有用的信息……（也可以点 🎤 直接说）'
          }
        />
        <div className="mt-0.5 h-4 text-[11px] text-white/50">
          {listening
            ? '🎙️ 识别中……说完点击「⏹ 结束识别」，字幕会放进输入框（可先预览再提交）'
            : sttSupported
              ? '支持 🎤 语音输入：点一下说话，字幕自动打进输入框（首次需授权麦克风）'
              : ''}
        </div>
        <button
          type="button"
          disabled={busy || !composedText().trim()}
          onClick={onSubmit}
          className={`mt-1 w-full rounded py-1.5 text-sm font-bold disabled:opacity-40 ${accentBtn}`}
        >
          {submitLabel}
        </button>
      </div>
    );
  };

  if (myLastWords) {
    return inputBox('red', () => void submit('lastwords', composedText().trim()), '提交遗言');
  }

  if (view.phase === Phase.DAY_SPEECH && view.isMySpeechTurn) {
    return inputBox('amber', () => void submit('speech', composedText().trim()), '发送发言');
  }

  if (view.phase === Phase.DAY_SPEECH || view.phase === Phase.DAY_PK) {
    return (
      <div className="mx-2 mb-2 rounded-lg border border-white/10 bg-night-800/40 p-2 text-sm text-white/50">
        其他玩家发言中，请保持安静……（发言后进入投票环节）
      </div>
    );
  }

  return <div />;
}
