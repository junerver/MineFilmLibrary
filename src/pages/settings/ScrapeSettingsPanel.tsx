import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toaster';
import { clampInt, flagOn, mfl } from './settingsHelpers';

export default function ScrapeSettingsPanel() {
  const toast = useToast();
  const [javbusUrl, setJavbusUrl] = useState('');
  const [filmConc, setFilmConc] = useState('6');
  const [sampleConc, setSampleConc] = useState('6');
  const [imgTimeout, setImgTimeout] = useState('10');
  const [scrapeTitle, setScrapeTitle] = useState(true);
  const [scrapeMeta, setScrapeMeta] = useState(true);
  const [scrapeCover, setScrapeCover] = useState(true);
  const [scrapeSamples, setScrapeSamples] = useState(false);

  useEffect(() => {
    mfl().settings.get().then((s: Record<string, string>) => {
      setJavbusUrl(s.javbus_base_url ?? '');
      setFilmConc(s.scrape_film_concurrency ?? '6');
      setSampleConc(s.scrape_sample_concurrency ?? '6');
      const ms = Number(s.scrape_image_timeout_ms ?? '10000');
      setImgTimeout(String(Number.isFinite(ms) ? Math.round(ms / 1000) : 10));
      setScrapeTitle(flagOn(s.scrape_enable_title, true));
      setScrapeMeta(flagOn(s.scrape_enable_meta, true));
      setScrapeCover(flagOn(s.scrape_enable_cover, true));
      setScrapeSamples(flagOn(s.scrape_enable_samples, false));
    }).catch(() => {});
  }, []);

  const saveJavbus = async () => {
    const v = javbusUrl.trim().replace(/\/+$/, '');
    await mfl().settings.set('javbus_base_url', v);
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
    toast.push({ text: '刮削范围已保存', kind: 'success' });
  };

  return (
    <div>
      <h3>JavBus 刮削</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 560 }}>
        <span style={{ color: '#999', fontSize: 12 }}>
          站点根地址（无尾部斜杠）。番号页路径为：根地址/番号，例如 https://www.javbus.com/SSIS-100
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={javbusUrl}
            onChange={e => setJavbusUrl(e.target.value)}
            placeholder="https://www.javbus.com"
            style={{ flex: 1, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }}
          />
          <button type="button" onClick={() => void saveJavbus()}>保存</button>
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
              <input
                value={filmConc}
                onChange={e => setFilmConc(e.target.value)}
                type="number"
                min={1}
                max={16}
                style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
              <span style={{ color: '#999' }}>预览图并发 (1–16)</span>
              <input
                value={sampleConc}
                onChange={e => setSampleConc(e.target.value)}
                type="number"
                min={1}
                max={16}
                style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
              <span style={{ color: '#999' }}>单图超时 (秒)</span>
              <input
                value={imgTimeout}
                onChange={e => setImgTimeout(e.target.value)}
                type="number"
                min={3}
                max={60}
                style={{ background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, padding: 6 }}
              />
            </label>
            <button type="button" onClick={() => void saveScrapePerf()}>保存性能</button>
          </div>
          <div style={{ color: '#666', fontSize: 11, marginTop: 6 }}>
            默认影片并发 6、预览并发 6。过高可能触发限流或代理拥堵；超时图会跳过并写日志。改后下次批量任务生效。
          </div>
        </div>

        <span style={{ color: '#666', fontSize: 11 }}>目录里已有同名图片不会覆盖。预览图超时会跳过并写日志。</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => mfl().scrape.openLogDir().then((r: any) => {
              if (r.ok) toast.push({ text: `已打开日志目录\n${r.path}`, kind: 'success' });
              else toast.push({ text: r.error || '无法打开日志目录', kind: 'error' });
            }).catch((e: unknown) => toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' }))}
          >
            打开日志目录
          </button>
          <button
            type="button"
            onClick={() => mfl().scrape.getLogPath().then((r: any) => {
              toast.push({ text: `当前日志: ${r.file || '（尚未写入）'}\n目录: ${r.dir || '—'}`, kind: 'success' });
            }).catch((e: unknown) => toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' }))}
          >
            显示日志路径
          </button>
        </div>
      </div>
    </div>
  );
}
