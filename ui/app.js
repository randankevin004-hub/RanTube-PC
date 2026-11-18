import './bridge.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#downloadForm');
const urlInput = $('#urlInput');
const folderButton = $('#folderButton');
const folderText = $('#folderText');
const toolStatus = $('#toolStatus');
const setupPanel = $('#setupPanel');
const progressArea = $('#progressArea');
const errorMessage = $('#errorMessage');
const downloadButton = $('#downloadButton');
const buttonText = $('#buttonText');
const progressTitle = $('#progressTitle');
const progressPercent = $('#progressPercent');
const progressFill = $('#progressFill');
const progressDetail = $('#progressDetail');
let supabase = null;
try { if (window.supabase) supabase = window.supabase.createClient('https://iqxlzhljakpyxwuadclp.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxeGx6aGxqYWtweXh3dWFkY2xwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2OTIxODYsImV4cCI6MjEwOTI2ODE4Nn0._ZgnIKUBPx17pjhmXO6xVIGCcRAtDGzXeL39XB-sm58'); } catch {}
async function ensureAuth() { if (!supabase) return; const { data } = await supabase.auth.getSession(); signedIn = !!data.session; localStorage.setItem('signedIn', signedIn ? '1' : '0'); }
ensureAuth();
let freeCount = Number(localStorage.getItem('freeDownloads') || 0);
let signedIn = localStorage.getItem('signedIn') === '1';
let selectedFolder = null;
let busy = false;
let activeDownload = null;
let finishedDownloads = loadStored('finishedDownloads', []);
let selectedFormatId = null;
let selectedFormatUrl = null;
const shortcutDefaults = { download: 'Ctrl+L', search: 'Ctrl+Shift+F', browser: 'Ctrl+B', activity: 'Ctrl+J' };
let shortcuts = { ...shortcutDefaults, ...loadStored('keyboardShortcuts', {}) };
let recordingShortcut = null;
const initialBrowserUrl = 'https://www.google.com/';
function createBrowserTab() {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, entries: [initialBrowserUrl], index: 0 };
}
let browserTabs = loadStored('browserTabs', [createBrowserTab()]);
if (!browserTabs.length) browserTabs = [createBrowserTab()];
let activeBrowserTab = 0;
let browserBookmarks = loadStored('browserBookmarks', []);
let browserHistory = loadStored('browserHistory', []);
let activeView = 'download';
const visibleBrowserTabs = new Set();

function loadStored(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function showSignInPrompt() {
  const modal = document.getElementById('authModal');
  modal.classList.remove('hidden');
}
const authModal = document.getElementById('authModal');
if (authModal) {
  document.getElementById('authSignIn').addEventListener('click', async () => {
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { const e = document.getElementById('authError'); e.textContent = error.message; e.classList.remove('hidden'); }
    else { signedIn = true; localStorage.setItem('signedIn','1'); authModal.classList.add('hidden'); }
  });
  document.getElementById('authSignUp').addEventListener('click', async () => {
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) { const e = document.getElementById('authError'); e.textContent = error.message; e.classList.remove('hidden'); }
    else { signedIn = true; localStorage.setItem('signedIn','1'); authModal.classList.add('hidden'); }
  });
}

// Update check
async function checkForUpdate() {
  try {
    const res = await fetch('https://api.github.com/repos/randankevin/universal-downloader-tauri/releases/latest');
    const data = await res.json();
    const latest = (data.tag_name || '').replace(/^v/, '');
    const current = '1.0.2';
    if (latest && latest !== current) {
      const banner = document.createElement('div');
      banner.className = 'update-banner';
      banner.textContent = `Update available: v${latest}. Click to download.`;
      banner.onclick = () => window.open(data.html_url, '_blank');
      document.body.prepend(banner);
    }
  } catch {}
}
checkForUpdate();

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
}
function clearError() { errorMessage.classList.add('hidden'); errorMessage.textContent = ''; }
function setBusy(value) {
  busy = value;
  downloadButton.disabled = value;
  buttonText.textContent = value ? 'Working…' : 'Download video';
}
function updateFolderLabel(folder) {
  if (!folder) { folderText.textContent = 'Downloads'; return; }
  folderText.textContent = folder.replace(/\\/g, '/').split('/').filter(Boolean).pop() || folder;
  folderButton.title = folder;
}
function updateStatus(status) {
  const label = toolStatus.querySelector('span');
  $('#ffmpegNote').classList.toggle('hidden', Boolean(status.ffmpeg));
  if (status.ytDlp) {
    toolStatus.className = 'tool-status ready';
    const source = status.ytDlpManaged ? 'app copy' : 'found on your PC';
    label.textContent = status.version ? `Ready · yt-dlp ${status.version} · ${source}${status.ffmpeg ? '' : ' · standard quality'}` : `Downloader ready · ${source}`;
    setupPanel.classList.add('hidden');
  } else {
    toolStatus.className = 'tool-status missing';
    label.textContent = 'Setup needed';
    setupPanel.classList.remove('hidden');
  }
  if (status.downloadFolder) {
    if (!selectedFolder) selectedFolder = status.downloadFolder;
    updateFolderLabel(selectedFolder);
  }
}

