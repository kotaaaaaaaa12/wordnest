(() => {
  const allowed={light:['default','ocean','lavender','apricot','sage'],dark:['default','midnight','graphite','ember','plum']};
  let preference='auto',light='default',dark='default';
  try{preference=localStorage.getItem('wordnest-theme') || 'auto';light=localStorage.getItem('wordnest-light-palette') || 'default';dark=localStorage.getItem('wordnest-dark-palette') || 'default';}catch{}
  if(!['auto','light','dark'].includes(preference))preference='auto';
  if(!allowed.light.includes(light))light='default';
  if(!allowed.dark.includes(dark))dark='default';
  const theme=preference==='auto'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preference;
  const palette=theme==='dark'?dark:light;
  document.documentElement.dataset.theme=theme;
  document.documentElement.dataset.palette=palette;
  const backgrounds={light:{default:'#f6f5f0',ocean:'#eef5fa',lavender:'#f5f2fa',apricot:'#fff4e8',sage:'#f0f5ec'},dark:{default:'#171d1a',midnight:'#111a27',graphite:'#1b1b1e',ember:'#211913',plum:'#211927'}};
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',backgrounds[theme][palette]);
})();
