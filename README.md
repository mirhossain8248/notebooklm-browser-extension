# NotebookLM Browser Extension

This project gives you a simple Chrome extension plus a local Python bridge for capturing the readable content from the current page and pushing it into Google NotebookLM through [`notebooklm-py`](https://github.com/teng-lin/notebooklm-py).

## How it works

1. The Chrome extension extracts the readable content from the current tab.
2. The local bridge saves a Markdown copy on your machine.
3. The bridge uploads the extracted content to NotebookLM as pasted text, or adds the page URL, or both.

This keeps your NotebookLM authentication and saved content local to your machine.

## Project layout

```text
notebooklm-browser-extension/
├── extension/
│   ├── background.js
│   ├── content.js
│   ├── manifest.json
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
├── server/
│   ├── app.py
│   └── requirements.txt
└── .env.example
```

## Setup

### 1. Install the Python dependency

```bash
cd "/Users/mirhossain/Dev Stuff/notebooklm-browser-extension"
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
playwright install chromium
```

The `playwright` install step is required by the `notebooklm-py` login flow.

### 2. Authenticate `notebooklm-py`

```bash
source .venv/bin/activate
notebooklm login
```

That opens a browser so you can sign into the Google account you use for NotebookLM.

### 3. Start the local bridge

```bash
cd "/Users/mirhossain/Dev Stuff/notebooklm-browser-extension"
source .venv/bin/activate
cp .env.example .env
python server/app.py
```

The bridge listens on `http://127.0.0.1:8765` by default.

### 4. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Choose `/Users/{directoryPath}/notebooklm-browser-extension/extension`

## Using it

1. Open a page you want to ingest.
2. Click the extension icon.
3. Enter either:
   - a NotebookLM notebook ID, or
   - a notebook title. The bridge will try to find it, and create it if it does not exist.
4. Pick an ingestion mode:
   - `Upload extracted text`
   - `Add the page URL only`
   - `Upload text and add URL`
5. Click `Send Current Page`

Every capture is also saved locally as Markdown in `exports/`.

## Example

For a page like the Salesforce article below, the extension will capture the page title, metadata, and readable body text before sending it into NotebookLM:

- `https://help.salesforce.com/s/articleView?id=005298940&type=1`

## Notes

- `notebooklm-py` is an unofficial API and may break if Google changes internal NotebookLM endpoints.
- Some sites make heavy use of client-side rendering or protected content, so the extracted text may be incomplete.
- If you highlight text before sending, the bridge can place that selection first in the uploaded content.

## Next improvements

- Add a queue view so failed uploads can be retried later.
- Add a per-domain extraction profile for sites with unusual layouts.
- Add optional tagging and note templates before upload.