window.downloader.onSetupProgress(({ message, percent }) => {
  const button = $('#installButton');
  button.disabled = true;
  button.textContent = `${Math.round(percent)}%`;
  setupPanel.querySelector('strong').textContent = message;
});
window.downloader.onDownloadProgress(({ percent, message }) => {
  progressTitle.textContent = percent >= 100 ? 'Finishing your video…' : 'Downloading your video…';
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  progressDetail.textContent = message || 'This can take a little while.';
  if (activeDownload) {
    activeDownload.percent = Math.min(100, Math.max(0, percent));
    activeDownload.detail = message || 'Downloading…';
    renderDownloadActivity();
  }
});
window.downloader.onDownloadMessage((message) => {
  const detail = message.slice(0, 150);
  progressDetail.textContent = detail;
  if (activeDownload) {
    activeDownload.detail = detail;
    renderDownloadActivity();
  }
});
window.downloader.onDownloadComplete(({ ok, cancelled, message }) => {
  progressTitle.textContent = message;
  progressPercent.textContent = ok ? '100%' : '—';
  if (ok) progressFill.style.width = '100%';
  if (ok && !signedIn) { freeCount++; localStorage.setItem('freeDownloads', String(freeCount)); }
  if (cancelled) progressDetail.textContent = 'You can start another download whenever you’re ready.';
});

$('#pasteButton').addEventListener('click', async () => {
  try {
    const text = await window.downloader.getClipboardText();
    if (!text) return showError('There is no link on the clipboard yet. Copy a video link, then try again.');
    urlInput.value = text.trim();
    urlInput.focus();
  }
  catch { showError('Clipboard access is unavailable. Paste the link with Ctrl+V.'); }
});
folderButton.addEventListener('click', async () => {
  const folder = await window.downloader.chooseFolder();
  if (folder) { selectedFolder = folder; updateFolderLabel(folder); }
});
$('#openFolderButton').addEventListener('click', () => window.downloader.openFolder(selectedFolder));
$('#ffmpegLink').addEventListener('click', () => window.downloader.openFfmpegPage());

