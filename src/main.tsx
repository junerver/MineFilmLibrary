import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

// HashRouter：打包版经 win.loadFile 加载（file:// 路径），BrowserRouter 的
// pathname 是文件路径、匹配不到任何路由（白屏）；hash 路由两种模式都正常。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
