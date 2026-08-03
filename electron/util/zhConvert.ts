import * as OpenCC from 'opencc-js';

// 简繁归一化助手（主进程用，CommonJS）。
//
// 背景：javbus 抓取进库的中文（演员名 / studio / label / title 等）都是繁体，
// 内置 actresses 库也是繁体；但用户 UI 输入习惯是简体。SQL LIKE 与前端 includes
// 对中文繁简不感知，导致「打简体搜不到繁体」。
//
// 策略：归一化方向「查询时转繁体去匹配库」（库保持原样不动，零迁移）。
// cn → t 是 OpenCC 标准繁体；库数据本身就是繁体来源，简转繁一次即可覆盖绝大多数互通。
// 对非中文 / 已是繁体的字 OpenCC 原样返回，安全无副作用。
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
