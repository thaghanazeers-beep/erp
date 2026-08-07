# Notion-Style Tables & Filters — Reference and Implementation Spec

How Notion's database tables, filters, sorts, and grouping actually work,
mapped onto Mayvel's data model. Part 1 explains Notion's mental model,
Part 2 documents what Mayvel has today (and where it lives in the code),
Part 3 is the roadmap to full parity with data shapes ready to implement.

---

## Part 1 — How Notion does it

### 1.1 The core mental model: Database → Views → Rows

```
Database (one source of truth: rows + property definitions)
├── View "All tasks"   (table)   — its own filters, sorts, grouping, columns
├── View "By project"  (board)   — its own filters, sorts, grouping
├── View "Current: S3.3.26" (table) — filter: Sprint is S3.3.26
└── View "Social media" (table)  — filter: Project is Social
```

The three rules that make Notion feel like Notion:

1. **Rows are pages.** Clicking a row title opens the full page (in Mayvel:
   the task detail). Every other cell edits inline.
2. **Properties are typed.** Text, select, multi-select, person, date,
   number, checkbox, relation… The type decides which filter operators,
   sort semantics, and cell editors a property gets.
3. **Everything else is per-view.** Filters, sorts, grouping, visible
   columns, column order/width — all belong to the *view*, not the
   database and not the user. Two tabs over the same data can look
   completely different. Editing a shared view changes it for everyone
   who uses that view.

### 1.2 Table view anatomy

| Element | Behavior in Notion |
|---|---|
| Column | One property. Shown/hidden per view ("Properties" menu), draggable order, resizable width. |
| Column header click | Menu: sort ascending / descending, filter by this property, hide, edit property. |
| Cell | Inline editor matching the property type (select dropdown, person picker, date picker, text). |
| Title column | Always visible, opens the row's page. |
| Footer (calculate) | Optional per-column aggregate: count, count unique, sum, average, min/max, % empty… |
| New row | "+ New" at the bottom of the table / each group. |

### 1.3 Filters — the rule model

A filter is a **list of rules**. Each rule is:

```
property + operator + value
```

Rules combine with a single conjunction — **And** / **Or** — chosen once
(shown as a dropdown on the second rule). "Advanced filters" allow
**nested groups** up to 3 levels deep:

```
Where  Status       is        In Progress
And ┌─ Assignee     is        Pooja
    │  Or
    └─ Assignee     is        Suha ─┘
```

**Operators depend on the property type:**

| Type | Operators |
|---|---|
| Text (title) | contains, does not contain, is, is not, starts with, ends with, is empty, is not empty |
| Select / Status / Person | is, is not, is empty, is not empty |
| Multi-select | contains, does not contain, is empty, is not empty |
| Date | is, is before, is after, is on or before, is on or after, is within, is empty, is not empty — values can be **absolute** (a date) or **relative** (today, tomorrow, one week ago, one month from now…) |
| Number | =, ≠, >, <, ≥, ≤, is empty, is not empty |
| Checkbox | is (checked / unchecked) |

**Evaluation semantics worth copying exactly:**

- A rule whose value is still blank is **inactive** — it doesn't filter
  anything until filled in.
- "is empty" matches rows where the property has no value; a date rule
  like "is after X" never matches rows with no date (empty ≠ match).
- Filters on a shared view apply for **everyone**; a person can add
  temporary local tweaks, but saving writes to the view.

### 1.4 Sorts — ordered list, not a toggle

A sort is an **ordered list of rules**: `property + ascending|descending`.

```
Sort by  Sprint    ascending
then by  Assignee  ascending
then by  Project   ascending
```

- Rule #1 orders the rows; each later rule only breaks ties from the
  rules above it.
- Rules are drag-reorderable; removing one promotes the rest.
- Sorting is **not** grouping — it never draws section headers.

### 1.5 Grouping — visual sections, independent of both

- "Group by" one property → rows render under collapsible section
  headers with a count (e.g. `▾ Pooja 5`).
- Sorts still apply *within* each group.
- Options Notion adds: hide empty groups, custom group ordering,
  a distinct color per group on boards.

### 1.6 Who sees what (sharing model)

| Thing | Scope |
|---|---|
| View config (filters/sorts/grouping/columns) | Shared — saved on the view, same for everyone with access |
| Collapsed group state, scroll position | Personal — local to each user |
| Temporary unsaved filter tweaks | Personal until "Save for everyone" |

---

## Part 2 — What Mayvel has today

### 2.1 Component map

| Concern | File | Notes |
|---|---|---|
| Table view (columns, header menus, grouping, multi-sort, inline edit) | `frontend/src/components/TaskTable.jsx` + `TaskTable.css` | |
| Filter rule builder + evaluation + chips | `frontend/src/pages/TasksPage.jsx` (`FILTER_FIELDS`, `FILTER_OPS`, `matchRule`, `filteredTasks`) | Rules feed **all** views (table + board) |
| View tabs (Table / Board / +) | `frontend/src/components/ViewTabs.jsx` | Table is the default first view |
| Team-shared default filters | `backend/models/Teamspace.js` → `defaultTaskFilters`, saved via `PUT /api/teamspaces/:id` | "Save for everyone" |

### 2.2 Data shapes in use

**Filter rule** (persisted in `localStorage.mf_rules`, conjunction in `mf_conj`):

