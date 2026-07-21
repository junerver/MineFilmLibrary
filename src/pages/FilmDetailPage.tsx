import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { FilmDetail, FilmFileRow } from '../api/types';
import CoverGuard from '../components/CoverGuard';
import { useToast } from '../components/Toaster';

const mfl = (): any => (window as any).mfl;

export default function FilmDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [film, setFilm] = useState<FilmDetail | null>(null);
  const [files, setFiles] = useState<FilmFileRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (!id) return;
    const n = Number(id);
    mfl().library.get(n).then((f: FilmDetail | null) => {
      if (f) {
        setFilm(f);
        setForm({
          code: f.code ?? '',
          title: f.title ?? '',
          locale: f.locale ?? '',
          notes: f.notes ?? '',
          tags: f.tags.join(', '),
          parent_dir_name: f.parent_dir_name,
        });
      }
    }).catch((e: unknown) => toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' }));
    mfl().files.listByFilm(n).then((r: FilmFileRow[]) => setFiles(r)).catch((e: unknown) => toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' }));
  }, [id, toast]);

  if (!film) return <div>加载中…</div>;

  const save = async () => {
    const patch: any = {
      code: form.code || null,
      title: form.title || null,
      locale: form.locale || null,
      notes: form.notes || null,
      parent_dir_name: form.parent_dir_name,
      tags: (form.tags as string).split(',').map((s: string) => s.trim()).filter(Boolean),
    };
    try {
      await mfl().library.update(film.id, patch);
      toast.push({ text: '已保存', kind: 'success' });
      setEditing(false);
      setFilm({ ...film, ...patch, tags: patch.tags });
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    }
  };

  const softDelete = async () => {
    if (!confirm('软删除？')) return;
    try {
      await mfl().library.softDelete(film.id);
      nav('/library');
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    }
  };

  const restat = async () => {
    try {
      await mfl().files.restat(film.id);
      const r = await mfl().files.listByFilm(film.id);
      setFiles(r);
      toast.push({ text: '已重新枚举文件', kind: 'success' });
    } catch (e: unknown) {
      toast.push({ text: String((e as Error)?.message ?? e), kind: 'error' });
    }
  };

  return (
    <div>
      <button onClick={() => nav('/library')}>返回</button>
      <h2>{film.code} {film.title}</h2>
      <div style={{ display: 'flex', gap: 16 }}>
        <CoverGuard filmId={film.id} />
        <div style={{ flex: 1 }}>
          {!editing ? (
            <>
              <Row k="编号" v={film.code} />
              <Row k="后缀" v={film.locale} />
              <Row k="标签" v={film.tags.join(', ')} />
              <Row k="演员" v={film.actors.map(a => a.name).join(', ')} />
              <Row k="题材" v={film.genres.map(g => g.name).join(', ')} />
              <Row k="父目录" v={film.parent_dir_name} />
              <Row k="路径" v={film.abs_path} />
              <Row k="备注" v={film.notes} />
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button onClick={() => setEditing(true)}>编辑</button>
                <button onClick={() => void mfl().files.openInFolder(film.id)}>打开文件夹</button>
                <button onClick={softDelete}>软删除</button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input value={form.code ?? ''} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="编号" />
              <input value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="标题" />
              <input value={form.locale ?? ''} onChange={e => setForm({ ...form, locale: e.target.value })} placeholder="C / U" />
              <input value={form.tags ?? ''} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="标签逗号分隔" />
              <input value={form.parent_dir_name ?? ''} onChange={e => setForm({ ...form, parent_dir_name: e.target.value })} placeholder="父目录" />
              <textarea value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="备注" />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={save}>保存</button>
                <button onClick={() => setEditing(false)}>取消</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <h3 style={{ marginTop: 16 }}>文件</h3>
      <table style={{ width: '100%', fontSize: 12 }}>
        <thead><tr><th>名称</th><th>类型</th><th>体积</th><th>修改时间</th></tr></thead>
        <tbody>
          {files.map(f => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.is_video ? '视频' : (f.is_image ? '图片' : f.ext)}</td>
              <td>{(f.size / 1024 / 1024).toFixed(1)} MB</td>
              <td>{new Date(f.mtime_ms).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={restat} style={{ marginTop: 8 }}>重新枚举</button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return <div><span style={{ color: '#999', marginRight: 8 }}>{k}:</span>{v ?? '—'}</div>;
}
