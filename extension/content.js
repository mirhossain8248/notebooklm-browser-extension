function normalizeWhitespace(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function isProbablyHidden(element) {
  if (!(element instanceof Element)) {
    return true;
  }

  if (
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true" ||
    element.getAttribute("inert") !== null
  ) {
    return true;
  }

  const style = window.getComputedStyle(element);
  return style.display === "none" || style.visibility === "hidden";
}

function isBadContainer(element) {
  if (!(element instanceof Element)) {
    return true;
  }

  const markerText = `${element.id || ""} ${element.className || ""} ${element.getAttribute("role") || ""}`.toLowerCase();
  const badMarkers = [
    "modal",
    "dialog",
    "popover",
    "tooltip",
    "toast",
    "banner",
    "navigation",
    "nav",
    "footer",
    "sidebar",
    "drawer",
    "menu",
    "overlay",
    "cookie",
    "consent"
  ];

  return badMarkers.some((marker) => markerText.includes(marker));
}

function removeNoise(root) {
  root.querySelectorAll(
    [
      "script",
      "style",
      "noscript",
      "iframe",
      "svg",
      "canvas",
      "form",
      "nav",
      "aside",
      "footer",
      "[role='dialog']",
      "[role='alertdialog']",
      "[aria-hidden='true']",
      "[hidden]",
      "[inert]"
    ].join(", ")
  ).forEach((node) => {
    node.remove();
  });

  root.querySelectorAll("*").forEach((node) => {
    if (isBadContainer(node)) {
      node.remove();
    }
  });
}

function getOwnTextLength(element) {
  const text = normalizeWhitespace(element.innerText || "");
  return text.length;
}

function scoreCandidate(element) {
  if (!element || isProbablyHidden(element) || isBadContainer(element)) {
    return 0;
  }

  const textLength = getOwnTextLength(element);
  if (textLength < 150) {
    return 0;
  }

  const paragraphCount = element.querySelectorAll("p").length;
  const headingCount = element.querySelectorAll("h1, h2, h3").length;
  const listItemCount = element.querySelectorAll("li").length;
  const badChildren = element.querySelectorAll("[role='dialog'], [aria-hidden='true'], [hidden]").length;

  return textLength + paragraphCount * 250 + headingCount * 120 + listItemCount * 40 - badChildren * 500;
}

function pickReadableRoot() {
  const selectors = [
    "article",
    "main",
    "[role='main']",
    ".article",
    ".article-body",
    ".article-content",
    ".content",
    ".main-content",
    ".post",
    ".entry-content",
    ".slds-rich-text-editor__output",
    ".topic-body",
    ".knowledgeArticleBody"
  ];

  const candidates = [...document.querySelectorAll(selectors.join(", "))].filter((element) => {
    return !isProbablyHidden(element) && !isBadContainer(element);
  });

  if (!candidates.length) {
    return document.body;
  }

  return candidates.reduce((best, current) => {
    return scoreCandidate(current) > scoreCandidate(best) ? current : best;
  }, candidates[0]);
}

function cleanClone(root) {
  const clone = root.cloneNode(true);
  removeNoise(clone);
  return clone;
}

function textFromElement(element) {
  return normalizeWhitespace(element.innerText || element.textContent || "");
}

function buildMarkdown(root) {
  const lines = [];
  const elements = root.querySelectorAll("h1, h2, h3, p, li, blockquote, pre");

  elements.forEach((element) => {
    if (isBadContainer(element)) {
      return;
    }

    const text = textFromElement(element);
    if (!text || text.length < 2) {
      return;
    }

    if (element.matches("h1")) {
      lines.push(`# ${text}`);
      return;
    }

    if (element.matches("h2")) {
      lines.push(`## ${text}`);
      return;
    }

    if (element.matches("h3")) {
      lines.push(`### ${text}`);
      return;
    }

    if (element.matches("li")) {
      lines.push(`- ${text}`);
      return;
    }

    if (element.matches("blockquote")) {
      lines.push(`> ${text}`);
      return;
    }

    if (element.matches("pre")) {
      lines.push("```");
      lines.push(text);
      lines.push("```");
      return;
    }

    lines.push(text);
  });

  return lines.join("\n\n").trim();
}

function extractPlainText(root) {
  const pieces = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!(node instanceof Element) || isBadContainer(node) || isProbablyHidden(node)) {
      continue;
    }

    if (!node.matches("h1, h2, h3, p, li, blockquote, pre")) {
      continue;
    }

    const text = textFromElement(node);
    if (text) {
      pieces.push(text);
    }
  }

  return normalizeWhitespace(pieces.join("\n\n"));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "EXTRACT_PAGE") {
    return false;
  }

  try {
    const root = pickReadableRoot();
    const cleaned = cleanClone(root);
    const markdown = buildMarkdown(cleaned);
    const plainText = extractPlainText(cleaned);
    const selectedText = window.getSelection ? normalizeWhitespace(window.getSelection().toString()) : "";
    const description =
      document.querySelector("meta[name='description']")?.content ||
      document.querySelector("meta[property='og:description']")?.content ||
      "";

    sendResponse({
      ok: true,
      payload: {
        title: document.title || "Untitled page",
        url: window.location.href,
        description: normalizeWhitespace(description),
        selectedText,
        textContent: plainText,
        markdown,
        capturedAt: new Date().toISOString(),
        language: document.documentElement.lang || ""
      }
    });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return true;
});
