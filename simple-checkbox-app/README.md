# Simple checkbox app

Edit `checklist.json` to customize the title, section headings, and lines. Each `☐` becomes a three-state box: off, on, then yellow dash. A trailing `⭐` makes a line glow and adds its boxes to the glowing subtotal.

Checkboxes now cycle through empty, green check, yellow dash, red X, then a locked empty. Selecting a later box marks unlocked empty boxes before it as X. Hold a dashed box for 600ms to dash empty or X boxes after it on the same line. Undo retains the last three actions, and **Mark remaining X** can be used once until Reset.

**Save text** preserves every line while exporting off boxes as `☐ `, on boxes as `☒ `, and dashed boxes as `- `. Set `downloadFileName` in the JSON to customize the filename.
