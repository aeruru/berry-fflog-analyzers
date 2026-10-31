# Simple checkbox app

This is a static checklist generated from `checklist.json`.

## Customize it

- Change `title` to rename the page.
- Add the names of section-heading lines to `sectionHeadings`.
- Edit the strings in `lines`. Every `☐` character becomes an independent three-state checkbox.
- Clicking cycles a checkbox through off, on, and a yellow dash. Dashed boxes are omitted from the total.
- Leading spaces indent a line. Lines without a `☐` render as notes.
- Put `⭐` at the end of a line to make it glow and include its boxes in the glowing subtotal. The star itself is hidden.
- Change `id` when making a separate checklist so it gets its own saved checkbox state.

Because the page loads JSON with `fetch`, serve the folder over HTTP. From the repository root, for example:

```powershell
npx serve .
```

Then open the printed URL and navigate to `/simple-checkbox-app/`. Checkbox progress is saved in the browser's local storage.