```json
{ "id": "r1754…", "field": "assignee", "op": "is", "value": "Pooja" }
```

- Fields: `title` (text) · `assignee` · `project` · `sprint` · `status` ·
  `priority` (select) · `dueDate` (date)
- Ops: text `contains|not_contains`, select `is|is_not`, date
  `is|before|after|on_or_before|on_or_after`, all types
  `is_empty|is_not_empty`
- Conjunction: `"and" | "or"` (flat list — no nested groups yet)
- Blank-value rules are inactive (matches Notion).

**Sort rules** (persisted in `localStorage.tasks_table_prefs.sorts`):

```json
[ { "key": "sprint", "dir": 1 }, { "key": "assignee", "dir": 1 } ]
```

Applied in order with tie-breaking; `priority` sorts by rank
(Urgent → Low), dates/numbers numerically, the rest by locale compare.

**Table prefs** (same localStorage key): `groupBy` (default `""` = none),
`hidden` columns (default hides Created), `collapsed` group names.

**Team default filters** (MongoDB, on the teamspace):

```json
{ "conjunction": "and", "rules": [ …same rule shape… ] }
```

Saved by Admin/Team Owner via "Save for everyone"; auto-applied to any
member who opens Tasks with zero rules of their own; their own edits
always win afterwards.

### 2.3 Parity checklist

| Notion behavior | Mayvel today |
|---|---|
| Rule-based filters (field + operator + value) | ✅ |
| And/Or conjunction | ✅ (flat list) |
| Operators per type incl. empty checks | ✅ |
| Multi-level sort with tie-breaks | ✅ |
| Grouping with collapsible counted headers | ✅ (Assignee/Status/Project/Priority/Sprint) |
| Column show/hide | ✅ |
| Column header menu (sort/filter/hide) | ✅ |
| Inline cell editing (status/assignee/priority) | ✅ with role rules |
| Shared view defaults + personal override | ✅ v5 — every view edit saves for the whole team (Notion semantics) |
| Nested filter groups (3 levels) | ❌ roadmap |
| Relative date values (today, next week…) | ✅ v5 (@today, @tomorrow, ±week, ±month) |
| Per-view (per-tab) filter/sort config | ✅ v5 — views stored on the teamspace, shared, member-editable, debounced auto-save |
| Column drag-reorder + resize | ❌ roadmap |
| Footer aggregates (sum/count per column) | ❌ roadmap |
| Custom property types on tasks | ❌ schema exists (`customProperties`), no UI |

---

## Part 3 — Roadmap to full parity

Ordered by user value per unit of effort.

### 3.1 Per-view configs (the biggest structural step)

Move filters/sorts/grouping/columns off global state and onto each view
tab, then persist server-side so views are shared:

```json
// Teamspace.views (array) — replaces tasks_views/localStorage per-user
{
  "id": "v_sprint",
  "name": "Current: S3.3.26",
  "type": "table",
  "filters": { "conjunction": "and", "rules": [ { "field": "sprint", "op": "is", "value": "…" } ] },
  "sorts":   [ { "key": "assignee", "dir": 1 } ],
  "groupBy": "assignee",
  "hiddenColumns": ["createdDate"],
  "createdBy": "Thagha"
}
```

- `GET/PUT` as part of the teamspace document (pattern already exists
  for `defaultTaskFilters`).
- Editing a view saves for everyone (Notion semantics); collapsed
  groups stay in localStorage (personal).
- The existing "+" in ViewTabs becomes "create a named view".

### 3.2 Relative date values

Add a value kind to date rules: `{ "value": { "rel": "today" } }` with
`today, tomorrow, yesterday, one_week_ago, one_week_from_now,
one_month_ago, one_month_from_now`. Resolve to a concrete date at
evaluation time in `matchRule`. UI: value dropdown with "Custom date…"
falling back to the date input.

### 3.3 Nested filter groups

Generalize rules to a tree (Notion caps depth at 3 — do the same):

```json
{ "conjunction": "and", "items": [
    { "field": "status", "op": "is", "value": "In Progress" },
    { "conjunction": "or", "items": [
        { "field": "assignee", "op": "is", "value": "Pooja" },
        { "field": "assignee", "op": "is", "value": "Suha Amir" } ] } ] }
```

Evaluation is a 10-line recursive function; the UI is the real cost
(indented group boxes + "Add filter group" button). Note: for the common
"assignee is any of X, Y" case, an `is_any_of` operator with
multi-select value is far cheaper than full nesting and covers ~90% of
real usage — consider shipping it first.

### 3.4 Table ergonomics

- **Column reorder**: drag `th` (HTML5 DnD like the board cards), persist
  order in view config.
- **Column resize**: mousedown handle on `th` edge, store px widths.
- **Footer calculations**: per-column optional aggregate over the
  filtered rows (`count`, `sum` for hour columns, `% by status`).

### 3.5 Custom properties

`Task.customProperties` + `PropertyDefinition` already exist in
`backend/models/Task.js` (text/number/date/select/multiSelect/checkbox/
url/email/phone). Surfacing them = dynamic columns in `COLUMNS`,
dynamic `FILTER_FIELDS` entries typed from the definition, and a cell
editor per type. This turns the task table into a real Notion-style
database.

---

*Written August 7, 2026. Matches the code as of the local (unpushed)
table/filter work; update the parity checklist as roadmap items land.*
