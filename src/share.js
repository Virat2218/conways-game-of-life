// The "Share & save" dialog: DOM only. It shows what Transfer reports and passes
// the user's choices on; every decision about the board is made in transfer.js.

import { previewPath } from './patterns.js';

// Largest file read for an import; a bigger one is refused before it is read.
export const MAX_IMPORT_BYTES = 262144;

const svgNS = 'http://www.w3.org/2000/svg';

export class ShareDialog {
  // actions: { save, loadSaved, savedInfo, exportRLE, link, parseImport, loadImport, stampImport }
  // each returning the Transfer result objects, plus say(text) for the live region.
  constructor(root, actions) {
    this.actions = actions;
    const $ = (id) => root.getElementById(id);
    this.el = {
      dialog: $('share'),
      open: $('share-open'),
      close: $('share-close'),
      message: $('share-message'),
      error: $('share-error'),
      saved: $('share-saved'),
      save: $('share-save'),
      loadSaved: $('share-load-saved'),
      exportRle: $('share-export'),
      importOpen: $('share-import'),
      link: $('share-link'),
      fallback: $('share-link-fallback'),
      field: $('share-link-field'),
      file: $('import-file'),
      text: $('import-text'),
      review: $('import-review'),
      back: $('import-back'),
      reviewTitle: $('review-title'),
      reviewPreview: $('review-preview'),
      reviewMeta: $('review-meta'),
      reviewLoad: $('review-load'),
      reviewStamp: $('review-stamp'),
      reviewCancel: $('review-cancel'),
    };
    this.views = [...this.el.dialog.querySelectorAll('[data-view]')];
    // The parsed pattern waiting for the user's choice, and where to go back to.
    this.pending = null;
    this.bind();
  }

  bind() {
    const { el, actions } = this;
    el.open.addEventListener('click', () => this.show());
    el.close.addEventListener('click', () => el.dialog.close());
    el.dialog.addEventListener('click', (e) => {
      if (e.target === el.dialog) el.dialog.close();
    });
    el.dialog.addEventListener('close', () => el.open.focus());

    el.save.addEventListener('click', () => {
      this.report(actions.save());
      this.refreshSaved();
    });
    el.loadSaved.addEventListener('click', () => {
      const result = actions.loadSaved();
      this.report(result);
      if (result.ok) el.dialog.close();
    });
    el.exportRle.addEventListener('click', () => {
      const result = actions.exportRLE();
      if (!result.ok) return this.report(result);
      this.download(result.text, result.filename);
      this.report({ ok: true, message: `Downloaded ${result.filename}: ${result.pattern.cells.length.toLocaleString('en-US')} live cells.` });
    });
    el.link.addEventListener('click', () => this.copyLink());
    el.field.addEventListener('focus', () => el.field.select());

    el.importOpen.addEventListener('click', () => this.showView('import'));
    el.back.addEventListener('click', () => this.showView('menu'));
    el.review.addEventListener('click', () => this.reviewImport());
    el.reviewCancel.addEventListener('click', () => {
      const from = this.pending?.from;
      this.pending = null;
      // A link offer has nowhere to go back to; an import returns to its form.
      if (from === 'link') el.dialog.close();
      else this.showView('import');
    });
    el.reviewLoad.addEventListener('click', () => this.finish('load'));
    el.reviewStamp.addEventListener('click', (e) => this.finish('stamp', e.detail === 0));
  }

  show() {
    this.clear();
    this.showView('menu');
    this.refreshSaved();
    if (!this.el.dialog.open) this.el.dialog.showModal();
  }

  // Offers a pattern that arrived from outside (a share link) for review.
  offer(pattern, name, from = 'link') {
    this.clear();
    this.pending = { pattern, name, from };
    this.showReview();
    if (!this.el.dialog.open) this.el.dialog.showModal();
  }

