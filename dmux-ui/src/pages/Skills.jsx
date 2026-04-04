import { useState, useEffect } from 'react';
import { useToast } from '../components/Toasts';
import styles from './Skills.module.css';

export default function Skills() {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

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
          <p>No skills found.</p>
          <p className={styles.emptyHint}>Skills ship with dmux. Try reinstalling or check your installation.</p>
        </div>
      )}

      <div className={styles.cliHint}>
        <span>CLI:</span>
        <code>dmux skills list</code>
        <code>dmux skills install security-audit</code>
        <code>dmux skills run security-audit myproject</code>
      </div>
    </div>
  );
}
