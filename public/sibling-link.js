import { messages, translator } from './i18n.js?v=2.6.2-b17d83728acbc4d2';

// Address of the companion Wordnest app that this deployment links to.
// Replace it with the deployed address of the companion app when it is available.
const COMPANION_URL = 'wordnest2.what-the-fuck.men';

// Interface text for the companion link, registered in the shared i18n catalogue.
Object.assign(messages.en, {
  companionLabel: 'Other subjects',
  companionTitle: 'Other subjects',
  companionHelp: 'Studying something other than English vocabulary? Open the companion Wordnest app for other subjects. It opens in a new tab.',
  companionButton: 'Open Wordnest for other subjects',
  companionOpensInNewTab: '{label} (opens in a new tab)'
});
Object.assign(messages.ja, {
  companionLabel: '他の科目',
  companionTitle: '他の科目',
  companionHelp: '英単語以外の科目を学習する場合は、他の科目用のWordnestを開いてください。新しいタブで開きます。',
  companionButton: '他の科目用のWordnestを開く',
  companionOpensInNewTab: '{label}（新しいタブで開きます）'
});

// Lucide "external-link" icon, drawn with the same stroke style as the bundled icons.
const ICON = '<svg class="ui-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

const STYLE = `
.companion-trigger{text-decoration:none}
.is-practicing .companion-trigger{display:none}
.companion-settings>p{font-size:12px;line-height:1.8;color:var(--muted)}
.companion-settings>.btn{justify-self:start}
.companion-settings .ui-icon{width:16px;height:16px}
`;

const style = document.createElement('style');
style.textContent = STYLE;
document.head.append(style);

// The app keeps the current interface language on the root element.
const currentLanguage = () => (document.documentElement.lang === 'ja' ? 'ja' : 'en');

function createLink(className, label, ariaLabel) {
  const link = document.createElement('a');
  link.className = className;
  link.href = COMPANION_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', ariaLabel);
  link.insertAdjacentHTML('beforeend', ICON);
  link.append(label);
  return link;
}

// Icon button above Account in the sidebar. It shows only the icon on narrow screens.
function syncSidebar(language, t) {
  const bottom = document.querySelector('.sidebar-bottom');
  if (!bottom) return;
  const existing = bottom.querySelector('.companion-trigger');
  if (existing && existing.dataset.language === language) return;
  if (existing) existing.remove();
  const label = t('companionLabel');
  const link = createLink('settings-trigger companion-trigger', label, t('companionOpensInNewTab', { label }));
  link.dataset.language = language;
  bottom.prepend(link);
}

// Section at the bottom of the Settings dialog, just above the version line.
function syncSettings(language, t) {
  const version = document.querySelector('#modal .app-version');
  if (!version) return;
  const container = version.parentElement;
  const existing = container.querySelector('.companion-settings');
  if (existing && existing.dataset.language === language) return;
  if (existing) existing.remove();

  const section = document.createElement('section');
  section.className = 'settings-section companion-settings';
  section.dataset.language = language;
  section.setAttribute('aria-labelledby', 'companion-settings-title');

  const title = document.createElement('h3');
  title.id = 'companion-settings-title';
  title.textContent = t('companionTitle');

  const help = document.createElement('p');
  help.textContent = t('companionHelp');

  const label = t('companionButton');
  section.append(title, help, createLink('btn ghost', label, t('companionOpensInNewTab', { label })));
  version.before(section);
}

function sync() {
  const language = currentLanguage();
  const t = translator(language);
  syncSidebar(language, t);
  syncSettings(language, t);
}

// The app re-renders whole screens and the Settings dialog, so the nodes are restored after each render.
const nextFrame = window.requestAnimationFrame
  ? callback => window.requestAnimationFrame(callback)
  : callback => setTimeout(callback, 16);
let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  nextFrame(() => {
    scheduled = false;
    sync();
  });
}

new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
schedule();
