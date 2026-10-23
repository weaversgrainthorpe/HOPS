# folder_min_cases.json

THE open-folder minimum table (M5 Ruling 7, Ruling 9), shared by the Go test
(`configdoc/foldermin_test.go`, `FolderMinCells` / `LargestContentSize`) and the
frontend test (`frontend/src/lib/layout/folderMin.test.ts`, `minOpenFolderCells` /
`largestContentSize` / `folderMinCells`). Both implementations must pass every case.

- `minOpen`: the smallest open box, in tab cells `{w, h}`, for one contents size: its
  bar (40 px), the tab-height allowance (24 px, M6 §3a.4: one constant for every
  shape, Rounded included, so there is no shape parameter), border and padding
  (18 px), ONE item at that size and the page bar (32 px), counted at the narrowest
  grid cell (32 px). Small 2×5, Medium 3×6, Large 5×8. `null` or an unknown size is
  drawn as Medium.
- `folders`: a folder node; `largest` is the largest contents size of it and every
  folder inside it (tiles' sizes do not count), `min` is the minimum at that size.
