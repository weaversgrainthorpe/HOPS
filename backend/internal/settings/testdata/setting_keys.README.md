# setting_keys.json

Every global setting key the server registry (`Definitions` in `settings.go`) exposes, in
registry order. Shared by the Go test (`settings/keys_fixture_test.go`, which fails when this
file and `Definitions` disagree) and the frontend test
(`frontend/src/lib/settings/globalGroups.test.ts`, which fails when the global settings
grouping table — M6 §10 — is missing a key, or lists one the server no longer has).

Adding a setting: add it to `Definitions`, regenerate this file with
`cd backend && go test ./internal/settings -run TestSettingKeysFixture -update`, then add the
key to its group in `frontend/src/lib/settings/globalGroups.ts`.
