/**
 * [FORK] Runtime-перевод UI в DOM по словарю (update-safe: компоненты не трогаем).
 * Переводим только nodeValue текстовых узлов и значения атрибутов
 * (placeholder/title/aria-label/alt). Код, терминал, подсветку и контент
 * сообщений (.MarkdownContent) исключаем, чтобы не ломать содержимое.
 *
 * Переключение языка делается перезагрузкой страницы (надёжно и просто),
 * поэтому движок только включает перевод; «откат» не требуется.
 */
import { RU } from './dictionary';

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

// Не переводим внутри этих контейнеров (код/терминал/подсветка/сообщения/ввод)
const BLOCK_SELECTOR =
  '.cm-editor,.xterm,.shiki,pre,code,script,style,noscript,[data-no-i18n],[class*="MarkdownContent"]';

let observer: MutationObserver | null = null;
let active = false;

function lookup(raw: string): string | undefined {
  const trimmed = raw.trim();

  if (!trimmed) {
    return undefined;
  }

  const hit = RU[trimmed];

  return hit && hit !== trimmed ? hit : undefined;
}

function isBlocked(el: Element | null): boolean {
  return !!el && !!el.closest(BLOCK_SELECTOR);
}

function translateTextNode(node: Text): void {
  const value = node.nodeValue;

  if (!value || isBlocked(node.parentElement)) {
    return;
  }

  const translated = lookup(value);

  if (!translated) {
    return;
  }

  // Сохраняем ведущие/замыкающие пробелы исходного узла
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  node.nodeValue = leading + translated + trailing;
}

function translateAttributes(el: Element): void {
  if (isBlocked(el)) {
    return;
  }

  for (const attr of ATTRS) {
    const value = el.getAttribute(attr);

    if (!value) {
      continue;
    }

    const translated = lookup(value);

    if (translated) {
      el.setAttribute(attr, translated);
    }
  }
}

function translateTree(root: Node): void {
  if (root.nodeType === Node.ELEMENT_NODE) {
    const el = root as Element;

    if (el.matches('[placeholder],[title],[aria-label],[alt]')) {
      translateAttributes(el);
    }

    el.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(translateAttributes);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();

  while (current) {
    translateTextNode(current as Text);
    current = walker.nextNode();
  }
}

function handleMutations(mutations: MutationRecord[]): void {
  if (!observer) {
    return;
  }

  // На время своих правок отключаем наблюдатель, чтобы не ловить собственные мутации
  observer.disconnect();

  try {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
        translateTextNode(mutation.target as Text);
      } else if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
        translateAttributes(mutation.target as Element);
      } else if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            translateTextNode(node as Text);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            translateTree(node);
          }
        });
      }
    }
  } finally {
    if (active) {
      startObserver();
    }
  }
}

function startObserver(): void {
  if (!observer) {
    observer = new MutationObserver(handleMutations);
  }

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

export function activateI18n(): void {
  if (active || typeof document === 'undefined' || !document.body) {
    return;
  }

  active = true;
  translateTree(document.body);
  startObserver();
}
