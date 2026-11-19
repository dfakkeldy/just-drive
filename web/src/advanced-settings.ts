// The collapsed "Advanced" part of the settings panel: a native details element (keyboard: Tab to its summary, Enter or
// Space to open; touch: one tap), remembered open or closed between visits like the other switches.
// Its first switch is "Far views on phone" (far-choice.ts). A choice loads the page again, as Low/Full detail does:
// the far views pack hooks the scene's materials before the first frame, so it is not switched under a running drive.

import { FAR_PHONE_CHOICES, saveFarPhone, type FarPhone } from './far-choice';

const OPEN_KEY = 'mmm.advancedOpen';

export function advancedSection(panel: HTMLElement | null, before: HTMLElement | null, touch: boolean): HTMLElement | null {
  if (!panel) return null;
  const details = Object.assign(document.createElement('details'), { id: 'advanced' });
  details.style.cssText = 'margin-top:12px';
  try { details.open = localStorage.getItem(OPEN_KEY) === '1'; } catch { /* private mode */ }
  const summary = Object.assign(document.createElement('summary'), { textContent: 'Advanced' });
  summary.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:6px' + (touch ? ';min-height:44px' : ';min-height:28px');
  details.append(summary);
  details.addEventListener('toggle', () => { try { localStorage.setItem(OPEN_KEY, details.open ? '1' : '0'); } catch { /* private mode */ } });
  panel.insertBefore(details, before);
  return details;
}

const LABELS: Record<FarPhone, string> = { off: 'Off', coarse: 'Coarse', full: 'Full' };

/** Three radio buttons; a change saves the choice and loads the page again (`go`, replaceable in a test). */
export function farPhoneSetting(section: HTMLElement | null, current: FarPhone, fromUrl: boolean, touch: boolean,
  go: (search: string) => void = search => { location.search = search; }): HTMLFieldSetElement | null {
  if (!section) return null;
  const set = Object.assign(document.createElement('fieldset'), { id: 'farPhone' });
  set.style.cssText = 'border:0;margin:8px 0 0;padding:0;min-width:0';
  const legend = Object.assign(document.createElement('legend'), { textContent: 'Far views on phone' });
  legend.style.cssText = 'padding:0;margin-bottom:4px';
  set.append(legend);
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  for (const choice of FAR_PHONE_CHOICES) {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:6px;margin:0;padding:0 10px 0 0' + (touch ? ';min-height:44px' : ';min-height:28px');
    const radio = Object.assign(document.createElement('input'), { type: 'radio', name: 'farPhone', value: choice, checked: choice === current });
    radio.style.width = 'auto';
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const query = new URLSearchParams(location.search);
      query.delete('far');
      // Without storage, the address carries the choice, as Low detail does with ?q=.
      if (!saveFarPhone(choice)) query.set('far', choice);
      go(query.toString());
    });
    label.append(radio, LABELS[choice]);
    row.append(label);
  }
  const note = Object.assign(document.createElement('small'), {
    textContent: 'Distant hills, the curved sea and far wind turbines. Coarse is lighter; Full may slow a phone. The page loads again.' });
  note.style.cssText = 'display:block;margin-top:2px';
  set.append(row, note);
  if (fromUrl) {
    const typed = Object.assign(document.createElement('small'), { textContent: 'Set by the page address (far=' + current + ').' });
    typed.style.cssText = 'display:block;margin-top:2px';
    set.append(typed);
  }
  section.append(set);
  return set;
}
