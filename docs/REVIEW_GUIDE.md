# Review guide

The system has already built every page it could. Your job is to check each page **against the
drawing** and fix what is wrong. Do not just accept what is shown: look at the drawing, then at the
purple and blue marks. Everything you do is saved with your name and the time.

## 1. Open a page

Pick a page on the left (**Navigation → Pages**). Its card shows the page type, the sheet number
and a picture of the page with badges (**Not confirmed** = the system set it up, **Requesting
Build** = you changed something, press ▶; **Reviewed** = you saved it; **Estimating** or **Skip**).
The selected card also shows **Top of Steel**, **Scale** and **Status**.

## 2. Check the page setup

| Check | Looks right when | How to fix |
|---|---|---|
| **Role** | Column plans are "Column plan", floor and roof framing are "Framing", other pages "Skip" | ⋮ on the card, choose the role (for framing, also the column plan page it sits on) |
| **Crop** | The dashed blue box holds the whole framing plan, not the title block, the page border or details | **Crop** tool, drag a new box |
| **Beam pen** | All real beams are purple; no dimension, grid or hatch lines are purple | **Pick beam** (dropper), click one real beam line; every line of that pen lights up orange |
| **No beams** | A column plan shows no purple beam lines | ⋮ on the card → **No beams**, then ▶ |
| **Scale** | Matches the scale printed for this plan | **Scale** dropdown on the card, or **Type…** (for example `1/8" = 1'-0"`) |
| **Top of Steel** | Matches the T.O.S. note of the plan | Type it on the card in feet-inches: `13'-3 1/2"`, `13'-3.5"` or `13.29'` |

After a setup change press **▶** on the card to rebuild the page. Pieces you already edited are
never changed by a rebuild.

## 3. Check the members

- **Purple line** = a beam, its size written beside it (`w18x35 <10>`: size and studs);
  **dashed purple** = a beam with no size; **blue I** = a column with its mark.
- **Amber flag** = check it (size taken from a nearby label, or one end not supported).
  **Red flag** = needs you (no size, or no support). Hover a member to see what the system read.
- **Layers** (funnel) shows or hides grids, beams, undefined beams, columns, labels and flags.
  "Only undefined beams" shows just the ones without a size.

To fix a member, click it (Shift+click or drag a box to select several; the panel then shows
**Mixed** where they differ):

- **Wrong size**: Properties → **Section Size**, type and pick the AISC size.
- **Wrong type**: **Member Type** (beam, column, brace…).
- **Studs, camber**: type them in the panel.
- **End in the wrong place**: drag the white circle at the end of the selected beam.
- **Not a member** (a line drawn as a beam but not steel): **Delete** (or the Delete key).
- **Real but not ours** (existing steel, by others): tick **Ignore**. It stays on the page, grey,
  and is left out of the BOM.
- **Missing beam**: **Draw beam** (pen), click both ends. **Missing column**: **Draw column** (I),
  click its centre. Then give it a size in the panel.
- **Undo** (curved arrow) takes back your last change; the number on it counts your changes since
  the last save.
- **Measure** (ruler): click two points to read a length. **Fit** shows the whole page.
- Hover a tool to see its name.

## 4. Save the page

When the page matches the drawing, press **Save page** (top right). The badge turns **Reviewed**.
Saving also confirms the setup values you left as they were. Then go to the next page.

The **BOM** tab lists every piece (lengths in feet-inches, weights in lb) and exports to Excel.
