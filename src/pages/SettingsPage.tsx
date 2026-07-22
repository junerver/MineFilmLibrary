import { useEffect, useState } from 'react';
import { useToast } from '../components/Toaster';

const mfl = (): any => (window as any).mfl;

export default function SettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});

  useEffect(() => {
    mfl().settings.get().then(setSettings).catch(() => {});
  }, []);

  const setParentType = async (v: string) => {
    await mfl().settings.set('default_parent_type', v);
    setSettings(s => ({ ...s, default_parent_type: v }));
    toast.push({ text: '已保存', kind: 'success' });
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
      <h3 style={{ marginTop: 16 }}>备份</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => mfl().export.sqlite().then((r: any) => r.ok && toast.push({ text: '已导出 SQLite', kind: 'success' }))}>导出 SQLite 整库</button>
        <button onClick={() => mfl().export.importSqlite().then((r: any) => r.ok && toast.push({ text: '已导入（旧库已备份）', kind: 'success' }))}>从 SQLite 导入</button>
      </div>
    </div>
  );
}
