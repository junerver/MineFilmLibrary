import { useEffect, useState } from 'react';
import { useToast } from '../components/Toaster';

const mfl = (): any => (window as any).mfl;

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default function SettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [scanMaxDepth, setScanMaxDepth] = useState('3');
  const [javbusUrl, setJavbusUrl] = useState('');
  const [filmConc, setFilmConc] = useState('6');
  const [sampleConc, setSampleConc] = useState('6');
  const [imgTimeout, setImgTimeout] = useState('10');
  // 隐私总开关 + 子项
  const [privacyMode, setPrivacyMode] = useState(true);
  const [privacyCover, setPrivacyCover] = useState(true);
  const [privacyText, setPrivacyText] = useState(false);
  const [scrapeTitle, setScrapeTitle] = useState(true);
  const [scrapeMeta, setScrapeMeta] = useState(true);
  const [scrapeCover, setScrapeCover] = useState(true);
  const [scrapeSamples, setScrapeSamples] = useState(false);

  const flagOn = (v: string | undefined, def: boolean) => {
    if (v == null || v === '') return def;
    const s = String(v).toLowerCase();
    return !(s === '0' || s === 'false' || s === 'off');
  };

  useEffect(() => {
    mfl().settings.get().then((s: Record<string, string>) => {
      setSettings(s);
      setScanMaxDepth(s.scan_max_depth ?? '3');
      setJavbusUrl(s.javbus_base_url ?? '');
      setFilmConc(s.scrape_film_concurrency ?? '6');
      setSampleConc(s.scrape_sample_concurrency ?? '6');
      // 存的是毫秒，UI 用秒
      const ms = Number(s.scrape_image_timeout_ms ?? '10000');
      setImgTimeout(String(Number.isFinite(ms) ? Math.round(ms / 1000) : 10));
      setPrivacyMode(flagOn(s.privacy_mode, true));
      setPrivacyCover(flagOn(s.privacy_cover, true));
      setPrivacyText(flagOn(s.privacy_text, false));
      setScrapeTitle(flagOn(s.scrape_enable_title, true));
      setScrapeMeta(flagOn(s.scrape_enable_meta, true));
      setScrapeCover(flagOn(s.scrape_enable_cover, true));
      setScrapeSamples(flagOn(s.scrape_enable_samples, false));
    }).catch(() => {});
  }, []);

  const savePrivacyMaster = async (on: boolean) => {
    await mfl().settings.set('privacy_mode', on ? '1' : '0');
    setPrivacyMode(on);
    setSettings(s => ({ ...s, privacy_mode: on ? '1' : '0' }));
    toast.push({ text: on ? '已开启隐私模式' : '已关闭隐私模式', kind: 'success' });
  };

  const savePrivacyOptions = async () => {
    await mfl().settings.set('privacy_cover', privacyCover ? '1' : '0');
    await mfl().settings.set('privacy_text', privacyText ? '1' : '0');
    setSettings(s => ({
      ...s,
      privacy_cover: privacyCover ? '1' : '0',
      privacy_text: privacyText ? '1' : '0',
    }));
    toast.push({ text: '隐私选项已保存', kind: 'success' });
  };

  const setParentType = async (v: string) => {
    await mfl().settings.set('default_parent_type', v);
    setSettings(s => ({ ...s, default_parent_type: v }));
    toast.push({ text: '已保存', kind: 'success' });
  };

  const saveScanDepth = async () => {
    const depth = clampInt(scanMaxDepth, 1, 10, 3);
    await mfl().settings.set('scan_max_depth', String(depth));
    setScanMaxDepth(String(depth));
    setSettings(s => ({ ...s, scan_max_depth: String(depth) }));
    toast.push({ text: `扫描最大深度已保存：${depth} 层`, kind: 'success' });
  };

  const saveJavbus = async () => {
    const v = javbusUrl.trim().replace(/\/+$/, '');
    await mfl().settings.set('javbus_base_url', v);
    setSettings(s => ({ ...s, javbus_base_url: v }));
    setJavbusUrl(v);
    toast.push({ text: 'JavBus 地址已保存', kind: 'success' });
  };

  const saveScrapePerf = async () => {
    const fc = clampInt(filmConc, 1, 16, 6);
    const sc = clampInt(sampleConc, 1, 16, 6);
    const sec = clampInt(imgTimeout, 3, 60, 10);
    const ms = String(sec * 1000);
    await mfl().settings.set('scrape_film_concurrency', String(fc));
    await mfl().settings.set('scrape_sample_concurrency', String(sc));
    await mfl().settings.set('scrape_image_timeout_ms', ms);
    setFilmConc(String(fc));
    setSampleConc(String(sc));
    setImgTimeout(String(sec));
    setSettings(s => ({
      ...s,
      scrape_film_concurrency: String(fc),
      scrape_sample_concurrency: String(sc),
      scrape_image_timeout_ms: ms,
    }));
    toast.push({ text: `刮削性能已保存：影片并发 ${fc}，预览并发 ${sc}，超时 ${sec}s`, kind: 'success' });
  };

  const saveScrapeScope = async () => {
    const pairs: [string, boolean][] = [
      ['scrape_enable_title', scrapeTitle],
      ['scrape_enable_meta', scrapeMeta],
      ['scrape_enable_cover', scrapeCover],
      ['scrape_enable_samples', scrapeSamples],
    ];
    for (const [k, on] of pairs) {
      await mfl().settings.set(k, on ? '1' : '0');
    }
    setSettings(s => ({
      ...s,
      scrape_enable_title: scrapeTitle ? '1' : '0',
      scrape_enable_meta: scrapeMeta ? '1' : '0',
      scrape_enable_cover: scrapeCover ? '1' : '0',
      scrape_enable_samples: scrapeSamples ? '1' : '0',
    }));
    toast.push({ text: '刮削范围已保存', kind: 'success' });
  };

  return (
    <div>
      <h3>解析策略</h3>
      <label>
        无前缀父目录默认：
        <select value={settings.default_parent_type ?? 'actor'} onChange={e => setParentType(e.target.value)}>
          <option value="actor">演员</option>
          <option value="genre">题材</option>
        </select>
      </label>
      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'end', maxWidth: 360 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
          <span style={{ color: '#999' }}>扫描影片最大目录层级 (1–10)</span>
          <input
            type="number"
            min={1}
            max={10}
            value={scanMaxDepth}
            onChange={e => setScanMaxDepth(e.target.value)}
            style={{ width: 120, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }}
          />
        </label>
        <button type="button" onClick={() => void saveScanDepth()}>保存扫描设置</button>
      </div>
      <div style={{ color: '#666', fontSize: 11, marginTop: 4 }}>默认 3 层：扫描只登记路径、编号和文件清单；新编号随后自动刮削，失败时才按目录名兜底。</div>

      <h3 style={{ marginTop: 16 }}>隐私模式</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={privacyMode}
            onChange={e => void savePrivacyMaster(e.target.checked)}
          />
          <span>开启隐私模式（总开关，默认开）</span>
        </label>
        <div style={{
          marginLeft: 8, padding: 10, background: '#1e1e1e', borderRadius: 6, border: '1px solid #333',
          opacity: privacyMode ? 1 : 0.5,
        }}>
          <div style={{ color: '#aaa', fontSize: 12, marginBottom: 8 }}>子选项（仅总开关开启时生效）</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: privacyMode ? 'pointer' : 'not-allowed', fontSize: 13, marginBottom: 6 }}>
            <input
              type="checkbox"
              disabled={!privacyMode}
              checked={privacyCover}
              onChange={e => setPrivacyCover(e.target.checked)}
            />
            封面显示控制：开启后详情默认隐藏封面，需「单次显示」
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: privacyMode ? 'pointer' : 'not-allowed', fontSize: 13 }}>
            <input
              type="checkbox"
              disabled={!privacyMode}
              checked={privacyText}
              onChange={e => setPrivacyText(e.target.checked)}
            />
            文字显示控制：开启后列表/详情非编号文字模糊，按住查看
          </label>
          <button type="button" disabled={!privacyMode} onClick={() => void savePrivacyOptions()} style={{ marginTop: 10 }}>
            保存隐私子选项
          </button>
        </div>
        <span style={{ color: '#666', fontSize: 12 }}>
          编号始终清晰显示。关闭总开关时封面默认显示、文字不模糊。显示/隐藏封面按钮 UI 不变。
        </span>
      </div>

      <h3 style={{ marginTop: 16 }}>JavBus 刮削</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 560 }}>
        <span style={{ color: '#999', fontSize: 12 }}>站点根地址（无尾部斜杠）。番号页路径为：根地址/番号，例如 https://www.javbus.com/SSIS-100</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={javbusUrl}
            onChange={e => setJavbusUrl(e.target.value)}
            placeholder="https://www.javbus.com"
            style={{ flex: 1, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }}
          />
          <button onClick={saveJavbus}>保存</button>
        </div>

        <div style={{ marginTop: 8, padding: 10, background: '#1e1e1e', borderRadius: 6, border: '1px solid #333' }}>
          <div style={{ color: '#ccc', fontSize: 13, marginBottom: 8 }}>刮削范围（精细控制）</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={scrapeTitle} onChange={e => setScrapeTitle(e.target.checked)} />
              标题
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={scrapeMeta} onChange={e => setScrapeMeta(e.target.checked)} />
              影片信息（演员 / 题材 / 备注 / 发行信息）
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={scrapeCover} onChange={e => setScrapeCover(e.target.checked)} />
              封面（bigImage）
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={scrapeSamples} onChange={e => setScrapeSamples(e.target.checked)} />
              样图 sample-box（默认关闭，DMM 图床常超时）
            </label>
          </div>
          <button type="button" onClick={() => void saveScrapeScope()} style={{ marginTop: 8 }}>保存刮削范围</button>
          <div style={{ color: '#666', fontSize: 11, marginTop: 6 }}>
            关闭样图可明显提速。批量刮削会自动跳过已标记「已刮削」的影片。
          </div>
        </div>

        <div style={{ marginTop: 8, padding: 10, background: '#1e1e1e', borderRadius: 6, border: '1px solid #333' }}>
          <div style={{ color: '#ccc', fontSize: 13, marginBottom: 8 }}>批量 / 性能（对比 Python 脚本可适当调高）</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
              <span style={{ color: '#999' }}>影片并发 (1–16)</span>
              <input value={filmConc} onChange={e => setFilmConc(e.target.value)} type="number" min={1} max={16}
                style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
              <span style={{ color: '#999' }}>预览图并发 (1–16)</span>
              <input value={sampleConc} onChange={e => setSampleConc(e.target.value)} type="number" min={1} max={16}
                style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
              <span style={{ color: '#999' }}>单图超时 (秒)</span>
              <input value={imgTimeout} onChange={e => setImgTimeout(e.target.value)} type="number" min={3} max={60}
                style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }} />
            </label>
            <button onClick={saveScrapePerf}>保存性能</button>
          </div>
          <div style={{ color: '#666', fontSize: 11, marginTop: 6 }}>
            默认影片并发 6、预览并发 6。过高可能触发限流或代理拥堵；超时图会跳过并写日志。改后下次批量任务生效。
          </div>
        </div>

        <span style={{ color: '#666', fontSize: 11 }}>目录里已有同名图片不会覆盖。预览图超时会跳过并写日志。</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => mfl().scrape.openLogDir().then((r: any) => {
            if (r.ok) toast.push({ text: `已打开日志目录\n${r.path}`, kind: 'success' });
            else toast.push({ text: r.error || '无法打开日志目录', kind: 'error' });
          }).catch((e: unknown) => toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' }))}>
            打开日志目录
          </button>
          <button onClick={() => mfl().scrape.getLogPath().then((r: any) => {
            toast.push({ text: `当前日志: ${r.file || '（尚未写入）'}\n目录: ${r.dir || '—'}`, kind: 'success' });
          }).catch((e: unknown) => toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' }))}>
            显示日志路径
          </button>
        </div>
      </div>

      <h3 style={{ marginTop: 16 }}>备份</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => mfl().export.sqlite().then((r: any) => r.ok && toast.push({ text: '已导出 SQLite', kind: 'success' }))}>导出 SQLite 整库</button>
        <button onClick={() => mfl().export.importSqlite().then((r: any) => r.ok && toast.push({ text: '已导入（旧库已备份）', kind: 'success' }))}>从 SQLite 导入</button>
      </div>
    </div>
  );
}
