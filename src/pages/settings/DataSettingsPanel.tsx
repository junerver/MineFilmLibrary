import { useToast } from '../../components/Toaster';
import { mfl } from './settingsHelpers';

export default function DataSettingsPanel() {
  const toast = useToast();

  return (
    <div>
      <h3>备份</h3>
      <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
        导出/导入 SQLite 整库。导入前会自动备份当前库。
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => mfl().export.sqlite().then((r: any) => r.ok && toast.push({ text: '已导出 SQLite', kind: 'success' }))}
        >
          导出 SQLite 整库
        </button>
        <button
          type="button"
          onClick={() => mfl().export.importSqlite().then((r: any) => r.ok && toast.push({ text: '已导入（旧库已备份）', kind: 'success' }))}
        >
          从 SQLite 导入
        </button>
      </div>
    </div>
  );
}
