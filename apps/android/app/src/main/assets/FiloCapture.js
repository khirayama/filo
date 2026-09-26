// Text capture for the reading browser. Evaluated after Readability.js.
// Kept identical in apps/android/app/src/main/assets and apps/ios/Filo/Resources;
// the extension's apps/extension/src/content.ts implements the same rules.
(() => {
  if (window.__filoCapture) return;
  const MIN_TEXT_LENGTH = 100;
  const BLOCK_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'BLOCKQUOTE', 'PRE', 'FIGCAPTION', 'DT', 'DD']);
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const withTitle = (title, lines) => [title, ...(lines[0] === title ? lines.slice(1) : lines)].filter(Boolean).join('\n');
  const pageLanguage = () => document.documentElement.lang || null;

  // The rendered text of the page's main container.
  const displayedText = () => {
    const root = document.querySelector('article') || document.querySelector('main') || document.body;
    if (!root) return '';
    const lines = [];
    for (const line of root.innerText.split(/\n+/)) {
      const value = normalize(line);
      if (value && value !== lines[lines.length - 1]) lines.push(value);
    }
    return withTitle(normalize(document.title), lines);
  };

  const extractedText = () => {
    const article = new Readability(document.cloneNode(true), { charThreshold: MIN_TEXT_LENGTH }).parse();
    if (!article) return { text: '', lang: null };
    const root = document.implementation.createHTMLDocument('').body;
    root.innerHTML = article.content || '';
    const lines = [];
    const visit = (node) => Array.from(node.children).forEach((child) => {
      if (BLOCK_TAGS.has(child.tagName)) {
        const value = normalize(child.textContent);
        if (value) lines.push(value);
      } else {
        visit(child);
      }
    });
    visit(root);
    if (!lines.length) lines.push(...String(article.textContent || '').split(/\n+/).map(normalize).filter(Boolean));
    const title = normalize(article.title) || normalize(document.title);
    return { text: withTitle(title, lines), lang: article.lang || null };
  };

  // Displayed text first, Readability second. Returns null when neither yields
  // enough text; the app then falls back to the server's extraction.
  const capturePage = () => {
    const displayed = displayedText();
    if (displayed.length >= MIN_TEXT_LENGTH) return { text: displayed, lang: pageLanguage() };
    try {
      const extracted = extractedText();
      if (extracted.text.length >= MIN_TEXT_LENGTH) return { text: extracted.text, lang: extracted.lang || pageLanguage() };
    } catch (_) {
      // The page may still be mutating; the app retries once.
    }
    return null;
  };

  const captureSelection = () => {
    const text = normalize((window.getSelection() || '').toString());
    return text ? { text, lang: pageLanguage() } : null;
  };

  window.__filoCapture = (kind) => (kind === 'selection' ? captureSelection() : capturePage());
  window.__filoHasSelection = () => Boolean(normalize((window.getSelection() || '').toString()));
})();
