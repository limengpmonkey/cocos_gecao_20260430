# BulletHell Balance Tuning Guide

This guide maps each balance field to player feel, and gives a fast simulation workflow for repeated tuning.

## 1) Core Goal Template

Target rhythm for current version:
- 0s to 30s: fast growth, quick first levels, low stress.
- 30s to 120s: pressure ramps steadily, player starts pathing and cutting actively.
- Pre-boss window: pressure reaches a local peak, then slightly relaxes if boss timing is delayed.
- Boss kill: clear dopamine spike through large reward payout and stronger upgrade options.

## 2) Where to Tune

Main table file:
- assets/demos/bulletHell/balanceTable.ts

Runtime consumers:
- assets/demos/bulletHell/bulletHell.ts
- assets/demos/bulletHell/ExperienceSystem.ts
- assets/demos/bulletHell/enemy.ts

## 3) Field-to-Feel Mapping

### 3.1 ExpCurvePoint

Fields:
- levelStart
- baseExp
- growthFactor

Player-feel mapping:
- Lower early baseExp + lower early growthFactor => first few upgrades come fast.
- Higher mid/late growthFactor => stronger grind slope, forces active mowing.
- Too low growth late => game becomes idle and flat.
- Too high growth late => player falls behind and loses build agency.

Quick rule:
- Early segment growthFactor: 1.10 to 1.16
- Mid segment growthFactor: 1.18 to 1.28
- Late segment growthFactor: 1.30 to 1.42

### 3.2 PressureCurvePoint

Fields:
- timeSec
- normalHpMul
- normalSpeedMul
- spawnRateMul
- maxAliveMul
- pressureIndex

Player-feel mapping:
- normalHpMul: kill time of regular enemies.
- normalSpeedMul: chase stickiness and dodge tax.
- spawnRateMul: encounter frequency and visual density pulse.
- maxAliveMul: sustained screen occupancy ceiling.
- pressureIndex: used by relief logic as synthetic stress signal.

Quick rule:
- Early 0s to 30s: keep all multipliers below 1.
- Mid phase: first set spawnRateMul above 1, then raise hp/speed.
- Pre-boss: peak mainly by spawnRateMul + maxAliveMul, not only hp.
- If pre-boss feels unfair, reduce speed first before reducing hp.

### 3.3 EliteSpawnRule

Fields:
- startTimeSec
- intervalSec
- maxAlive
- hpMul / speedMul / expMul / scoreMul
- skillType / skillCooldown

Player-feel mapping:
- startTimeSec controls when calm farming gets interrupted.
- intervalSec and maxAlive control tempo break frequency.
- hpMul and speedMul define elite threat identity.
- expMul and scoreMul compensate risk with meaningful payoff.
- skillType rotates pressure style:
  - Dash: burst chase and spacing punish.
  - Ranged: anti-afk poke.
  - Explode: close-range greed punish.

Performance note:
- For mini-game constraints, prefer maxAlive 1 to 3.
- Keep intervalSec >= 8 unless total enemy count is low.

### 3.4 ResourceReliefRule

Fields:
- checkIntervalSec
- minIntervalBetweenDropsSec
- hpThreshold
- pressureThreshold
- expBurstBase / expBurstPerMinute
- healAmount
- damageBoostMultiplier / damageBoostDurationSec

Player-feel mapping:
- hpThreshold and pressureThreshold decide rescue trigger strictness.
- expBurst fields provide comeback via leveling momentum.
- healAmount and temporary boost create clutch recovery moments.

Quick rule:
- If players die before builds online, raise hpThreshold and expBurstBase.
- If game feels too easy, increase minIntervalBetweenDropsSec first.
- Relief should feel "just in time", not constant shower.

### 3.5 BossRewardRule

Fields:
- bonusExp
- bonusExpPerMinute
- bonusPickupCount
- rewardSkillOptionCount

Player-feel mapping:
- bonusExp gives immediate progression jump.
- bonusPickupCount is visible reward spectacle.
- rewardSkillOptionCount increases agency and build excitement.

Quick rule:
- Boss reward must feel clearly above normal cycle.
- If boss feels not worth effort, increase option count before inflating raw numbers too much.

## 4) Fast Simulation Workflow

Use this 4-pass loop for each stage:

Pass A: Early comfort check (0 to 45s)
- Verify first 2 to 4 level-ups happen quickly.
- If not, lower first exp segment baseExp or growthFactor.

Pass B: Mid pressure check (45 to 150s)
- Verify player must move and route, but still has kill windows.
- If too empty, raise spawnRateMul first.
- If too oppressive, reduce normalSpeedMul first.

Pass C: Pre-boss peak check
- Confirm local pressure peak appears before boss trigger.
- If no peak, add one extra pressure point around pre-boss timing.
- If spike feels unfair, soften speed and keep density.

Pass D: Reward conversion check (post-boss)
- Confirm boss death produces clear power spike and choice spike.
- If flat, increase rewardSkillOptionCount and bonusPickupCount.

## 5) Suggested KPI Snapshot

Track these while tuning:
- timeToLevel2, timeToLevel4
- firstDeathTime
- averageHPBeforeBoss
- killsPerMinute in mid phase
- postBossPowerSpikeWindow (how long player feels significantly stronger)

## 6) Current Default Intent (March 24, 2026)

Stage 1:
- Fast first upgrades, low early stress.
- Pressure ramps by density and count first, then speed.
- Small relief bias to reduce early frustration.

Stage 2:
- Starts manageable but ramps faster to force active mowing.
- More frequent elites and stronger pre-boss peak.
- Richer boss payout to keep long-run excitement.
