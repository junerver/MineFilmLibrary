import { useEffect, useState } from 'react';
import type { FilmRow } from '../api/types';

const mfl = (): any => (window as any).mfl;

export default function TrashPage() {
  const [rows, setRows] = useState<FilmRow[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    mfl().library.list({ page: 1, page_size: 500, include_deleted: true })
      .then((r: any) => setRows(r.items.filter((x: FilmRow) => x.is_deleted)))
      .catch(() => {});
  }, [tick]);

  return (
    <div>
      <h3>回收站</h3>
      <table style={{ width: '100%', fontSize: 12 }}>
        <thead><tr><th>编号</th><th>标题</th><th>操作</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.code ? r.code.toUpperCase() : ''}</td>
              <td>{r.title ?? ''}</td>
              <td style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => { mfl().library.restore(r.id).then(() => setTick(t => t + 1)); }}>恢复</button>
                <button onClick={() => { if (confirm('彻底删除？')) mfl().library.hardDelete(r.id).then(() => setTick(t => t + 1)); }}>彻底删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