  showView(name) {
    for (const view of this.views) view.hidden = view.dataset.view !== name;
    this.clear();
    const target = { menu: this.el.save, import: this.el.text, review: this.el.reviewLoad }[name];
    target?.focus();
  }

  clear() {
    this.el.message.textContent = '';
    this.el.error.hidden = true;
    this.el.error.textContent = '';
    this.el.fallback.hidden = true;
  }

  // Successes are spoken politely, failures as alerts; neither blocks the dialog.
  report(result) {
    this.clear();
    if (result.ok) {
      this.el.message.textContent = result.message ?? '';
    } else {
      this.el.error.textContent = result.message;
      this.el.error.hidden = false;
    }
  }

  refreshSaved() {
    const info = this.actions.savedInfo();
    const { saved, loadSaved } = this.el;
    if (info.state === 'ok') {
      const when = info.savedAt ? new Date(info.savedAt).toLocaleString() : 'earlier';
      saved.textContent = `Saved ${when}: generation ${info.generation.toLocaleString('en-US')}, ${info.population.toLocaleString('en-US')} live cells.`;
    } else if (info.state === 'error') {
      saved.textContent = info.message;
    } else {
      saved.textContent = 'Nothing saved yet.';
    }
    // Stay focusable, like the other unavailable buttons, but say why.
    if (info.state === 'ok') loadSaved.removeAttribute('aria-disabled');
    else loadSaved.setAttribute('aria-disabled', 'true');
  }

  // --- Import -------------------------------------------------------------------

  async reviewImport() {
    const { file, text } = this.el;
    let source = text.value;
    const chosen = file.files?.[0];
    if (chosen) {
      if (chosen.size > MAX_IMPORT_BYTES) {
        return this.report({ ok: false, message: `That file is ${Math.ceil(chosen.size / 1024).toLocaleString('en-US')} KiB; the limit is ${MAX_IMPORT_BYTES / 1024} KiB. Nothing was imported.` });
      }
      try {
        source = await chosen.text();
      } catch {
        return this.report({ ok: false, message: 'The file could not be read. Nothing was imported.' });
      }
    }
    const result = this.actions.parseImport(source);
    if (!result.ok) return this.report({ ok: false, message: `${result.message} Nothing was imported and your board is unchanged.` });
    const name = chosen ? chosen.name.replace(/\.[^.]*$/, '') || 'Imported pattern' : 'Imported pattern';
    this.pending = { pattern: result.pattern, name, from: 'import' };
    this.showReview();
  }

  showReview() {
    const { pattern, name } = this.pending;
    const { reviewTitle, reviewPreview, reviewMeta } = this.el;
    reviewTitle.textContent = name;
    reviewPreview.replaceChildren();
    reviewPreview.setAttribute('viewBox', `-1 -1 ${pattern.width + 2} ${pattern.height + 2}`);
    reviewPreview.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', previewPath(pattern));
    reviewPreview.append(path);
    reviewMeta.textContent = `${pattern.cells.length.toLocaleString('en-US')} live cells, ${pattern.width} × ${pattern.height}.`;
    this.showView('review');
  }

  finish(mode, keyboard = false) {
    const { pattern, name } = this.pending;
    this.pending = null;
    this.el.dialog.close();
    if (mode === 'load') this.actions.loadImport(pattern, name);
    else this.actions.stampImport(pattern, name, { keyboard });
  }

  // --- Export and links ---------------------------------------------------------------

  download(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async copyLink() {
    const result = this.actions.link();
    if (!result.ok) return this.report(result);
    this.report({ ok: true, message: '' });
    try {
      await navigator.clipboard.writeText(result.url);
      this.report({ ok: true, message: 'Share link copied.' });
    } catch {
      // Clipboard blocked or unavailable: leave the link selected for the user to copy.
      this.report({ ok: true, message: 'The browser would not copy it for you. Select the link below and copy it.' });
      this.el.field.value = result.url;
      this.el.fallback.hidden = false;
      this.el.field.focus();
    }
  }
}
