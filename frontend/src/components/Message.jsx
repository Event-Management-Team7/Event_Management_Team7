export default function Message({ message, kind = 'info', onClose }) {
  if (!message) return null;
  return (
    <div className={`message ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{message}</span>
      {onClose && <button type="button" aria-label="Dismiss message" onClick={onClose}>×</button>}
    </div>
  );
}
