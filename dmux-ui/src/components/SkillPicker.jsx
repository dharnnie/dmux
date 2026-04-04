import { useState, useEffect } from 'react';
import styles from './SkillPicker.module.css';

export default function SkillPicker({ projectName, onApplied }) {
  const [skills, setSkills] = useState([]);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(null);

  useEffect(() => {
    fetch('/api/skills')
      .then((r) => r.json())
      .then(setSkills)
      .catch(() => {});
  }, []);

  const handleApply = (skill) => {
    setApplying(skill.name);
    fetch(`/api/projects/${projectName}/skills/${skill.name}`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        setApplying(null);
        setOpen(false);
        if (data.ok && onApplied) onApplied(skill.name);
      })
      .catch(() => setApplying(null));
  };

  const handleApplyAndStart = (skill) => {
    setApplying(skill.name);
    fetch(`/api/projects/${projectName}/skills/${skill.name}`, { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setApplying(null);
          return;
        }
        // Now start the agents
        return fetch(`/api/projects/${projectName}/agents/start`, { method: 'POST' })
          .then((r) => r.json())
          .then((startData) => {
            setApplying(null);
            setOpen(false);
            if (onApplied) onApplied(skill.name, true);
          });
      })
      .catch(() => setApplying(null));
  };

  if (skills.length === 0) return null;

  return (
    <div className={styles.wrapper}>
      <button className={styles.trigger} onClick={() => setOpen(!open)}>
        Use Skill
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.dropdownHeader}>Pick a skill to run on this project</div>
          {skills.map((s) => (
            <div key={s.name} className={styles.item}>
              <div className={styles.itemInfo}>
                <span className={styles.itemName}>{s.name}</span>
                <span className={styles.itemDesc}>{s.description}</span>
              </div>
              <div className={styles.itemActions}>
                <button
                  className={styles.applyBtn}
                  onClick={() => handleApply(s)}
                  disabled={applying !== null}
                >
                  {applying === s.name ? '...' : 'Generate'}
                </button>
                <button
                  className={styles.runBtn}
                  onClick={() => handleApplyAndStart(s)}
                  disabled={applying !== null}
                >
                  {applying === s.name ? '...' : 'Run'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