function saveLocal(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function createText(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}
function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function formatUploadDate(date, timestamp) {
  let uploaded;
  if (date && /^\d{8}$/.test(date)) {
    uploaded = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))));
  } else if (Number.isFinite(timestamp)) {
    uploaded = new Date(timestamp * 1000);
  } else if (date) {
    uploaded = new Date(date);
  }
  if (!uploaded || Number.isNaN(uploaded.getTime())) return 'Upload date unavailable';
  const days = Math.max(0, Math.floor((Date.now() - uploaded.getTime()) / 86400000));
  if (days < 1) return 'Uploaded today';
  if (days === 1) return 'Uploaded yesterday';
  if (days < 7) return `Uploaded ${days} days ago`;
  if (days < 30) return `Uploaded ${Math.floor(days / 7)} ${Math.floor(days / 7) === 1 ? 'week' : 'weeks'} ago`;
  if (days < 365) return `Uploaded ${Math.floor(days / 30)} ${Math.floor(days / 30) === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  const remainingMonths = Math.floor((days % 365) / 30);
  return `Uploaded ${years} ${years === 1 ? 'year' : 'years'}${remainingMonths ? `, ${remainingMonths} ${remainingMonths === 1 ? 'month' : 'months'}` : ''} ago`;
}
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${size.toFixed(unit > 0 ? 1 : 0)} ${units[unit]}`;
}
function renderDownloadActivity() {
  const activeContainer = $('#activeDownloads');
  const finishedContainer = $('#finishedDownloads');
  activeContainer.replaceChildren();
  finishedContainer.replaceChildren();
  $('#downloadCount').textContent = String(finishedDownloads.length + (activeDownload ? 1 : 0));

  if (!activeDownload) {
    activeContainer.append(createText('div', 'empty-state', 'No active downloads.'));
  } else {
    const card = createText('div', 'active-download-card');
    card.append(createText('span', 'download-state-icon', '↓'));
    const info = createText('div', 'active-download-info');
    info.append(createText('strong', '', activeDownload.title));
    info.append(createText('small', '', activeDownload.detail || 'Starting…'));
    const progress = document.createElement('div');
    progress.className = 'mini-progress';
    const fill = document.createElement('span');
    fill.style.width = `${activeDownload.percent || 0}%`;
    progress.append(fill);
    info.append(progress);
    card.append(info);
    card.append(createText('span', 'download-status', `${Math.round(activeDownload.percent || 0)}%`));
    const cancel = createText('button', '', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => window.downloader.cancelDownload());
    card.append(cancel);
    activeContainer.append(card);
  }

  if (!finishedDownloads.length) {
    finishedContainer.append(createText('div', 'empty-state', 'Finished downloads will appear here.'));
  } else {
    finishedDownloads.forEach((item) => {
      const card = createText('div', `finished-download-card${item.status === 'Finished' ? '' : ' failed'}`);
      card.append(createText('span', 'download-state-icon', item.status === 'Finished' ? '✓' : '–'));
      const info = createText('div', 'finished-download-info');
      info.append(createText('strong', '', item.title));
      info.append(createText('small', '', `${item.status} · ${new Date(item.finishedAt).toLocaleString()} · ${item.folder || 'Downloads'}`));
      card.append(info);
      card.append(createText('span', 'download-status', item.status));
      const actions = document.createElement('div');
      actions.className = 'download-actions';
      const openFolder = createText('button', '', 'Folder');
      openFolder.type = 'button';
      openFolder.addEventListener('click', () => window.downloader.openFolder(item.folder || selectedFolder));
      actions.append(openFolder);
      const openSource = createText('button', '', 'Source');
      openSource.type = 'button';
      openSource.addEventListener('click', () => window.downloader.openUrl(item.url));
      actions.append(openSource);
      card.append(actions);
      finishedContainer.append(card);
    });
  }
}

async function runDownload(url, title, showManager = false) {
  clearError();
  $('#activityError').classList.add('hidden');
  if (busy) return;
  if (selectedFormatId && selectedFormatUrl !== url) {
    selectedFormatId = null;
    selectedFormatUrl = null;
    $('#selectedFormat').classList.add('hidden');
  }
  setBusy(true);
  let current;
  try {
    current = await window.downloader.getStatus();
  } catch (error) {
    setBusy(false);
    const message = error?.message || String(error);
    if (showManager) {
      goToView('activity');
      $('#activityError').textContent = message;
      $('#activityError').classList.remove('hidden');
    } else showError(message);
    return;
  }
  if (!current.ytDlp) {
    setBusy(false);
    showError('Please set up yt-dlp first. Your consent is required before it is downloaded.');
    setupPanel.classList.remove('hidden');
    goToView('download');
    return;
  }
  if (supabase && !signedIn) { setBusy(false); showSignInPrompt(); return; }
  activeDownload = { title: title || url, url, percent: 0, detail: 'Connecting to the source…' };
  renderDownloadActivity();
  if (showManager) goToView('activity');
  progressArea.classList.remove('hidden');
  progressTitle.textContent = 'Starting your download…';
  progressPercent.textContent = '0%';
  progressFill.style.width = '0%';
  progressDetail.textContent = 'Connecting to the source…';
  let result;
  try {
    result = await window.downloader.download({
      url,
      quality: $('#qualitySelect').value,
      formatId: selectedFormatId,
      folder: selectedFolder
    });
  } catch (error) {
    result = { ok: false, cancelled: false, error: typeof error === 'string' ? error : error?.message || String(error) };
  }
  setBusy(false);
  if (result.needsSetup) {
    setupPanel.classList.remove('hidden');
    goToView('download');
    showError(result.error);
  } else if (!result.ok && !result.cancelled) {
    if (showManager) {
      $('#activityError').textContent = result.error || 'The download could not be completed.';
      $('#activityError').classList.remove('hidden');
    } else showError(result.error || 'The download could not be completed.');
  }
  else {
    progressTitle.textContent = result.cancelled ? 'Download cancelled' : 'Your video is ready.';
    progressDetail.textContent = result.cancelled ? 'You can start another download whenever you’re ready.' : `Saved to ${selectedFolder || 'Downloads'}`;
  }
  finishedDownloads.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: title || url,
    url,
    folder: selectedFolder,
    status: result.ok ? 'Finished' : result.cancelled ? 'Cancelled' : 'Failed',
    finishedAt: new Date().toISOString()
  });
  finishedDownloads = finishedDownloads.slice(0, 40);
  saveLocal('finishedDownloads', finishedDownloads);
  activeDownload = null;
  renderDownloadActivity();
}

