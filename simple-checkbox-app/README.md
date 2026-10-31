# Simple checkbox app

Edit `checklist.json` to customize the title, section headings, and lines. Each `☐` becomes a three-state box: off, on, then yellow dash. A trailing `⭐` makes a line glow and adds its boxes to the glowing subtotal.

Checkboxes cycle through empty, green check, yellow dash, red X, then empty. Selecting a later box marks every earlier unlocked empty box as X, including boxes on earlier lines. An automatically or bulk-created X becomes a locked empty when cleared; an X created directly from a dash does not. Hold a dashed box for 600ms to dash every empty or X box after it. Undo retains the last three actions, and **Mark remaining X** can be used whenever empty boxes remain.

**Save text** preserves every line while exporting off boxes as `☐ `, on boxes as `☒ `, and dashed boxes as `- `. Set `downloadFileName` in the JSON to customize the filename.
