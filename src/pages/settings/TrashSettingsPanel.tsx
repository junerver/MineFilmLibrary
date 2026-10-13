import { useEffect, useState } from 'react';
import type { FilmRow } from '../../api/types';
import { useConfirm } from '../../components/ConfirmDialog';
import { mfl } from './settingsHelpers';

/** 软删除影片列表：恢复 / 彻底删除。 */
export default function TrashSettingsPanel() {
  const [rows, setRows] = useState<FilmRow[]>([]);
  const [tick, setTick] = useState(0);
  // 原生 confirm 在 Electron/Windows 下破坏输入焦点，统一换应用内确认弹窗
  const confirm = useConfirm();

  useEffect(() => {
    mfl().library.list({ page: 1, page_size: 500, include_deleted: true })
      .then((r: any) => setRows(r.items.filter((x: FilmRow) => x.is_deleted)))
      .catch(() => {});
  }, [tick]);

  return (
    <div>
      <h3>回收站</h3>
      <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
        软删除的影片会出现在此。恢复后回到影片库；彻底删除仅移除库记录，不会删除磁盘文件。
      </div>
      {rows.length === 0 ? (
        <div style={{ color: '#666', fontSize: 13 }}>回收站为空</div>
      ) : (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '4px 6px' }}>编号</th>
              <th style={{ padding: '4px 6px' }}>标题</th>
              <th style={{ padding: '4px 6px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '4px 6px' }}>{r.code ? r.code.toUpperCase() : ''}</td>
                <td style={{ padding: '4px 6px' }}>{r.title ?? ''}</td>
                <td style={{ padding: '4px 6px', display: 'flex', gap: 4 }}>
                  <button type="button" onClick={() => { void mfl().library.restore(r.id).then(() => setTick(t => t + 1)); }}>
                    恢复
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!(await confirm({ title: '彻底删除', message: '彻底删除该影片的库记录？', confirmText: '彻底删除', danger: true }))) return;
                      void mfl().library.hardDelete(r.id).then(() => setTick(t => t + 1));
                    }}
                  >
                    彻底删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
