import { useState, useEffect } from 'react';
import { useToast } from '../components/Toasts';
import useSkillsCatalogue from '../hooks/useSkillsCatalogue';
import styles from './Skills.module.css';

export default function Skills() {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installingFromCatalogue, setInstallingFromCatalogue] = useState(null);
  const toast = useToast();
  const cat = useSkillsCatalogue();

  const fetchSkills = () => {
    fetch('/api/skills')
      .then((r) => r.json())
      .then((data) => {
        setSkills(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  const handleInstall = (name) => {
    toast(`Installing ${name}...`, 'info');
    fetch(`/api/skills/${name}/install`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          toast(data.message || `Installed ${name}`, 'success');
          fetchSkills();
        } else {
          toast(data.message || 'Install failed', 'error');
        }
      })
      .catch((e) => toast(e.message, 'error'));
  };

  const handleInstallFromCatalogue = async (name) => {
    if (installingFromCatalogue) return;
    setInstallingFromCatalogue(name);
    toast(`Installing ${name} from catalogue…`, 'info');
    try {
      const res = await fetch('/api/skills/install-from-catalogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast(`Installed ${name} from catalogue.`, 'success');
      fetchSkills();  // refresh the local-installed list so the badge flips
    } catch (e) {
      toast(`Couldn't install ${name}: ${e.message}`, 'error');
    } finally {
      setInstallingFromCatalogue(null);
    }
  };

  const handleRemove = (name) => {
    toast(`Removing ${name}...`, 'info');
    fetch(`/api/skills/${name}`, { method: 'DELETE' })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          toast(data.message || `Removed ${name}`, 'success');
          fetchSkills();
        } else {
          toast(data.message || 'Remove failed', 'error');
        }
      })
      .catch((e) => toast(e.message, 'error'));
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Skills</h1>
        <p className={styles.loading}>Loading...</p>
      </div>
    );
  }

  const installed = skills.filter((s) => s.installed);
  const available = skills.filter((s) => !s.installed);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Skills</h1>
          <p className={styles.subtitle}>Reusable agent workflows you can install into any project</p>
        </div>
      </div>

      {installed.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Installed</h2>
          <div className={styles.grid}>
            {installed.map((s) => (
              <div key={s.name} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.cardName}>{s.name}</span>
                  <span className={styles.installedBadge}>installed</span>
                </div>
                <p className={styles.cardDesc}>{s.description}</p>
                {s.tags.length > 0 && (
                  <div className={styles.tags}>
                    {s.tags.map((t) => (
                      <span key={t} className={styles.tag}>{t}</span>
                    ))}
                  </div>
                )}
                <div className={styles.cardActions}>
                  <span className={styles.provider}>{s.provider}</span>
                  <button
                    className={styles.removeBtn}
                    onClick={() => handleRemove(s.name)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {available.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Available</h2>
          <div className={styles.grid}>
            {available.map((s) => (
              <div key={s.name} className={`${styles.card} ${styles.cardAvailable}`}>
                <div className={styles.cardTop}>
                  <span className={styles.cardName}>{s.name}</span>
                </div>
                <p className={styles.cardDesc}>{s.description}</p>
                {s.tags.length > 0 && (
                  <div className={styles.tags}>
                    {s.tags.map((t) => (
                      <span key={t} className={styles.tag}>{t}</span>
                    ))}
                  </div>
                )}
                <div className={styles.cardActions}>
                  <span className={styles.provider}>{s.provider}</span>
                  <button
                    className={styles.installBtn}
                    onClick={() => handleInstall(s.name)}
                  >
                    Install
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {skills.length === 0 && (
        <div className={styles.empty}>
          <p>Built-in skills are missing.</p>
          <p className={styles.emptyHint}>
            Skills ship bundled with dmux. Reinstall dmux to restore them.
          </p>
        </div>
      )}

      {/* Wave 3F: remote catalogue section. Rendered after the built-in
          sections; refresh button + last-fetched timestamp inline with
          the section header. */}
      <section className={styles.section}>
        <div className={styles.catalogueHeader}>
          <h2 className={styles.sectionTitle}>From catalogue</h2>
          <div className={styles.catalogueMeta}>
            {cat.ready && (
              <span className={styles.fetchedAt}>
                {cat.fetchedAt
                  ? `last refreshed ${formatRelative(cat.fetchedAt)}`
                  : 'never refreshed'}
              </span>
            )}
            <button
              className={styles.refreshBtn}
              onClick={cat.refresh}
              disabled={cat.refreshing}
            >
              {cat.refreshing ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {cat.warning && (
          <div className={styles.catalogueWarning}>
            {cat.warning}
          </div>
        )}

        {!cat.ready ? (
          <p className={styles.loading}>Loading catalogue…</p>
        ) : cat.catalogue.skills.length === 0 ? (
          <div className={styles.empty}>
            <p>No skills in the catalogue yet.</p>
            <p className={styles.emptyHint}>
              {cat.url ? <>Pointing at <code>{cat.url}</code>. </> : null}
              The catalogue may not exist yet — see <code>docs/skills-catalogue.md</code> for how to set one up.
            </p>
          </div>
        ) : (
          <div className={styles.grid}>
            {cat.catalogue.skills.map((s) => {
              const isInstalled = installed.some((i) => i.name === s.name);
              const isBusy = installingFromCatalogue === s.name;
              return (
                <div key={s.name} className={`${styles.card} ${styles.cardAvailable}`}>
                  <div className={styles.cardTop}>
                    <span className={styles.cardName}>{s.name}</span>
                    {s.author && <span className={styles.cardAuthor}>by {s.author}</span>}
                  </div>
                  <p className={styles.cardDesc}>{s.description}</p>
                  {s.tags.length > 0 && (
                    <div className={styles.tags}>
                      {s.tags.map((t) => (
                        <span key={t} className={styles.tag}>{t}</span>
                      ))}
                    </div>
                  )}
                  <div className={styles.cardActions}>
                    <span className={styles.provider} />
                    {isInstalled ? (
                      <span className={styles.installedBadge}>✓ installed</span>
                    ) : (
                      <button
                        className={styles.installBtn}
                        onClick={() => handleInstallFromCatalogue(s.name)}
                        disabled={isBusy || installingFromCatalogue !== null}
                      >
                        {isBusy ? 'Installing…' : 'Install'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function formatRelative(iso) {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const ms = Date.now() - then;
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} hours ago`;
  return `${Math.round(ms / 86_400_000)} days ago`;
}