function goToView(view) {
  activeView = view;
  document.querySelectorAll('[data-main-view]').forEach((element) => element.classList.toggle('hidden', element.dataset.mainView !== view));
  $('#searchView').classList.toggle('hidden', view !== 'search');
  $('#browserView').classList.toggle('hidden', view !== 'browser');
  $('#activityView').classList.toggle('hidden', view !== 'activity');
  document.querySelectorAll('.feature-tab[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const titles = { download: 'Download media', search: 'Search videos', browser: 'Browser', activity: 'Your downloads' };
  $('#pageTitle').textContent = titles[view] || titles.download;
  if (view === 'browser') renderBrowser();
  else window.downloader.hideBrowserTabs().catch((error) => {
    $('#browserError').textContent = error?.message || String(error);
    $('#browserError').classList.remove('hidden');
  });
  if (view === 'activity') renderDownloadActivity();
}

document.querySelectorAll('.feature-tab[data-view]').forEach((button) => button.addEventListener('click', () => goToView(button.dataset.view)));
document.querySelectorAll('[data-open-view]').forEach((button) => button.addEventListener('click', () => goToView(button.dataset.openView)));

$('#searchForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = $('#searchInput').value.trim();
  if (!query || busy) return;
  const button = $('#searchButton');
  const results = $('#searchResults');
  const error = $('#searchError');
  button.disabled = true;
  button.textContent = 'Searching…';
  error.classList.add('hidden');
  $('#searchLoading').classList.remove('hidden');
  $('#resultsHeading').classList.add('hidden');
  results.replaceChildren();
  try {
    const items = await window.downloader.search(query);
    $('#resultsHeading').classList.remove('hidden');
    results.replaceChildren();
    if (!items.length) results.append(createText('div', 'empty-state', 'No results found. Try a different search.'));
    items.forEach((item) => {
      const row = document.createElement('article');
      row.className = 'search-result';
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      const fallbackThumbnail = `https://i.ytimg.com/vi/${encodeURIComponent(item.id)}/hqdefault.jpg`;
      image.addEventListener('error', () => {
        if (image.dataset.fallbackAttempted) {
          image.replaceWith(createText('div', 'thumbnail-placeholder', '▶'));
        } else {
          image.dataset.fallbackAttempted = 'true';
          image.src = fallbackThumbnail;
        }
      });
      if (item.thumbnail) image.src = item.thumbnail;
      else image.src = fallbackThumbnail;
      row.append(image);
      const description = document.createElement('div');
      description.append(createText('p', 'result-title', item.title));
      const metadata = [item.uploader, formatDuration(item.duration), formatUploadDate(item.uploadDate, item.uploadTimestamp)].filter(Boolean).join(' · ');
      description.append(createText('p', 'result-meta', metadata || 'Video result'));
      row.append(description);
      const actions = document.createElement('div');
      actions.className = 'result-actions';
      const checkFormats = createText('button', 'result-formats', 'Formats');
      checkFormats.type = 'button';
      checkFormats.addEventListener('click', () => checkVideoFormats(item.url));
      actions.append(checkFormats);
      const download = createText('button', 'result-download', busy ? 'Busy' : 'Download');
      download.type = 'button';
      download.disabled = busy;
      download.addEventListener('click', () => runDownload(item.url, item.title, true));
      actions.append(download);
      row.append(actions);
      results.append(row);
    });
  } catch (searchError) {
    $('#resultsHeading').classList.add('hidden');
    results.replaceChildren();
    error.textContent = searchError?.message || String(searchError);
    error.classList.remove('hidden');
  } finally {
    $('#searchLoading').classList.add('hidden');
    button.disabled = false;
    button.textContent = 'Search';
  }
});

