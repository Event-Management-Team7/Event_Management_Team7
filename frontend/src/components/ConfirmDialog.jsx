import { useEffect, useId, useRef } from 'react';

// Modal confirmation built on the native <dialog>: it traps focus, closes on Esc and returns
// focus to the button that opened it. The safe option comes first so it receives focus.
export default function ConfirmDialog({ title, message, confirmLabel, dismissLabel = 'Go back', onConfirm, onClose }) {
  const ref = useRef(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === ref.current) onClose(); }}
    >
      <h3 id={titleId}>{title}</h3>
      <p id={messageId}>{message}</p>
      <div className="dialog-actions">
        <button type="button" className="outline" onClick={onClose}>{dismissLabel}</button>
        <button type="button" className="danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
