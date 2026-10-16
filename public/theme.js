(() => {
  let preference = 'auto';
  try { preference = localStorage.getItem('wordnest-theme') || 'auto'; } catch {}
  if (!['auto', 'light', 'dark'].includes(preference)) preference = 'auto';
  const theme = preference === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#171d1a' : '#f6f5f0');
})();