function formatKindLabel(kind) {
  if (kind === 'combined') return 'Video + audio';
  if (kind === 'video') return 'Video only';
  return 'Audio only';
}
async function checkVideoFormats(url = urlInput.value.trim()) {
  clearError();
  if (!url) {
    showError('Paste a video link first, then check its formats.');
    urlInput.focus();
    return;
  }
  urlInput.value = url;
  const checkedUrl = url;
  $('#formatsModal').classList.remove('hidden');
  $('#formatsTitle').textContent = 'Checking available formats…';
  $('#formatsMeta').textContent = '';
  $('#formatsError').classList.add('hidden');
  $('#formatsList').replaceChildren(createText('div', 'empty-state', 'Loading formats from the source…'));
  $('#formatsLoading').classList.remove('hidden');
  try {
    const data = await window.downloader.getVideoFormats(url);
    $('#formatsTitle').textContent = data.title || 'Available formats';
    $('#formatsMeta').textContent = formatUploadDate(data.uploadDate, data.uploadTimestamp);
    const list = $('#formatsList');
    list.replaceChildren();
    if (!data.formats.length) {
      list.append(createText('div', 'empty-state', 'No downloadable formats were listed for this video.'));
      return;
    }
    const groups = [
      ['combined', 'Video with audio'],
      ['video', 'Video only'],
      ['audio', 'Audio only']
    ];
    groups.forEach(([kind, heading]) => {
      const formats = data.formats.filter((format) => format.formatType === kind);
      if (!formats.length) return;
      const group = document.createElement('section');
      group.className = 'format-group';
      group.append(createText('h3', '', heading));
      formats.forEach((format) => {
        const row = document.createElement('article');
        row.className = 'format-row';
        const details = document.createElement('div');
        details.className = 'format-details';
        details.append(createText('strong', '', [
          format.resolution || format.note || format.formatId,
          format.ext ? `.${format.ext}` : '',
          format.filesize ? formatFileSize(format.filesize) : ''
        ].filter(Boolean).join(' · ')));
        details.append(createText('small', '', [
          format.note,
          format.vcodec && format.vcodec !== 'none' ? `Video: ${format.vcodec}` : '',
          format.acodec && format.acodec !== 'none' ? `Audio: ${format.acodec}` : ''
        ].filter(Boolean).join(' · ') || `Format ${format.formatId}`));
        row.append(details);
        row.append(createText('span', `format-badge ${kind}`, formatKindLabel(kind)));
        const useButton = createText('button', 'format-use', 'Use format');
        useButton.type = 'button';
        useButton.addEventListener('click', () => {
          selectedFormatId = format.formatId;
          selectedFormatUrl = checkedUrl;
          $('#selectedFormatText').textContent = `${formatKindLabel(kind)} · ${format.resolution || format.note || format.formatId}`;
          $('#selectedFormat').classList.remove('hidden');
          $('#formatsModal').classList.add('hidden');
        });
        row.append(useButton);
        group.append(row);
      });
      list.append(group);
    });
  } catch (formatError) {
    $('#formatsList').replaceChildren();
    $('#formatsError').textContent = formatError?.message || String(formatError);
    $('#formatsError').classList.remove('hidden');
  } finally {
    $('#formatsLoading').classList.add('hidden');
  }
}
$('#checkFormatsButton').addEventListener('click', () => checkVideoFormats());
$('#closeFormatsModal').addEventListener('click', () => $('#formatsModal').classList.add('hidden'));
$('#clearSelectedFormat').addEventListener('click', () => {
  selectedFormatId = null;
  selectedFormatUrl = null;
  $('#selectedFormat').classList.add('hidden');
});
$('#qualitySelect').addEventListener('change', () => {
  selectedFormatId = null;
  selectedFormatUrl = null;
  $('#selectedFormat').classList.add('hidden');
});
document.querySelectorAll('.search-format-close').forEach((button) => button.addEventListener('click', () => $('#formatsModal').classList.add('hidden')));

