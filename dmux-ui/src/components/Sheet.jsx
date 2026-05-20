import { useEffect, useId, useRef } from 'react';
import Button from './Button';
import styles from './Sheet.module.css';

/**
 * Sheet — Section 3 / Section 5 primitive.
 *
 * Wraps the native <dialog> element. Choosing <dialog> over a hand-rolled
 * div with role=dialog gets us focus trap, aria-modal, ESC handling, and
 * background scroll-locking from the platform for free.
 *
 * Variants:
 *   dialog — centered modal for short forms / confirmations (default).
 *   sheet  — slides in from the right; reserved for the future spawn flow
 *            and adopt wizard (not exercised in this PR).
 *
 * Props:
 *   open: boolean            — controls visibility
 *   onClose: () => void      — fires on ESC, close button, or backdrop click
 *   title: ReactNode         — required; rendered as the dialog's accessible
 *                              name via aria-labelledby
 *   children                 — body content
 *   footer: ReactNode        — typically <Button>Cancel</Button> + primary
 *   dismissOnBackdrop        — default true; pass false for destructive flows
 *                              where misclicks must not be a way out
 *   variant: 'dialog'|'sheet'
 */
export default function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  dismissOnBackdrop = true,
  variant = 'dialog',
}) {
  const dialogRef = useRef(null);
  const titleId = useId();

  // showModal/close manage the open state of the native <dialog>. We never
  // toggle the `open` attribute directly — that gives non-modal behavior.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // ESC triggers the dialog's "cancel" event; native close runs after.
  // We surface both as a single onClose to the caller.
  const handleClose = () => onClose?.();

  const handleBackdropClick = (e) => {
    // The native <dialog> backdrop is rendered as part of the dialog element
    // itself, so clicks on the dialog (but not on its inner content) signal
    // a backdrop click.
    if (!dismissOnBackdrop) return;
    if (e.target === dialogRef.current) onClose?.();
  };

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles[`variant_${variant}`]}`}
      onClose={handleClose}
      onCancel={handleClose}
      onClick={handleBackdropClick}
      aria-labelledby={titleId}
    >
      <div className={styles.frame} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>{title}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Close"
            onClick={() => onClose?.()}
          >
            ✕
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </dialog>
  );
}

/**
 * ConfirmDialog — convenience wrapper for the most common Sheet pattern.
 * Renders a title + message + Cancel + confirm button. Pass
 * confirmVariant="danger" for destructive confirmations (red outlined
 * confirm button).
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  busy = false,
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      dismissOnBackdrop={confirmVariant !== 'danger'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {typeof message === 'string' ? <p>{message}</p> : message}
    </Sheet>
  );
}
