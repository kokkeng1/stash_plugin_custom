# stash_plugin_custom

Custom Stash plugins by kokkeng1.

## Source

Add this repository as a plugin source in Stash:

```
https://kokkeng1.github.io/stash_plugin_custom/main/index.yml
```

Settings → Plugins → Add Source

---

## Plugins

### ClaudeViewer

Opens gallery images in a local image viewer (Honeyview) instead of the built-in web Lightbox.

**Requirements:**
- Windows
- [Honeyview](https://www.bandisoft.com/honeyview/) installed
- Python 3 (with `pythonw` in PATH)

**Setup:**
1. Install the plugin via Stash
2. Run `install.ps1` as Administrator to register the `honeyview-stash://` protocol
3. If Honeyview is not at `C:\Program Files\Honeyview\Honeyview.exe`, edit `handler.py` line 11

**How it works:**
- Intercepts the magnifying glass (🔍) button click on gallery image cards
- Fetches the real file path via GraphQL
- Opens the image (or its parent archive for zip/cbz/rar) in Honeyview
