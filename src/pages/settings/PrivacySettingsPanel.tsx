import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toaster';
import { flagOn, mfl } from './settingsHelpers';

export default function PrivacySettingsPanel() {
  const toast = useToast();
  const [privacyMode, setPrivacyMode] = useState(true);
  const [privacyCover, setPrivacyCover] = useState(true);
  const [privacyText, setPrivacyText] = useState(false);

  useEffect(() => {
    mfl().settings.get().then((s: Record<string, string>) => {
      setPrivacyMode(flagOn(s.privacy_mode, true));
      setPrivacyCover(flagOn(s.privacy_cover, true));
      setPrivacyText(flagOn(s.privacy_text, false));
    }).catch(() => {});
  }, []);

  const savePrivacyMaster = async (on: boolean) => {
    await mfl().settings.set('privacy_mode', on ? '1' : '0');
    setPrivacyMode(on);
    toast.push({ text: on ? '已开启隐私模式' : '已关闭隐私模式', kind: 'success' });
  };

  const savePrivacyOptions = async () => {
    await mfl().settings.set('privacy_cover', privacyCover ? '1' : '0');
    await mfl().settings.set('privacy_text', privacyText ? '1' : '0');
    toast.push({ text: '隐私选项已保存', kind: 'success' });
  };

  return (
    <div>
      <h3>隐私模式</h3>
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
    </div>
  );
}
