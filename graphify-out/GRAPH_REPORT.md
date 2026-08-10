# Graph Report - .  (2026-08-10)

## Corpus Check
- Corpus is ~7,036 words - fits in a single context window. You may not need a graph.

## Summary
- 52 nodes · 85 edges · 8 communities detected
- Extraction: 72% EXTRACTED · 28% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_User List Management|User List Management]]
- [[_COMMUNITY_Post Curation Pipeline|Post Curation Pipeline]]
- [[_COMMUNITY_Hive Blockchain Client|Hive Blockchain Client]]
- [[_COMMUNITY_Voting Power Utilities|Voting Power Utilities]]
- [[_COMMUNITY_HAF Delegation Ranking|HAF Delegation Ranking]]
- [[_COMMUNITY_RetryTimeout Utilities|Retry/Timeout Utilities]]
- [[_COMMUNITY_Curation Support Index|Curation Support Index]]
- [[_COMMUNITY_Hive Engine API Client|Hive Engine API Client]]

## God Nodes (most connected - your core abstractions)
1. `processPost()` - 15 edges
2. `getHiveClient()` - 11 edges
3. `getUserInfo()` - 6 edges
4. `getHiveBrVoterDelegation()` - 5 edges
5. `castVoteAndComment()` - 5 edges
6. `convertVestToHive()` - 5 edges
7. `extractNumber()` - 5 edges
8. `getPostInfo()` - 4 edges
9. `fetchRankedDelegators()` - 4 edges
10. `getSameDayPostInfo()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `processPost()` --calls--> `getBlacklistedUsers()`  [INFERRED]
  C:\Fontes_Typescript\hivebr-curation-bot\src\index.ts → C:\Fontes_Typescript\hivebr-curation-bot\src\users.ts
- `processPost()` --calls--> `getVerifiedUsers()`  [INFERRED]
  C:\Fontes_Typescript\hivebr-curation-bot\src\index.ts → C:\Fontes_Typescript\hivebr-curation-bot\src\users.ts
- `processPost()` --calls--> `getAutoUsers()`  [INFERRED]
  C:\Fontes_Typescript\hivebr-curation-bot\src\index.ts → C:\Fontes_Typescript\hivebr-curation-bot\src\users.ts
- `getVotingPower()` --calls--> `getHiveClient()`  [INFERRED]
  C:\Fontes_Typescript\hivebr-curation-bot\src\hive\util.ts → C:\Fontes_Typescript\hivebr-curation-bot\src\hive\index.ts
- `getHiveBrVoterDelegation()` --calls--> `getHiveClient()`  [INFERRED]
  C:\Fontes_Typescript\hivebr-curation-bot\src\index.ts → C:\Fontes_Typescript\hivebr-curation-bot\src\hive\index.ts

## Communities

### Community 0 - "User List Management"
Cohesion: 0.18
Nodes (8): getAutoUsers(), getBlacklistedUsers(), getStaffUsers(), getVerifiedUsers(), isUserInStaffList(), seedDataFiles(), seedIfMissing(), updateLastProcessedBlock()

### Community 1 - "Post Curation Pipeline"
Cohesion: 0.33
Nodes (8): checkHiveVoteTrail(), checkHivewatchers(), calculateBaseVoteScore(), getActiveChannel(), getPostInfo(), getSameDayPostInfo(), processBlock(), processPost()

### Community 2 - "Hive Blockchain Client"
Cohesion: 0.43
Nodes (7): castVoteAndComment(), comment(), getHiveClient(), getNextHiveClient(), streamBlockchain(), vote(), getLastProcessedBlock()

### Community 3 - "Voting Power Utilities"
Cohesion: 0.6
Nodes (5): getHiveBrVoterDelegation(), getUserInfo(), convertVestToHive(), extractNumber(), getVotingPower()

### Community 4 - "HAF Delegation Ranking"
Cohesion: 0.7
Nodes (4): circuitOpen(), fetchRankedDelegators(), getAuthorDelegationRank(), sleep()

### Community 5 - "Retry/Timeout Utilities"
Cohesion: 0.67
Nodes (2): delay(), retry()

### Community 6 - "Curation Support Index"
Cohesion: 1.0
Nodes (2): calcCsi(), getUserCsiScore()

### Community 7 - "Hive Engine API Client"
Cohesion: 1.0
Nodes (1): HiveEngineApi

## Knowledge Gaps
- **1 isolated node(s):** `HiveEngineApi`
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Retry/Timeout Utilities`** (4 nodes): `utils.ts`, `delay()`, `retry()`, `timeout()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Curation Support Index`** (3 nodes): `calcCsi()`, `getUserCsiScore()`, `csi.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Hive Engine API Client`** (2 nodes): `HiveEngineApi`, `hive-engine-api.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `processPost()` connect `Post Curation Pipeline` to `User List Management`, `Hive Blockchain Client`, `Voting Power Utilities`, `HAF Delegation Ranking`?**
  _High betweenness centrality (0.392) - this node is a cross-community bridge._
- **Why does `getAuthorDelegationRank()` connect `HAF Delegation Ranking` to `Post Curation Pipeline`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Why does `getHiveClient()` connect `Hive Blockchain Client` to `Post Curation Pipeline`, `Voting Power Utilities`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `processPost()` (e.g. with `getBlacklistedUsers()` and `checkHivewatchers()`) actually correct?**
  _`processPost()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `getHiveClient()` (e.g. with `getHiveBrVoterDelegation()` and `getSameDayPostInfo()`) actually correct?**
  _`getHiveClient()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `getUserInfo()` (e.g. with `getHiveClient()` and `extractNumber()`) actually correct?**
  _`getUserInfo()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `getHiveBrVoterDelegation()` (e.g. with `getHiveClient()` and `convertVestToHive()`) actually correct?**
  _`getHiveBrVoterDelegation()` has 3 INFERRED edges - model-reasoned connections that need verification._