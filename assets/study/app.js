import { CONFIG } from './config.js';
import { formatBytes, makeItem, validateSelection } from './validate.js';
import { describeError, generateStudyPack } from './api.js';
import { packToMarkdown, renderPack } from './render.js';

const root = document.getElementById('study-app');
if (root) init(root);

function init(app) {
  const $ = (id) => document.getElementById(id);

  const ui = {
    configWarning: $('config-warning'),
    docsLink: $('docs-link'),
    dropzone: $('dropzone'),
    fileInput: $('file-input'),
    dropzoneStatus: $('dropzone-status'),
    clearButton: $('clear-button'),
    fileList: $('file-list'),
    fileListEmpty: $('file-list-empty'),
    confirmPanel: $('confirm-panel'),
    confirmCheckbox: $('confirm-checkbox'),
    generateButton: $('generate-button'),
    resetButton: $('reset-button'),
    statusText: $('status-text'),
    progress: $('progress'),
    progressBar: $('progress-bar'),
    errorBox: $('error-box'),
    errorMessage: $('error-message'),
    errorHint: $('error-hint'),
    retryButton: $('retry-button'),
    cancelButton: $('cancel-button'),
    resultSection: $('result-section'),
    resultMeta: $('result-meta'),
    resultRoot: $('result-root'),
    copyButton: $('copy-button'),
    newButton: $('new-button'),
    lastResult: $('last-result'),
    showLastButton: $('show-last-button'),
  };

  const state = {
    items: [],
    working: false,
    pack: null,
    meta: null,
    abort: null,
  };

  const selectionErrors = document.createElement('ul');
  selectionErrors.className = 'selection-errors';
  selectionErrors.id = 'selection-errors';
  selectionErrors.hidden = true;
  ui.fileListEmpty.after(selectionErrors);

  // —— 初始化文案与限制 ——
  fillLimits();
  if (!CONFIG.apiBase) {
    ui.configWarning.hidden = false;
    if (ui.docsLink && CONFIG.docsUrl) ui.docsLink.href = CONFIG.docsUrl;
    ui.generateButton.textContent = '后端未配置';
  }

  function fillLimits() {
    for (const [id, value] of [
      ['max-files-label', CONFIG.maxFiles],
      ['max-count-label', CONFIG.maxFiles],
      ['max-size-label', formatBytes(CONFIG.maxFileBytes)],
      ['max-total-label', formatBytes(CONFIG.maxTotalBytes)],
    ]) {
      const node = $(id);
      if (node) node.textContent = String(value);
    }
    ui.fileInput.accept = CONFIG.formats.map((format) => `.${format.ext}`).join(',');
  }

  // —— 状态显示 ——
  function setStatus(message, tone = '') {
    ui.statusText.hidden = !message;
    ui.statusText.textContent = message || '';
    ui.statusText.className = `status-text${tone ? ` is-${tone}` : ''}`;
  }

  function showError(message, hint = '') {
    ui.errorMessage.textContent = message;
    ui.errorHint.textContent = hint || '';
    ui.errorHint.hidden = !hint;
    ui.errorBox.hidden = false;
  }

  function hideError() {
    ui.errorBox.hidden = true;
  }

  function setProgress(percent) {
    if (percent === null) {
      ui.progress.hidden = true;
      ui.progressBar.classList.remove('is-indeterminate');
      ui.progressBar.removeAttribute('aria-valuenow');
      ui.progressBar.style.width = '0%';
      return;
    }
    ui.progress.hidden = false;
    if (percent === 'indeterminate') {
      ui.progressBar.classList.add('is-indeterminate');
      ui.progressBar.removeAttribute('aria-valuenow');
      ui.progressBar.style.width = '';
      return;
    }
    ui.progressBar.classList.remove('is-indeterminate');
    ui.progressBar.setAttribute('aria-valuenow', String(percent));
    ui.progressBar.style.width = `${percent}%`;
  }

  function announce(message) {
    ui.dropzoneStatus.textContent = message;
  }

  // —— 文件列表 ——
  const STATUS_LABELS = {
    ready: '待生成',
    uploading: '处理中',
    done: '已完成',
    error: '失败',
  };

  function renderFiles() {
    ui.fileList.replaceChildren();

    for (const item of state.items) {
      const row = document.createElement('li');
      row.className = `file-row is-${item.status}`;
      row.dataset.id = item.id;

      const kind = document.createElement('span');
      kind.className = 'file-kind';
      kind.textContent = item.label;
      row.append(kind);

      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = item.file.name;
      name.title = item.file.name;
      row.append(name);

      const size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = formatBytes(item.size);
      row.append(size);

      const status = document.createElement('span');
      status.className = `file-status status-${item.status}`;
      status.textContent = STATUS_LABELS[item.status] || item.status;
      row.append(status);

      if (!state.working) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-button';
        remove.dataset.action = 'remove';
        remove.dataset.id = item.id;
        remove.setAttribute('aria-label', `移除 ${item.file.name}`);
        remove.textContent = '×';
        row.append(remove);
      }

      ui.fileList.append(row);
    }

    const hasFiles = state.items.length > 0;
    ui.fileListEmpty.hidden = hasFiles;
    ui.clearButton.hidden = !hasFiles || state.working;
    ui.confirmPanel.hidden = !hasFiles;
    ui.confirmCheckbox.disabled = state.working;
    ui.generateButton.disabled = !hasFiles || !ui.confirmCheckbox.checked || state.working || !CONFIG.apiBase;
    ui.fileInput.disabled = state.working;
    ui.dropzone.classList.toggle('is-disabled', state.working);
    ui.dropzone.setAttribute('aria-disabled', state.working ? 'true' : 'false');
  }

  function updateSummary() {
    if (!state.items.length) {
      setStatus('');
      return;
    }
    const total = state.items.reduce((sum, item) => sum + item.size, 0);
    setStatus(`已选择 ${state.items.length} 个文件，合计 ${formatBytes(total)}。`, '');
  }

  function showSelectionErrors(errors) {
    selectionErrors.replaceChildren();
    if (!errors.length) {
      selectionErrors.hidden = true;
      return;
    }
    for (const error of errors) {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = error.name;
      item.append(name, document.createTextNode(`：${error.message}`));
      selectionErrors.append(item);
    }
    selectionErrors.hidden = false;
  }

  function addFiles(fileList) {
    if (!fileList || !fileList.length || state.working) return;
    hideError();
    const { accepted, errors } = validateSelection(Array.from(fileList), state.items);
    showSelectionErrors(errors);
    for (const file of accepted) state.items.push(makeItem(file));
    ui.confirmCheckbox.checked = false;
    renderFiles();
    updateSummary();
    if (errors.length) {
      announce(`${accepted.length} 个文件已加入，${errors.length} 个被忽略。`);
    } else if (accepted.length) {
      announce(`${accepted.length} 个文件已加入。`);
    }
  }

  function clearFiles() {
    if (state.working) return;
    state.items = [];
    showSelectionErrors([]);
    hideError();
    setStatus('');
    setProgress(null);
    ui.confirmCheckbox.checked = false;
    renderFiles();
  }

  // —— 事件：选择与拖放 ——
  ui.fileInput.addEventListener('change', () => {
    addFiles(ui.fileInput.files);
    ui.fileInput.value = '';
  });

  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  for (const type of ['dragenter', 'dragover']) {
    ui.dropzone.addEventListener(type, (event) => {
      stop(event);
      if (!state.working) ui.dropzone.classList.add('is-dragover');
    });
  }
  ui.dropzone.addEventListener('dragleave', (event) => {
    stop(event);
    ui.dropzone.classList.remove('is-dragover');
  });
  ui.dropzone.addEventListener('drop', (event) => {
    stop(event);
    ui.dropzone.classList.remove('is-dragover');
    if (state.working) return;
    if (event.dataTransfer && event.dataTransfer.files) addFiles(event.dataTransfer.files);
  });

  ui.fileList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="remove"]');
    if (!button || state.working) return;
    state.items = state.items.filter((item) => item.id !== button.dataset.id);
    ui.confirmCheckbox.checked = false;
    renderFiles();
    updateSummary();
    announce('已移除一个文件。');
  });

  ui.clearButton.addEventListener('click', clearFiles);
  ui.resetButton.addEventListener('click', () => {
    if (state.working) return;
    clearFiles();
    ui.fileInput.focus();
  });

  ui.confirmCheckbox.addEventListener('change', () => {
    ui.generateButton.disabled = !ui.confirmCheckbox.checked || !state.items.length || state.working || !CONFIG.apiBase;
  });

  // —— 生成 ——
  ui.generateButton.addEventListener('click', startGeneration);
  ui.retryButton.addEventListener('click', startGeneration);
  ui.cancelButton.addEventListener('click', () => {
    if (state.abort) state.abort.abort();
  });

  async function startGeneration() {
    if (state.working || !state.items.length) return;
    if (!CONFIG.apiBase) {
      showError('AI 后端还没有配置。', '请先部署 worker/（Cloudflare Worker），再把地址填到 _config.yml 的 study_api_base。');
      return;
    }

    state.working = true;
    state.abort = new AbortController();
    hideError();
    ui.confirmCheckbox.disabled = true;
    ui.cancelButton.hidden = false;
    ui.lastResult.hidden = true;
    for (const item of state.items) item.status = 'uploading';
    renderFiles();
    ui.generateButton.disabled = true;
    setProgress(0);
    setStatus('正在上传文件…', 'working');

    try {
      const result = await generateStudyPack({
        files: state.items,
        signal: state.abort.signal,
        onProgress: (percent) => {
          setProgress(percent);
          if (percent >= 100) {
            setProgress('indeterminate');
            setStatus('已上传，AI 正在生成课件，通常需要几十秒……', 'working');
          } else {
            setStatus(`正在上传文件 ${percent}%……`, 'working');
          }
        },
      });

      state.pack = result.pack;
      state.meta = result.meta;
      for (const item of state.items) item.status = 'done';
      renderFiles();
      renderResult();
      setProgress(null);
      setStatus('课件已生成。', 'success');
      ui.lastResult.hidden = true;
      ui.resultSection.hidden = false;
      ui.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        for (const item of state.items) item.status = 'ready';
        setStatus('已取消本次生成。', '');
      } else {
        const { message, hint } = describeError(error);
        for (const item of state.items) item.status = 'error';
        setStatus('生成失败。', 'error');
        showError(message, hint);
      }
      setProgress(null);
      renderFiles();
    } finally {
      state.working = false;
      state.abort = null;
      ui.cancelButton.hidden = true;
      ui.confirmCheckbox.disabled = false;
      renderFiles();
    }
  }

  function renderResult() {
    const { pack, meta } = state;
    if (!pack) return;
    const sections = Array.isArray(pack.sections) ? pack.sections.length : 0;
    const terms = Array.isArray(pack.glossary) ? pack.glossary.length : 0;
    const quiz = Array.isArray(pack.quiz) ? pack.quiz.length : 0;
    ui.resultMeta.textContent = `共 ${sections} 个章节、${terms} 个词汇、${quiz} 道练习。`;
    renderPack(ui.resultRoot, pack, meta);
  }

  ui.copyButton.addEventListener('click', async () => {
    if (!state.pack) return;
    const text = packToMarkdown(state.pack);
    const original = ui.copyButton.textContent;
    try {
      await navigator.clipboard.writeText(text);
      ui.copyButton.textContent = '已复制';
    } catch (error) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      try {
        document.execCommand('copy');
        ui.copyButton.textContent = '已复制';
      } catch (fallbackError) {
        ui.copyButton.textContent = '复制失败';
      }
      area.remove();
    }
    window.setTimeout(() => {
      ui.copyButton.textContent = original;
    }, 1800);
  });

  ui.newButton.addEventListener('click', () => {
    clearFiles();
    ui.resultSection.hidden = true;
    ui.lastResult.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  ui.showLastButton.addEventListener('click', (event) => {
    event.preventDefault();
    ui.resultSection.hidden = false;
    ui.lastResult.hidden = true;
    ui.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  renderFiles();
}
