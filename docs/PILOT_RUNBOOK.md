# Pilot runbook: counting with the copilot (project `pilot-01`)

The system suggests pieces; you confirm them with clicks. Only what you confirm is counted. Every click is saved with who and when.

## For the estimator

**Before you start**
- Pick **pilot-01** in the project list at the top, and type **your name** in the "you" box. Nothing can be changed without a name.
- The top bar should say **pilot on**. Leave it on.
- On each page you will measure, check the scale in the yellow box under the top bar. If it is right, press **These guesses are right**. Lengths only work on a page whose scale is confirmed.

**Count pieces**
1. Open the **Count** tab on the right. Choose the **kind** (Beams, Column, ...) in the drop-down.
2. Press **Count (K)**. Move over the drawing: the line the click will stick to is highlighted.
3. If the wrong line is highlighted, press **Tab** to move to the next line under the pointer (**Shift+Tab** goes back). The note beside the pointer says "line 2 of 3".
4. **Click**. The piece gets a tag (for example BE7) and its size from the nearest label. An amber "size blank: type it" means no label was found: type the size in the list.
5. Press **Esc** to stop counting.

**Suggestions (dashed symbols)**
- A dashed symbol is something the system found that nobody has decided. It is in **no total**.
- While counting, **click** it to accept, or **Shift+click** to reject. The **Accept** and **Reject** buttons in "Suggested, not decided" do the same.
- An amber dashed square is a size label with no line near it. Accepting it counts the piece without a length.

**Typical members (x N)**
- When one drawn piece stands for several (a "typical" note), click that piece's line in **Confirmed pieces** to select it.
- Enter the number in **typical x** (2 or more) and write in the note where the number comes from (for example "6 bays, typ. note on sheet 4"). Then press **Save**.
- The piece then counts N everywhere and shows an amber "typical xN" badge. **Remove** takes it off.

**Measure a length**
1. Press **Measure (M)**. Points stick to line ends and crossings, shown before you click.
2. Click the two ends, then press **Save measurement**.
3. Select the piece in **Confirmed pieces** and press **Attach to the selected piece**. Its Length and Total W fill in.
- Pieces without a measured length stay in the count; their Total W is blank.

**Fix mistakes**
- Undo: **Ctrl+Z** or the **Undo** button. Redo: **Ctrl+Y** (or Ctrl+Shift+Z) or **Redo**.
- **delete** removes a piece from the counts (it can be undone).
- Click a tag or size in the list to change it.

**Export**
- **Takeoff** tab: **Download Excel**.
- **Tables** tab: **Export Excel**.
- Both count confirmed pieces only. Suggestions are listed apart.

## For the owner

**The Report tab** (visible while the pilot is on) has one line per page and person:
- **Active min**: working time on that page. A pause longer than 5 minutes is not counted; the number of such pauses is in **Gaps > 5 min**.
- **Created**: pieces clicked. **Accepted** and **Rejected**: suggestions decided. **Edited**, **Deleted**, **Undo**: corrections made.
- **Pieces**: the confirmed pieces that person made on that page, as they are now. **Typical** shows how many of them are x N. **No length** shows how many have no measured length.
- The bottom line adds up all pages.

**CSV export**
- Press **Download CSV** on the Report tab. It has the same lines plus first and last action time, redo, measurements and typical changes.
- It opens in Excel and is read-only: nothing in the project changes.

**Good to know**
- The original job-018 project is untouched; pilot-01 is a separate copy.
- Turning the pilot switch off returns pilot-01 to the earlier totals, where every linked line counts without a click. Nothing is lost.
