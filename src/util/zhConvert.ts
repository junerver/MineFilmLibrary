import * as OpenCC from 'opencc-js';

// 简繁归一化助手（渲染端用，Vite ESM）。
//
// 背景：与 electron/util/zhConvert.ts 同策略——查询时转繁体匹配库（库是 javbus
// 抓来的繁体）。前端纯字符串过滤（ActorPage / TagPage / StudioPage 的搜索框）
// 用这个函数把比较双方都转繁体后再 includes，覆盖简体输入命中繁体库值。
//
// 注意：opencc-js 字典在构建时打包进 JS，Vite 能正常 bundle（无需额外字典文件）。
// 若渲染端 bundle 过大，可改用 tree-shaking 版 opencc-js/core + opencc-js/preset。
const toT = OpenCC.Converter({ from: 'cn', to: 't' });

/** 把输入中可转的简体字转成繁体；非中文 / 已是繁体 / 空串原样返回。 */
export function toTraditional(s: string): string {
  if (!s) return s;
  try {
    return toT(s);
  } catch {
    return s;
  }
}
