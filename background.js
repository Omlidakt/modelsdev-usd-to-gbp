const STORAGE_KEYS = {
  mode: "mode",
  customRate: "customRate",
  liveRate: "liveRate",
  liveRateUpdatedAt: "liveRateUpdatedAt"
};

const DEFAULTS = {
  mode: "live",
  customRate: 0.79
};

async function fetchLiveRate() {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
  if (!res.ok) throw new Error(`Rate fetch failed: ${res.status}`);
  const data = await res.json();
  const rate = data?.rates?.GBP;
  if (typeof rate !== "number" || !isFinite(rate)) {
    throw new Error("GBP rate missing/invalid in API response");
  }
  return rate;
}

async function getSettings() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.mode,
    STORAGE_KEYS.customRate,
    STORAGE_KEYS.liveRate,
    STORAGE_KEYS.liveRateUpdatedAt
  ]);

  return {
    mode: stored[STORAGE_KEYS.mode] ?? DEFAULTS.mode,
    customRate: stored[STORAGE_KEYS.customRate] ?? DEFAULTS.customRate,
    liveRate: stored[STORAGE_KEYS.liveRate] ?? null,
    liveRateUpdatedAt: stored[STORAGE_KEYS.liveRateUpdatedAt] ?? null
  };
}

async function ensureLiveRateFresh(maxAgeMs = 24 * 60 * 60 * 1000) {
  const { liveRate, liveRateUpdatedAt } = await getSettings();
  const now = Date.now();

  const isFresh =
    typeof liveRate === "number" &&
    isFinite(liveRate) &&
    typeof liveRateUpdatedAt === "number" &&
    now - liveRateUpdatedAt < maxAgeMs;

  if (isFresh) return { rate: liveRate, updatedAt: liveRateUpdatedAt };

  const rate = await fetchLiveRate();
  const updatedAt = Date.now();

  await chrome.storage.local.set({
    [STORAGE_KEYS.liveRate]: rate,
    [STORAGE_KEYS.liveRateUpdatedAt]: updatedAt
  });

  return { rate, updatedAt };
}

async function getEffectiveRate() {
  const s = await getSettings();

  if (s.mode === "custom") {
    const r = Number(s.customRate);
    if (isFinite(r) && r > 0) return { rate: r, mode: "custom", updatedAt: null };
  }

  const { rate, updatedAt } = await ensureLiveRateFresh();
  return { rate, mode: "live", updatedAt };
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    [STORAGE_KEYS.mode]: DEFAULTS.mode,
    [STORAGE_KEYS.customRate]: DEFAULTS.customRate
  });

  try {
    await ensureLiveRateFresh(0);
  } catch (_) {}

  chrome.alarms.create("refreshRate", { periodInMinutes: 720 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "refreshRate") return;
  try {
    await ensureLiveRateFresh(0);
  } catch (_) {}
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "getRate") {
        const eff = await getEffectiveRate();
        sendResponse({ ok: true, ...eff });
        return;
      }

      if (msg?.type === "setCustomRate") {
        const rate = Number(msg.rate);
        if (!isFinite(rate) || rate <= 0) throw new Error("Invalid custom rate");
        await chrome.storage.local.set({
          [STORAGE_KEYS.mode]: "custom",
          [STORAGE_KEYS.customRate]: rate
        });
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "useLiveRate") {
        await chrome.storage.local.set({ [STORAGE_KEYS.mode]: "live" });
        try {
          await ensureLiveRateFresh(0);
        } catch (_) {}
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "getSettings") {
        const s = await getSettings();
        sendResponse({ ok: true, ...s });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  return true;
});