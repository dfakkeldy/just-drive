/** The simple remembered drawing switches. Initial state stays with each renderer's URL/storage policy. */
export function toggle(key: string, text: string, initial: boolean, onChange: (on: boolean) => void): HTMLInputElement | null {
  const panel = document.getElementById('settings');
  if (!panel) return null;
  const label = document.createElement('label');
  label.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:12px';
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: initial });
  box.style.width = 'auto';
  box.addEventListener('change', () => {
    onChange(box.checked);
    try { localStorage.setItem(`mmm.${key}`, box.checked ? '1' : '0'); } catch { /* private mode */ }
  });
  label.append(box, text);
  panel.insertBefore(label, document.getElementById('startOver'));
  return box;
}
