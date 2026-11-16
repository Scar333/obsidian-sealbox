// Browser review adapter, not a replacement Obsidian runtime. Uses real app.css.
function apply(el, opts = {}) {
  if (opts.cls) el.className = opts.cls;
  if (opts.text != null) el.textContent = opts.text;
  for (const k of ['type', 'placeholder']) if (opts[k]) el.setAttribute(k, opts[k]);
  return el;
}
HTMLElement.prototype.createEl = function(tag, opts) { const el = apply(document.createElement(tag), opts); this.append(el); return el; };
HTMLElement.prototype.createDiv = function(opts) { return this.createEl('div', opts); };
HTMLElement.prototype.createSpan = function(opts) { return this.createEl('span', opts); };
HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
HTMLElement.prototype.toggleClass = function(name, on) { this.classList.toggle(name, on); };
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.setText = function(text) { this.textContent = text; };
HTMLElement.prototype.hide = function() { this.style.display = 'none'; };
HTMLElement.prototype.show = function() { this.style.removeProperty('display'); };
HTMLElement.prototype.instanceOf = function(cls) { return this instanceof cls; };
export const Platform = { isMobile: false };
export class App {}
export class Notice { constructor(message) { (window.notices ??= []).push(message); } }
export class Modal {
  constructor(app) {
    this.app = app;
    this.containerEl = document.body.createDiv({cls:'modal-container'});
    this.containerEl.createDiv({cls:'modal-bg'});
    this.modalEl = this.containerEl.createDiv({cls:'modal'});
    this.modalEl.setAttribute('role','dialog');
    this.modalEl.setAttribute('aria-modal','true');
    this.modalEl.createEl('button',{cls:'modal-close-button',text:'×'}).onclick = () => this.close();
    this.titleEl = this.modalEl.createDiv({cls:'modal-title'});
    this.contentEl = this.modalEl.createDiv({cls:'modal-content'});
  }
  setTitle(text) { this.titleEl.textContent = text; }
  open() { this.onOpen(); }
  close() { this.onClose?.(); this.containerEl.remove(); }
}
export class FileView {
  constructor(leaf) { this.app=leaf.app; this.contentEl=document.body.createDiv(); }
}
export class TFile {}
export class WorkspaceLeaf {}
export const MarkdownRenderer = { async render(_app, text, el) { el.textContent = text; } };