function currentBrowserTab() { return browserTabs[activeBrowserTab]; }
function browserTabUrl(tab) { return tab.entries[tab.index] || initialBrowserUrl; }
function browserTitle(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'New tab'; }
}
function normalizeBrowserAddress(address) {
  const value = address.trim();
  if (!value) return null;
  if (!value.includes('://') && !value.includes('.') && !value.startsWith('localhost')) {
    return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  }
  let parsed;
  try { parsed = new URL(value.includes('://') ? value : `https://${value}`); } catch {}
  if (parsed && ['http:', 'https:'].includes(parsed.protocol)) return parsed.href;
  if (value.includes(' ')) return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  return null;
}
function navigateBrowser(address, remember = true) {
  const url = normalizeBrowserAddress(address);
  if (!url) {
    $('#browserError').textContent = 'Enter a valid web address or search phrase.';
    $('#browserError').classList.remove('hidden');
    return;
  }
  $('#browserError').classList.add('hidden');
  const tab = currentBrowserTab();
  tab.entries = tab.entries.slice(0, tab.index + 1);
  tab.entries.push(url);
  if (tab.entries.length > 50) tab.entries.shift();
  tab.index = tab.entries.length - 1;
  if (remember) {
    browserHistory = [{ url, visitedAt: new Date().toISOString() }, ...browserHistory.filter((item) => item.url !== url)].slice(0, 40);
    saveLocal('browserHistory', browserHistory);
  }
  saveLocal('browserTabs', browserTabs);
  renderBrowser();
}
function renderBrowser() {
  const tabs = $('#browserTabs');
  if (!tabs) return;
  tabs.replaceChildren();
  browserTabs.forEach((tab, index) => {
    const container = document.createElement('div');
    container.className = `browser-tab${index === activeBrowserTab ? ' active' : ''}`;
    container.dataset.tabId = String(tab.id);
    container.setAttribute('role', 'tab');
    container.setAttribute('aria-selected', String(index === activeBrowserTab));
    const label = createText('button', 'browser-tab-label', browserTitle(browserTabUrl(tab)));
    label.type = 'button';
    const close = createText('button', 'close-tab', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close tab');
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      window.downloader.closeBrowserTab(String(tab.id)).catch((error) => {
        $('#browserError').textContent = error?.message || String(error);
        $('#browserError').classList.remove('hidden');
      });
      visibleBrowserTabs.delete(String(tab.id));
      browserTabs.splice(index, 1);
      if (!browserTabs.length) browserTabs.push(createBrowserTab());
      if (index < activeBrowserTab) activeBrowserTab--;
      else if (index === activeBrowserTab) activeBrowserTab = Math.min(activeBrowserTab, browserTabs.length - 1);
      saveLocal('browserTabs', browserTabs);
      renderBrowser();
    });
    container.append(label, close);
    container.addEventListener('click', () => { activeBrowserTab = index; renderBrowser(); });
    tabs.append(container);
  });
  const add = createText('button', 'browser-tab add-tab', '+');
  add.type = 'button';
  add.setAttribute('aria-label', 'New tab');
  add.addEventListener('click', () => {
    browserTabs.push(createBrowserTab());
    activeBrowserTab = browserTabs.length - 1;
    saveLocal('browserTabs', browserTabs);
    renderBrowser();
    $('#browserAddress').focus();
  });
  tabs.append(add);
  const tab = currentBrowserTab();
  if (!tab) return;
  const url = browserTabUrl(tab);
  $('#browserAddress').value = url;
  $('#browserBack').disabled = tab.index <= 0;
  $('#browserForward').disabled = tab.index >= tab.entries.length - 1;
  $('#bookmarkButton').textContent = browserBookmarks.some((item) => item.url === url) ? '★' : '☆';
  renderBrowserLists();
  if (activeView === 'browser') showNativeBrowser(tab, url);
}
async function showNativeBrowser(tab, url) {
  const surface = $('#browserSurface');
  const rect = surface.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const tabId = String(tab.id);
  try {
    await window.downloader.showBrowserTab({
      tabId,
      url,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    });
    visibleBrowserTabs.add(tabId);
    $('#browserError').classList.add('hidden');
  } catch (error) {
    $('#browserError').textContent = error?.message || String(error);
    $('#browserError').classList.remove('hidden');
  }
}
function updateNativeBrowserBounds() {
  if (activeView !== 'browser') return;
  const tab = currentBrowserTab();
  if (!tab) return;
  const tabId = String(tab.id);
  if (!visibleBrowserTabs.has(tabId)) return;
  const rect = $('#browserSurface').getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  window.downloader.resizeBrowserTab({
    tabId,
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  }).catch((error) => {
    $('#browserError').textContent = error?.message || String(error);
    $('#browserError').classList.remove('hidden');
  });
}
function recordNativeBrowserNavigation({ tabId, url }) {
  const tab = browserTabs.find((item) => String(item.id) === tabId);
  if (!tab || !['http:', 'https:'].includes(new URL(url).protocol) || browserTabUrl(tab) === url) return;
  tab.entries = tab.entries.slice(0, tab.index + 1);
  tab.entries.push(url);
  if (tab.entries.length > 50) tab.entries.shift();
  tab.index = tab.entries.length - 1;
  browserHistory = [{ url, visitedAt: new Date().toISOString() }, ...browserHistory.filter((item) => item.url !== url)].slice(0, 40);
  saveLocal('browserTabs', browserTabs);
  saveLocal('browserHistory', browserHistory);
  if (browserTabs[activeBrowserTab] === tab) {
    $('#browserAddress').value = url;
    $('#browserBack').disabled = tab.index <= 0;
    $('#browserForward').disabled = true;
    $('#bookmarkButton').textContent = browserBookmarks.some((item) => item.url === url) ? '★' : '☆';
    const label = $('#browserTabs').querySelector(`[data-tab-id="${tabId}"] .browser-tab-label`);
    if (label) label.textContent = browserTitle(url);
  }
  renderBrowserLists();
}
window.downloader.onBrowserNavigation(recordNativeBrowserNavigation);
const browserSurfaceObserver = new ResizeObserver(updateNativeBrowserBounds);
browserSurfaceObserver.observe($('#browserSurface'));
window.addEventListener('resize', updateNativeBrowserBounds);
window.addEventListener('scroll', updateNativeBrowserBounds, true);

