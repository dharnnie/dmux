import styles from './YamlPreview.module.css';

export default function YamlPreview({ yaml }) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>YAML Preview</div>
      <div className={styles.content}>
        {yaml ? (
          <pre className={styles.pre}>{yaml}</pre>
        ) : (
          <div className={styles.empty}>Configure agents to see the YAML output</div>
        )}
      </div>
    </div>
  );
}
