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

/** Wire the sheet’s Close button and Escape key. */
export function installSettings(): void {
  const sheet = document.getElementById('settings');
  const closeSheet = () => { sheet?.classList.remove('open'); document.getElementById('gear')?.focus({ preventScroll: true }); };
  document.getElementById('settingsClose')?.addEventListener('click', closeSheet);
  addEventListener('keydown', event => {
    if (event.code === 'Escape' && sheet?.classList.contains('open')) { event.preventDefault(); closeSheet(); }
  });
}
