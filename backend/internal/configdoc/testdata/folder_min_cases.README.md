# folder_min_cases.json

THE open-folder minimum table (M5 Ruling 7, Ruling 9), shared by the Go test
(`configdoc/foldermin_test.go`, `FolderMinCells` / `LargestContentSize`) and the
frontend test (`frontend/src/lib/layout/folderMin.test.ts`, `minOpenFolderCells` /
`largestContentSize` / `folderMinCells`). Both implementations must pass every case.

- `minOpen`: the smallest open box, in tab cells `{w, h}`, for one contents size: its
  bar, border and padding, ONE item at that size and the page bar, counted at the
  narrowest grid cell (32 px). `null` or an unknown size is drawn as Medium.
- `folders`: a folder node; `largest` is the largest contents size of it and every
  folder inside it (tiles' sizes do not count), `min` is the minimum at that size.
