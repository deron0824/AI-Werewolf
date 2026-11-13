/**
 * 应用根组件：大厅 ↔ 对局 双页切换（无 react-router，按身份状态切换）
 * MUI ThemeProvider 统一深色主题。
 */

import { useMemo } from 'react';
import { createTheme, ThemeProvider, CssBaseline } from '@mui/material';

import { useGameContext } from './state/GameContext';
import LobbyPage from './pages/LobbyPage';
import GamePage from './pages/GamePage';

export default function App(): JSX.Element {
  const { identity } = useGameContext();

  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: 'dark',
          primary: { main: '#7c6dd4' },
          secondary: { main: '#e0a44f' },
          background: { default: 'transparent', paper: '#1f2a55' },
        },
        typography: {
          fontFamily: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
        },
      }),
    [],
  );

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      {identity ? <GamePage /> : <LobbyPage />}
    </ThemeProvider>
  );
}
