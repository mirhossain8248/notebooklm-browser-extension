const DEFAULT_BACKEND_URL = "http://127.0.0.1:8765";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "send-page-to-notebooklm",
    title: "Send page to NotebookLM",
    contexts: ["page", "selection"]
  });
});

async function getSettings() {
  const stored = await chrome.storage.local.get([
    "backendUrl",
    "defaultNotebookId",
    "defaultNotebookTitle",
    "includeSelectionFirst",
    "sourceMode"
  ]);

  return {
    backendUrl: stored.backendUrl || DEFAULT_BACKEND_URL,
    defaultNotebookId: stored.defaultNotebookId || "",
    defaultNotebookTitle: stored.defaultNotebookTitle || "",
    includeSelectionFirst: stored.includeSelectionFirst !== false,
    sourceMode: stored.sourceMode || "text"
  };
}

async function extractFromTab(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE" });
  if (!response || !response.ok) {
    throw new Error(response?.error || "Could not extract page content.");
  }
  return response.payload;
}

async function postToBackend(payload, settings) {
  const response = await fetch(`${settings.backendUrl}/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...payload,
      notebookId: settings.defaultNotebookId,
      notebookTitle: settings.defaultNotebookTitle,
      sourceMode: settings.sourceMode,
      includeSelectionFirst: settings.includeSelectionFirst
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Backend error: ${response.status}`);
  }

  return data;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "send-page-to-notebooklm" || !tab?.id) {
    return;
  }

  try {
    const settings = await getSettings();
    const extracted = await extractFromTab(tab.id);
    await postToBackend(
      {
        ...extracted,
        selectedText: info.selectionText || extracted.selectedText || ""
      },
      settings
    );
  } catch (error) {
    console.error("NotebookLM context menu send failed:", error);
  }
});
