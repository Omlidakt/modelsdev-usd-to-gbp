const PROCESSED_ATTR = "data-usdgbp-processed";
const USD_REGEX = /\$([ \t]*)(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?/g;

function formatGBP(value) {
  return "£" + value.toFixed(2);
}

function convertText(text, rate) {
  let changed = false;

  const out = text.replace(USD_REGEX, (match, ws, intPart, decPart) => {
    const numStr = (intPart + (decPart || "")).replace(/,/g, "");
    const usd = Number(numStr);
    if (!isFinite(usd)) return match;

    changed = true;
    const gbp = usd * rate;
    return formatGBP(gbp);
  });

  return { out, changed };
}

function shouldSkipNode(node) {
  const parent = node.parentElement;
  if (!parent) return true;

  const tag = parent.tagName?.toLowerCase();
  if (!tag) return true;

  if (
    tag === "script" ||
    tag === "style" ||
    tag === "textarea" ||
    tag === "input" ||
    tag === "code" ||
    tag === "pre"
  ) return true;

  if (parent.isContentEditable) return true;

  return false;
}

function walkAndConvert(root, rate) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.includes("$")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const touchedParents = new Set();

  let node;
  while ((node = walker.nextNode())) {
    const { out, changed } = convertText(node.nodeValue, rate);
    if (changed) {
      node.nodeValue = out;
      if (node.parentElement) touchedParents.add(node.parentElement);
    }
  }

  for (const el of touchedParents) {
    el.setAttribute(PROCESSED_ATTR, "1");
  }
}

function getRateFromBackground() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "getRate" }, (resp) => {
      if (!resp?.ok) resolve(null);
      else resolve(resp);
    });
  });
}

async function run() {
  const rateInfo = await getRateFromBackground();
  if (!rateInfo?.rate) return;

  walkAndConvert(document.body, rateInfo.rate);

  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        walkAndConvert(node, rateInfo.rate);
      }
    }
  });

  obs.observe(document.body, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener(() => {
    location.reload();
  });
}

run();