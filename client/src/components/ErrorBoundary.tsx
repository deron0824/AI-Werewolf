/**
 * ErrorBoundary —— 渲染错误兜底：麦克风崩溃等渲染期异常不再白屏，
 * 提供深色恢复界面（重新连接 / 回到大厅）。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { IDENTITY_KEY } from '../state/GameContext';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[ErrorBoundary] 渲染错误：', error, info.componentStack);
  }

  private reload = (): void => {
    location.reload();
  };

  /** 清掉本地身份凭证后回大厅（房间席位由服务端断线策略保留，不影响他人） */
  private backToLobby = (): void => {
    try {
      localStorage.removeItem(IDENTITY_KEY);
    } catch {
      // 忽略
    }
    location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-night-900 p-6 text-center text-white">
        <h1 className="mb-2 text-2xl font-bold text-red-300">页面出错了</h1>
        <p className="mb-1 max-w-md text-sm text-white/60">
          界面发生了意外错误，你的身份和对局仍在服务器上。重新连接即可回到当前对局。
        </p>
        {this.state.message && (
          <p className="mb-6 max-w-md break-all font-mono text-xs text-white/30">{this.state.message}</p>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={this.reload}
            className="rounded bg-amber-500 px-4 py-2 text-sm font-bold text-night-900 hover:bg-amber-400"
          >
            重新连接
          </button>
          <button
            type="button"
            onClick={this.backToLobby}
            className="rounded bg-white/10 px-4 py-2 text-sm font-bold text-white/80 hover:bg-white/20"
          >
            回到大厅
          </button>
        </div>
      </div>
    );
  }
}
