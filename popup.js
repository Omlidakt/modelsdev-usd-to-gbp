const $ = (id) => document.getElementById(id);

function fmtTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString();
}

function setError(msg) {
  $("error").textContent = msg || "";
}

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => resolve(resp));
  });
}

async function refreshUI() {
  setError("");

  const rateResp = await send({ type: "getRate" });
  if (!rateResp?.ok) {
    $("effectiveRate").textContent = "—";
    $("modeInfo").textContent = "Could not fetch rate.";
    return;
  }

  $("effectiveRate").textContent = String(rateResp.rate);
  $("modeInfo").textContent =
    rateResp.mode === "custom"
      ? "Mode: custom"
      : `Mode: live (updated: ${fmtTime(rateResp.updatedAt)})`;

  const settings = await send({ type: "getSettings" });
  if (settings?.ok) {
    $("customRate").value = settings.customRate ?? "";
  }
}

$("saveCustom").addEventListener("click", async () => {
  setError("");
  const rate = Number($("customRate").value);
  if (!isFinite(rate) || rate <= 0) {
    setError("Enter a valid custom rate (e.g. 0.79).");
    return;
  }
  const resp = await send({ type: "setCustomRate", rate });
  if (!resp?.ok) setError(resp?.error || "Failed to save custom rate.");
  await refreshUI();
});

$("useLive").addEventListener("click", async () => {
  setError("");
  const resp = await send({ type: "useLiveRate" });
  if (!resp?.ok) setError(resp?.error || "Failed to switch to live rate.");
  await refreshUI();
});

refreshUI();