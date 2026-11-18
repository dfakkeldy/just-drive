// Links keep native Enter activation. Space also activates the focused link on these pages.
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const link = document.activeElement;
  if (!(link instanceof HTMLAnchorElement) || !link.hasAttribute('href')) return;
  event.preventDefault();
  if (!event.repeat) link.click();
});
