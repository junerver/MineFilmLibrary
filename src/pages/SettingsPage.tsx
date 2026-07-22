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
  const [javbusUrl, setJavbusUrl] = useState('');
  const [filmConc, setFilmConc] = useState('6');
  const [sampleConc, setSampleConc] = useState('6');
  const [imgTimeout, setImgTimeout] = useState('10');

  useEffect(() => {
    mfl().settings.get().then((s: Record<string, string>) => {
      setSettings(s);
      setJavbusUrl(s.javbus_base_url ?? '');
      setFilmConc(s.scrape_film_concurrency ?? '6');
      setSampleConc(s.scrape_sample_concurrency ?? '6');
      // 存的是毫秒，UI 用秒
      const ms = Number(s.scrape_image_timeout_ms ?? '10000');
      setImgTimeout(String(Number.isFinite(ms) ? Math.round(ms / 1000) : 10));
    }).catch(() => {});
  }, []);

  const setParentType = async (v: string) => {
    await mfl().settings.set('default_parent_type', v);
    setSettings(s => ({ ...s, default_parent_type: v }));
    toast.push({ text: '已保存', kind: 'success' });
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
