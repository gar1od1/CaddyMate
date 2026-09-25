# 005 — On-device normalisation and pattern refit

Status: accepted (wave 2). Amends SPEC §6.4 and §8.8.

- The client writes `neutral_distance_m` / `neutral_lateral_m` /
  `condition_model_version` and the `club_patterns` /
  `club_condition_patterns` rows. The same pure `normaliseShot` / `fitPattern`
  code runs on device and server, so results cannot disagree; the §8.8
  "Edge Function result wins" refit can be added later without schema change.
  Migration `20260927000000_patterns_api.sql` grants owners write access to
  the two pattern tables (own clubs only).
- Sim shots are bucketed as calm fairway for condition patterns.
- Net double bogey / adjusted gross use the course handicap (WHS); Stableford
  and net use the 95 % playing handicap.
- If a recommendation search has not finished when Hit is tapped, it runs
  synchronously so every shot carries a snapshot.
