const DEFAULT_BACKEND_URL = "http://127.0.0.1:8765";

const backendUrlInput = document.getElementById("backendUrl");
const notebookIdInput = document.getElementById("notebookId");
const notebookTitleInput = document.getElementById("notebookTitle");
const sourceModeInput = document.getElementById("sourceMode");
const includeSelectionInput = document.getElementById("includeSelectionFirst");
const sendButton = document.getElementById("sendButton");
const statusNode = document.getElementById("status");

function setStatus(message, variant = "") {
  statusNode.textContent = message;
  statusNode.className = `status ${variant}`.trim();
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "backendUrl",
    "defaultNotebookId",
    "defaultNotebookTitle",
    "includeSelectionFirst",
    "sourceMode"
  ]);

  backendUrlInput.value = stored.backendUrl || DEFAULT_BACKEND_URL;
  notebookIdInput.value = stored.defaultNotebookId || "";
  notebookTitleInput.value = stored.defaultNotebookTitle || "";
  sourceModeInput.value = stored.sourceMode || "text";
  includeSelectionInput.checked = stored.includeSelectionFirst !== false;
}

async function saveSettings() {
  await chrome.storage.local.set({
    backendUrl: backendUrlInput.value.trim() || DEFAULT_BACKEND_URL,
    defaultNotebookId: notebookIdInput.value.trim(),
    defaultNotebookTitle: notebookTitleInput.value.trim(),
    sourceMode: sourceModeInput.value,
    includeSelectionFirst: includeSelectionInput.checked
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) {
    throw new Error("No active tab found.");
  }
  return tabs[0];
}

async function extractCurrentPage(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE" });
  if (!response?.ok) {
    throw new Error(response?.error || "Could not extract content from the page.");
  }
  return response.payload;
}

async function sendCurrentPage() {
  sendButton.disabled = true;
  setStatus("Extracting the current page...");

  try {
    await saveSettings();
    const tab = await getActiveTab();
    const extracted = await extractCurrentPage(tab.id);
    setStatus("Sending page to the local NotebookLM bridge...");

    const response = await fetch(`${backendUrlInput.value.trim() || DEFAULT_BACKEND_URL}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...extracted,
        notebookId: notebookIdInput.value.trim(),
        notebookTitle: notebookTitleInput.value.trim(),
        sourceMode: sourceModeInput.value,
        includeSelectionFirst: includeSelectionInput.checked
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Backend error: ${response.status}`);
    }

    const details = data.notebookId ? ` Notebook: ${data.notebookId}.` : "";
    setStatus(`${data.message || "Page captured successfully."}${details}`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    sendButton.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  setStatus("Ready to capture this tab.");
});

sendButton.addEventListener("click", sendCurrentPage);
