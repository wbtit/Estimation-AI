# Review guide

The system has already built every page it could. Your job is to check each page **against the
drawing** and fix what is wrong. Do not just accept what is shown: look at the drawing, then at the
coloured marks. Everything you do is saved with your name and the time.

## 1. Move around the page

| To | Do |
|---|---|
| Zoom in or out around the mouse | **Ctrl + mouse wheel**, or pinch on a trackpad |
| Pan up and down / left and right | Mouse wheel / **Shift + wheel** |
| Pan freely | Hold **Space** and drag, or drag with the middle mouse button |
| See the whole page | **Fit** (toolbar) |
| Zoom to an exact size | Type a number in the **%** box (bottom right), 10% to 800% |

The drawing sharpens a moment after you stop zooming.

## 2. Open a page

Pick a page on the left (**Navigation → Pages**). Its card shows the role, the sheet number and a
picture of the page with badges: **Not confirmed** means the system set it up; **Requesting Build**
means you changed something, so press ▶; **Reviewed** means you saved it. The **red** and
**orange** numbers on the picture count the members that need attention or review.

The selected card lists the page's **Views** and the fields of the chosen view: **Role**,
**Top of Steel**, **Scale** and **Status**.

## 3. Views and roles

A simple page has one view, **View 1**, covering the plan. When a sheet holds more than one
drawing (for example a framing plan and a partial plan at another scale), press **+ Add view** on
the card and drag the new view's box on the page. Each view has its own role, scale and Top of
Steel; lengths use the view's scale. Click a view's name (on the card or on the page) to work on
it. The ✕ next to a view deletes it.

**Role** = a name and what the build does with it:

- **Column plan** and **Foundation plan** are built as a column plan.
- **Framing plan** and **Roof framing** are built as framing.
- **Detail**, **Section**, **Elevation**, **Notes**, **Schedule** and **Other** are not built.
- **+ Type a new role…** adds your own name. You are asked once how to build it (**Framing**,
  **Column plan** or **Don't build**), and it is saved for every project.
- **Edit custom roles…** renames a custom role or changes how it is built. The views that use it
  then ask for a rebuild.

## 4. Check the setup of each view

| Check | Looks right when | How to fix |
|---|---|---|
| **Role** | The name and its build behaviour fit the drawing | **Role** on the card |
| **Crop** | The dashed blue box holds the whole plan, not the title block, the border or details | **Crop** tool, drag a new box |
| **Beam pen** | Every real beam is a beam; no dimension, grid or border line is one | **Pick beam**: see below |
| **No beams** | A column plan shows no beams | ⋮ on the card → **No beams**, then ▶ |
| **Scale** | It matches the scale printed for this drawing | **Scale** on the card, or **Type…** (for example `1/8" = 1'-0"`) |
| **Top of Steel** | It matches the T.O.S. note | Type it in feet-inches: `13'-3 1/2"`, `13'-3.5"` or `13.29'` |
| **Column plan** (framing) | It is the column plan this floor sits on | ⋮ on the card → **Column plan** |

### Pick beam: pens, deselecting lines, exclude areas

- **Pick beam** (dropper), then click one real beam line. Every line drawn with that pen lights up
  (**Pen preview**).
- **Replace pen** (the default) makes that pen the view's only beam pen. **Add pen** adds a second
  one, for example when girders are drawn heavier than infill beams. The pens are listed in the bar
  at the top; the ✕ removes one.
- **Click a highlighted line** that is not a beam (a border, a dimension line) to deselect it. It
  turns grey and is struck through. Click it again to bring it back.
- **Ctrl + drag** a box to deselect every highlighted line inside it.
- **Reset deselections** brings them all back.
- **Exclude area** (crossed-out square): drag a box over a title block, detail, table or legend.
  Everything inside it is ignored by the build. Click a box to select it, then **Delete box** (or
  press Delete).
- **Suggest excludes** proposes boxes for the sheet frame, the title block and tables. They show
  dashed and marked **suggested**. **Accept all**, or click one box and **Accept**. Only accepted
  boxes count. The system never suggests a box over the plan's grid.

After a build, if a deselected line was not found among the build's lines, the bar says
**"N deselected lines not found"**. Look at those lines again.

After any setup change, press **▶** on the card to rebuild. ▶ builds every view of the page that
has a building role. Pieces you already edited are never changed by a rebuild.

## 5. Check the members

**Drawing fade** (Layers, funnel icon) fades the drawing so the marks stand out. The default is
45%, and your choice is remembered in this browser.

Each member is drawn in one colour:

| Colour | Meaning |
|---|---|
| **Magenta** line | a beam, with its size written along it (`w18x35 <10>` = size and studs) |
| **Blue I** | a column, with its mark |
| **Orange**, with a glow | needs review: size taken from a nearby label, or one end not supported |
| **Red**, with a glow | needs attention: no size, or no support (dashed = a beam with no size) |
| **Grey** | ignored (not ours) |

Hover a member to see what the system read. **Show flags** (Layers) adds the old small flags.

### The issue navigator

The pill at the top of the page reads **"N need attention · M to review"**. Press **Next ▸** or
the **N** key to jump to the next one. **◂ Prev** or **Shift+N** goes back.

The navigator zooms to the member and selects it, so the Member panel opens. It goes through
attention members first, then review members. Once you fix a member, it drops out of the list and
**Next** goes on from there.

### Fixing members

Click a member to select it. Shift+click or drag a box to select several; the panel then shows
**Mixed** where they differ.

- **Wrong size**: Properties → **Section Size**, then type and pick the AISC size.
- **Many members with no size**: Properties → **Summary** → **Set size for all undefined beams**
  (or **… columns without a size**), then pick one size. It is applied to all of them in the
  current view as one change, and **Undo** puts them back.
- **Wrong type**: change **Member Type** (beam, column, brace…).
- **Studs, camber**: type them in the panel.
- **End in the wrong place**: drag the white circle at the end of the selected beam.
- **Not a member** (a line drawn as a beam but not steel): **Delete**, or the Delete key.
- **Real but not ours** (existing steel, by others): tick **Ignore**. It stays on the page in grey
  and is left out of the BOM.
- **Missing beam**: **Draw beam**, then click both ends. **Missing column**: **Draw column**, then
  click its centre. Then give it a size.
- **Undo** takes back your last change. The number on it counts your changes since the last save.
- **Measure**: click two points to read a length.
- Hover a tool to see its name.

## 6. Save the page

When the page matches the drawing, press **Save page** (top right) and the badge turns
**Reviewed**. Saving also confirms the setup values you left as they were, in every view. Then go
to the next page.

The **BOM** tab lists every piece (lengths in feet-inches, weights in lb) and exports to Excel.