function renderBrowserLists() {
  const bookmarks = $('#bookmarkList');
  const history = $('#browserHistoryList');
  bookmarks.replaceChildren();
  history.replaceChildren();
  if (!browserBookmarks.length) bookmarks.append(createText('div', 'empty-state', 'No bookmarks yet.'));
  browserBookmarks.forEach((item) => bookmarks.append(createBrowserListItem(item, true)));
  if (!browserHistory.length) history.append(createText('div', 'empty-state', 'Pages you visit will appear here.'));
  browserHistory.slice(0, 12).forEach((item) => history.append(createBrowserListItem(item, false)));
}
function createBrowserListItem(item, canRemove) {
  const row = document.createElement('div');
  row.className = 'browser-list-item';
  const open = createText('button', '', item.title || browserTitle(item.url));
  open.type = 'button';
  open.title = item.url;
  open.addEventListener('click', () => navigateBrowser(item.url));
  row.append(open);
  if (canRemove) {
    const remove = createText('button', 'remove-bookmark', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove bookmark');
    remove.addEventListener('click', () => {
      browserBookmarks = browserBookmarks.filter((bookmark) => bookmark.url !== item.url);
      saveLocal('browserBookmarks', browserBookmarks);
      renderBrowser();
    });
    row.append(remove);
  }
  return row;
}
$('#browserForm').addEventListener('submit', (event) => {
  event.preventDefault();
  navigateBrowser($('#browserAddress').value);
});
$('#browserBack').addEventListener('click', () => {
  const tab = currentBrowserTab();
  if (tab.index > 0) { tab.index--; saveLocal('browserTabs', browserTabs); renderBrowser(); }
});
$('#browserForward').addEventListener('click', () => {
  const tab = currentBrowserTab();
  if (tab.index < tab.entries.length - 1) { tab.index++; saveLocal('browserTabs', browserTabs); renderBrowser(); }
});
$('#browserHome').addEventListener('click', () => navigateBrowser(initialBrowserUrl));
$('#browserExternalButton').addEventListener('click', () => window.downloader.openUrl(browserTabUrl(currentBrowserTab())));
$('#browserDownloadButton').addEventListener('click', () => {
  urlInput.value = browserTabUrl(currentBrowserTab());
  goToView('download');
  urlInput.focus();
});
$('#bookmarkButton').addEventListener('click', () => {
  const url = browserTabUrl(currentBrowserTab());
  if (browserBookmarks.some((item) => item.url === url)) {
    browserBookmarks = browserBookmarks.filter((item) => item.url !== url);
  } else {
    browserBookmarks.unshift({ url, title: browserTitle(url) });
  }
  saveLocal('browserBookmarks', browserBookmarks);
  renderBrowser();
});

function canonicalShortcut(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) parts.push(key);
  return parts.join('+');
}
function showShortcutModal() {
  $('#shortcutModal').classList.remove('hidden');
  updateShortcutLabels();
}
function updateShortcutLabels() {
  document.querySelectorAll('[data-shortcut]').forEach((button) => {
    button.textContent = recordingShortcut === button.dataset.shortcut ? 'Press keys…' : (shortcuts[button.dataset.shortcut] || shortcutDefaults[button.dataset.shortcut]);
    button.classList.toggle('recording', recordingShortcut === button.dataset.shortcut);
  });
}
$('#settingsButton').addEventListener('click', showShortcutModal);
$('#closeShortcutModal').addEventListener('click', () => $('#shortcutModal').classList.add('hidden'));
$('#doneShortcutButton').addEventListener('click', () => $('#shortcutModal').classList.add('hidden'));
$('#resetShortcutsButton').addEventListener('click', () => {
  shortcuts = { ...shortcutDefaults };
  saveLocal('keyboardShortcuts', shortcuts);
  updateShortcutLabels();
});
document.querySelectorAll('[data-shortcut]').forEach((button) => button.addEventListener('click', () => {
  recordingShortcut = button.dataset.shortcut;
  updateShortcutLabels();
}));
document.addEventListener('keydown', (event) => {
  if (recordingShortcut) {
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
    const combination = canonicalShortcut(event);
    if (!event.ctrlKey && !event.altKey) {
      recordingShortcut = null;
      updateShortcutLabels();
      return;
    }
    const conflict = Object.keys(shortcuts).find((key) => key !== recordingShortcut && shortcuts[key] === combination);
    if (conflict) {
      $('#shortcutError').textContent = `That shortcut is already assigned to ${conflict}. Choose another combination.`;
      $('#shortcutError').classList.remove('hidden');
      recordingShortcut = null;
      updateShortcutLabels();
      return;
    }
    shortcuts[recordingShortcut] = combination;
    saveLocal('keyboardShortcuts', shortcuts);
    $('#shortcutError').classList.add('hidden');
    recordingShortcut = null;
    updateShortcutLabels();
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape' && !$('#shortcutModal').classList.contains('hidden')) {
    $('#shortcutModal').classList.add('hidden');
    return;
  }
  if (!$('#shortcutModal').classList.contains('hidden')) return;
  const combination = canonicalShortcut(event);
  const action = Object.keys(shortcuts).find((key) => shortcuts[key] === combination);
  if (!action) return;
  event.preventDefault();
  if (action === 'download') { goToView('download'); urlInput.focus(); }
  if (action === 'search') { goToView('search'); $('#searchInput').focus(); }
  if (action === 'browser') { goToView('browser'); $('#browserAddress').focus(); }
  if (action === 'activity') goToView('activity');
});
$('#clearDownloadsButton').addEventListener('click', () => {
  finishedDownloads = [];
  saveLocal('finishedDownloads', finishedDownloads);
  renderDownloadActivity();
});

$('#installButton').addEventListener('click', async () => {
  clearError();
  const button = $('#installButton');
  button.disabled = true;
  button.textContent = 'PLEASE WAIT';
  const result = await window.downloader.installYtDlp();
  if (!result.ok) {
    button.disabled = false;
    button.textContent = 'TRY AGAIN';
    showError(result.error || 'Setup could not be completed. Check your internet connection and try again.');
  } else {
    setupPanel.querySelector('strong').textContent = 'All set. yt-dlp is installed.';
    updateStatus(result);
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  runDownload(urlInput.value.trim(), urlInput.value.trim());
});

$('#cancelButton').addEventListener('click', async () => {
  await window.downloader.cancelDownload();
  progressTitle.textContent = 'Download cancelled';
  progressDetail.textContent = 'You can start another download whenever you’re ready.';
});

window.downloader.getStatus().then(updateStatus).catch(() => {
  toolStatus.className = 'tool-status missing';
  toolStatus.querySelector('span').textContent = 'Unable to check setup';
});
renderDownloadActivity();
renderBrowser();
