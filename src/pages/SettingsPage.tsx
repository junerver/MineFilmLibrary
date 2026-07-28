import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import DataSettingsPanel from './settings/DataSettingsPanel';
import PrivacySettingsPanel from './settings/PrivacySettingsPanel';
import ScanSettingsPanel from './settings/ScanSettingsPanel';
import ScrapeSettingsPanel from './settings/ScrapeSettingsPanel';
import { SettingsTabButton } from './settings/SettingsTabButton';
import TrashSettingsPanel from './settings/TrashSettingsPanel';

export type SettingsTabId = 'scan' | 'trash' | 'privacy' | 'scrape' | 'data';

const TABS: { id: SettingsTabId; label: string }[] = [
  { id: 'scan', label: '扫描' },
  { id: 'trash', label: '回收站' },
  { id: 'privacy', label: '隐私' },
  { id: 'scrape', label: '刮削' },
  { id: 'data', label: '数据' },
];

function parseTab(raw: string | null): SettingsTabId {
  if (raw === 'trash' || raw === 'privacy' || raw === 'scrape' || raw === 'data' || raw === 'scan') {
    return raw;
  }
  return 'scan';
}

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = useMemo(() => parseTab(searchParams.get('tab')), [searchParams]);

  const setTab = (id: SettingsTabId) => {
    setSearchParams(id === 'scan' ? {} : { tab: id }, { replace: true });
  };

  return (
    <div>
      <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 600 }}>设置</h2>
      <div
        role="tablist"
        aria-label="设置分区"
        style={{ display: 'flex', gap: 2, borderBottom: '1px solid #3a3a3a', marginBottom: 12, flexWrap: 'wrap' }}
      >
        {TABS.map(t => (
          <SettingsTabButton key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </SettingsTabButton>
        ))}
      </div>

      <div role="tabpanel" aria-label={TABS.find(t => t.id === tab)?.label ?? '设置'}>
        {tab === 'scan' && <ScanSettingsPanel />}
        {tab === 'trash' && <TrashSettingsPanel />}
        {tab === 'privacy' && <PrivacySettingsPanel />}
        {tab === 'scrape' && <ScrapeSettingsPanel />}
        {tab === 'data' && <DataSettingsPanel />}
      </div>
    </div>
  );
}
