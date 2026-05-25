import { useState } from 'react';
import Card, { CardTitle } from './Card';
import Button from './Button';
import { useToast } from './Toasts';
import styles from './RecommendedSkillsCard.module.css';

/**
 * RecommendedSkillsCard — Wave 2D Slice 2.
 *
 * Renders the list of skills discovery thought would help this project,
 * each with a one-sentence reason grounded in repo evidence. Per-skill
 * install button calls the existing POST /api/skills/:name/install endpoint
 * from Wave 1.
 *
 * The `installed` flag on each recommendation reflects the catalogue at
 * adoption time. Local state tracks newly-installed skills in this session
 * so the UI updates immediately after a successful install.
 *
 * Props:
 *   recommendations: [{ name, reason, installed }]
 *   onDismiss: () => void  // hides the card entirely for this proposal
 */
export default function RecommendedSkillsCard({ recommendations, onDismiss }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);          // name of skill being installed
  const [installed, setInstalled] = useState(() => new Set(
    recommendations.filter((r) => r.installed).map((r) => r.name),
  ));

  if (!recommendations || recommendations.length === 0) return null;

  const handleInstall = async (name) => {
    setBusy(name);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}/install`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      setInstalled((prev) => new Set(prev).add(name));
      toast(`Installed ${name}.`, 'success');
    } catch (e) {
      toast(`Couldn't install ${name}: ${e.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card header={<CardTitle>Recommended skills</CardTitle>}>
      <p className={styles.hint}>
        Based on what discovery saw, these skills will sharpen future runs on this project.
      </p>

      <ul className={styles.list}>
        {recommendations.map((rec) => {
          const isInstalled = installed.has(rec.name);
          return (
            <li key={rec.name} className={styles.item}>
              <div className={styles.itemBody}>
                <div className={styles.itemHeader}>
                  <code className={styles.itemName}>{rec.name}</code>
                  {isInstalled && <span className={styles.installedBadge}>✓ installed</span>}
                </div>
                <p className={styles.itemReason}>{rec.reason}</p>
              </div>
              {!isInstalled && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleInstall(rec.name)}
                  loading={busy === rec.name}
                  disabled={busy !== null}
                >
                  Install
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {onDismiss && (
        <div className={styles.dismissRow}>
          <button type="button" className={styles.dismissBtn} onClick={onDismiss}>
            Skip — I'll install later
          </button>
        </div>
      )}
    </Card>
  );
}
