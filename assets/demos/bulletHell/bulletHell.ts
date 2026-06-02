import { _decorator, BlockInputEvents, CCInteger, Color, Component, Enum, Graphics, instantiate, Label, Node, Prefab, Quat, Sprite, UITransform, UIOpacity, Vec2, Vec3, director, view } from 'cc';
import { cCollider } from '../../collision/Collider';
import { cObject } from '../../collision/Object';
import { Joystick } from '../../Joystick/Joystick';
import { Bullet } from './bullet';
import { BossEnemy } from './BossEnemy';
import { Enemy, EnemyEvents, EnemyKilledEventData } from './enemy';
import { ExperienceSystem } from './ExperienceSystem';
import { GameStateManager } from './GameStateManager';
import { Ghost } from './ghost';
import { Gun } from './gun';
import { Player, PlayerHealthEvents } from './player';
import { SkillSelectionSystem } from './SkillSelectionSystem';
import { SnailTail } from './snailTail';
import { Skill } from './skill';
import { PickupEffectType, TemporaryPickup } from './TemporaryPickup';
import { EliteSkillType, StageBalanceTable, getDefaultBalanceTables, samplePressureAtTime } from './balanceTable';
import { CollectionDefinition, CollectionSystem } from './CollectionSystem';
import { GameState } from './types';
import { SceneTransition } from '../../SceneTransition';
const { ccclass, property } = _decorator;

const tempPos = new Vec3();
const tempRot = new Quat();
const tempCameraShakeOffset = new Vec3();

enum EnemyKind {
    Ghost = 0,
    SnailTail = 1,
}

enum BossUnlockMode {
    Any = 0,
    All = 1,
}

@ccclass('EnemySpawnConfig')
class EnemySpawnConfig {
    @property({ type: Prefab, tooltip: '敌人预制体' })
    prefab: Prefab = null;

    @property({ type: Enum(EnemyKind), tooltip: '敌人类型（决定对象池与行为）' })
    kind: EnemyKind = EnemyKind.Ghost;

    @property({ tooltip: '该类型刷怪权重（越高越容易被选中）' })
    weight: number = 1;

    @property({ tooltip: '该类型最小刷怪间隔（秒）' })
    spawnInterval: number = 0.5;

    @property({ type: CCInteger, tooltip: '该类型同屏上限（<=0 表示不限制）' })
    maxAlive: number = 0;

    @property({ tooltip: '是否启用该类型' })
    enabled: boolean = true;
}

@ccclass('StageConfig')
class StageConfig {
    @property({ tooltip: '关卡名称（仅用于日志）' })
    stageName: string = 'Stage';

    @property({ type: CCInteger, tooltip: '本关达到该分数后召唤 Boss（<=0 表示不召唤）' })
    scoreToSummonBoss: number = 900;

    @property({ type: [EnemySpawnConfig], tooltip: '本关刷怪配置（为空时回退全局 enemySpawnConfigs）' })
    enemySpawnConfigs: EnemySpawnConfig[] = [];

    @property({ type: CCInteger, tooltip: '本关同屏敌人总上限（<=0 回退全局 max）' })
    maxEnemies: number = 0;

    @property({ tooltip: '本关敌人出生最小半径（<=0 回退全局 minSpawnRadius）' })
    minSpawnRadius: number = 0;

    @property({ tooltip: '本关敌人出生最大半径（<=0 回退全局 maxSpawnRadius）' })
    maxSpawnRadius: number = 0;

    @property({ type: Prefab, tooltip: '本关 Boss 预制体（需挂载 BossEnemy，为空则不生成 Boss）' })
    bossPrefab: Prefab = null;

    @property({ tooltip: '满足分数后延迟多少秒生成 Boss（<=0 立即）' })
    bossSpawnDelay: number = 1;

    @property({ tooltip: 'Boss 出场缓冲时间（秒），期间闪烁但不移动' })
    bossEntranceBufferTime: number = 1;

    @property({ tooltip: 'Boss 战矩形区域宽度' })
    bossArenaWidth: number = 640;

    @property({ tooltip: 'Boss 战矩形区域高度' })
    bossArenaHeight: number = 360;

    @property({ tooltip: '本关 Boss 生命倍率' })
    bossHpMultiplier: number = 30;

    @property({ tooltip: '本关 Boss 经验倍率' })
    bossExpMultiplier: number = 5;

    @property({ tooltip: '本关 Boss 分数倍率' })
    bossScoreMultiplier: number = 10;
}

@ccclass('BulletHell')
export class BulletHell extends Component {

    @property(Prefab)
    ghost: Prefab = null; //敌人

    @property(Prefab)
    snailTail: Prefab = null; //敌人

    @property(Prefab)
    player: Prefab = null; //主角

    @property(Prefab)
    temporaryPickupPrefab: Prefab = null; //临时道具显示预制体

    @property(Prefab)
    pickupCollectEffectPrefab: Prefab = null; //拾取特效预制体

    @property(Node)
    objects: Node = null; //enemy 显示挂载点

    @property(Node)
    bullets: Node = null; //bullet 显示挂载点

    @property(Node)
    camera: Node = null; //跟随相机

    @property(Joystick)
    joystick: Joystick = null; //主角摇杆



    //简单模拟在周期时间内，以主角为中心的半径内产生敌人
    @property({ type: CCInteger, group: "Enemy Config" })
    max: number = 1000; //多敌人同屏数

    @property({ group: "Enemy Config" })
    raidus: number = 2000; //刷怪最大半径 

    @property({ group: "Enemy Config" })
    cyclTime: number = 0.03; //刷怪cd周期

    @property({ type: [EnemySpawnConfig], group: 'Enemy Config', tooltip: '自定义刷怪配置（为空时回退为 ghost/snailTail 各 50%）' })
    enemySpawnConfigs: EnemySpawnConfig[] = [];

    @property({ type: [StageConfig], group: 'Stage Config', tooltip: '关卡配置列表（建议至少两关）' })
    stages: StageConfig[] = [];

    @property({ group: 'Enemy Config', tooltip: '敌人出生最小半径（相对玩家）' })
    minSpawnRadius: number = 600;

    @property({ group: 'Enemy Config', tooltip: '敌人出生最大半径（相对玩家）' })
    maxSpawnRadius: number = 2000;

    @property({ group: 'Enemy Config', tooltip: '小怪移动速度倍率（<1 更慢）' })
    enemyMoveSpeedMultiplier: number = 0.58;

    @property({ group: 'Enemy Config', tooltip: '移动端近距离刷怪模式（小怪优先在屏幕外不远处出现）' })
    mobileNearSpawnEnabled: boolean = true;

    @property({ group: 'Enemy Config', tooltip: '近距离刷怪最小半径（建议略大于半屏）' })
    mobileNearSpawnMinRadius: number = 240;

    @property({ group: 'Enemy Config', tooltip: '近距离刷怪最大半径（建议不超过一屏半）' })
    mobileNearSpawnMaxRadius: number = 560;

    @property({ type: Prefab, group: 'Boss Config', tooltip: 'Boss 预制体（需挂载 BossEnemy）' })
    bossPrefab: Prefab = null;

    @property({ group: 'Boss Config', tooltip: '调试：开局直接进入当前关 Boss 战，忽略分数条件' })
    debugStartWithBossFight: boolean = false;

    @property({ group: 'Boss Config', tooltip: '满足条件后延迟多少秒生成 Boss' })
    bossSpawnDelay: number = 1;

    @property({ group: 'Boss Config', tooltip: 'Boss 出场缓冲时间（秒），期间闪烁但不移动' })
    bossEntranceBufferTime: number = 1;

    @property({ group: 'Boss Config', tooltip: 'Boss 开场玩家武器锁定时长（秒）' })
    bossIntroWeaponLockTime: number = 0.6;

    @property({ group: 'Boss Config', tooltip: 'Boss 战矩形区域宽度' })
    bossArenaWidth: number = 760;

    @property({ group: 'Boss Config', tooltip: 'Boss 战矩形区域高度' })
    bossArenaHeight: number = 420;

    @property({ type: CCInteger, group: 'Boss Config', tooltip: '达到击杀数后可见 Boss（<=0 表示不使用该条件）' })
    bossKillRequirement: number = 180;

    @property({ type: CCInteger, group: 'Boss Config', tooltip: '达到分数后可见 Boss（<=0 表示不使用该条件）' })
    bossScoreRequirement: number = 1500;

    @property({ type: Enum(BossUnlockMode), group: 'Boss Config', tooltip: 'Any: 满足任一条件解锁；All: 需要同时满足' })
    bossUnlockMode: BossUnlockMode = BossUnlockMode.Any;

    @property({ group: 'Boss Config', tooltip: 'Boss 生命倍率' })
    bossHpMultiplier: number = 30;

    @property({ group: 'Boss Config', tooltip: 'Boss 经验倍率' })
    bossExpMultiplier: number = 5;

    @property({ group: 'Boss Config', tooltip: 'Boss 分数倍率' })
    bossScoreMultiplier: number = 10;

    @property({ group: 'Visual Config', tooltip: '玩家视觉缩放倍率（相对预制体原始尺寸）' })
    playerVisualScaleMultiplier: number = 0.72;

    @property({ group: 'Visual Config', tooltip: '普通敌人视觉缩放倍率（相对预制体原始尺寸）' })
    enemyVisualScaleMultiplier: number = 0.72;

    @property({ group: 'Visual Config', tooltip: 'Boss 视觉缩放倍率（相对预制体原始尺寸）' })
    bossVisualScaleMultiplier: number = 1.18;

    @property({ group: 'Combat Config', tooltip: '普通攻击子弹发射间隔倍率（>1 更慢）' })
    normalAttackIntervalMultiplier: number = 1.7;

    @property({ group: 'Combat Config', tooltip: '普通攻击最小发射间隔（秒）' })
    normalAttackMinInterval: number = 0.45;

    @property({ group: 'Balance Config', tooltip: '启用配置表驱动的节奏系统（经验/压力曲线/精英/资源）' })
    enableBalanceTable: boolean = true;

    @property({ group: 'Collection Config', tooltip: '启用稀有收藏敌人随机刷新' })
    rareSpawnEnabled: boolean = true;

    @property({ group: 'Collection Config', tooltip: '稀有收藏敌人最早出现时间（秒）' })
    rareSpawnStartTime: number = 28;

    @property({ group: 'Collection Config', tooltip: '稀有收藏敌人最短刷新间隔（秒）' })
    rareSpawnIntervalMin: number = 16;

    @property({ group: 'Collection Config', tooltip: '稀有收藏敌人最长刷新间隔（秒）' })
    rareSpawnIntervalMax: number = 28;

    @property({ group: 'Collection Config', tooltip: '稀有收藏敌人基础出现概率' })
    rareSpawnChance: number = 0.42;

    @property({ group: 'Collection Config', tooltip: '连续未出现时的保底概率增量' })
    rareSpawnPityBonus: number = 0.12;

    @property({ type: CCInteger, group: 'Collection Config', tooltip: '同屏稀有收藏敌人上限' })
    rareMaxAlive: number = 1;

    //自行扩展控制策略
    //....


    private static _inst: BulletHell = null;
    private _spawnCooldowns: Map<string, number> = new Map();
    private _totalKills = 0;
    private _totalScore = 0;
    private _currentStageIndex = 0;
    private _stageScore = 0;
    private _bossSpawned = false;
    private _bossAlive = false;
    private _bossSpawnQueued = false;
    private _isGameCleared = false;
    private _bossFightActive = false;
    private _bossArenaCenter = new Vec3();
    private _bossIntroCameraLockTime = 0;
    private _cameraShakeTimer = 0;
    private _cameraShakeDuration = 0;
    private _cameraShakeStrength = 0;
    private _bossIntroAttackLockTime = 0;
    private _bossIntroGunsLocked = false;
    private _bossArenaHintNode: Node = null;
    private _bossArenaHintGraphics: Graphics = null;
    private _bossArenaHintFlashTime = 0;
    private _balanceTables: StageBalanceTable[] = [];
    private _stageElapsedTime = 0;
    private _nextEliteSpawnTime = 0;
    private _nextRareSpawnTime = 0;
    private _rareSpawnMissStreak = 0;
    private _lastReliefDropTime = -9999;
    private _reliefCheckTimer = 0;
    private _playerInstance: Player = null;
    private _isPlayerDefeated = false;
    private _gameOverOverlay: Node = null;
    private _gameOverStatsLabel: Label = null;

    static get inst() {
        return this._inst;
    }

    onLoad(): void {
        BulletHell._inst = this;
        Enemy.on(EnemyEvents.ON_KILLED, this.onEnemyKilled, this);
    }

    onDestroy(): void {
        this.detachPlayerDeathListener();

        Enemy.off(EnemyEvents.ON_KILLED, this.onEnemyKilled, this);

        cCollider.inst.clear();
        BossEnemy.clearPools();
        Ghost.pools.length = 0;
        Skill.pools = new WeakMap();
        Bullet.pools.length = 0;
        SnailTail.pools.length = 0;
        TemporaryPickup.clearPools();
    }

    start(): void {

        // 场景里如果序列化了旧值，运行时至少保证普通攻击节奏被明显放慢。
        this.normalAttackIntervalMultiplier = Math.max(1.7, this.normalAttackIntervalMultiplier);
        this.normalAttackMinInterval = Math.max(0.2, this.normalAttackMinInterval);

        //创建主角直接挂在场景下
        let node = instantiate(this.player);
        this.node.addChild(node);
        this._playerInstance = node.getComponent(Player);
        this._playerInstance?.on(PlayerHealthEvents.ON_DEATH, this.onPlayerDeath, this);

        tempPos.set(node.scale).multiplyScalar(Math.max(0.1, this.playerVisualScaleMultiplier));
        node.setScale(tempPos);

        Enemy.normalVisualScaleMultiplier = Math.max(0.1, this.enemyVisualScaleMultiplier);
        Enemy.bossVisualScaleMultiplier = Math.max(Enemy.normalVisualScaleMultiplier, this.bossVisualScaleMultiplier);

        this.ensureDefaultStages();

        this._currentStageIndex = 0;
        this._stageScore = 0;
        this._bossSpawned = false;
        this._bossAlive = false;
        this._bossSpawnQueued = false;
        this._isGameCleared = false;
        this._bossFightActive = false;
        this._bossArenaCenter.set(Vec3.ZERO);
        this._bossIntroAttackLockTime = 0;
        this._bossIntroGunsLocked = false;
        this._stageElapsedTime = 0;
        this._nextEliteSpawnTime = 0;
        this._nextRareSpawnTime = Math.max(1, this.rareSpawnStartTime);
        this._rareSpawnMissStreak = 0;
        this._lastReliefDropTime = -9999;
        this._reliefCheckTimer = 0;

        this.setupBalanceTables();
        this.applyStageBalanceContext();

        this.ensureBossArenaHintNode();

        if (this.stages.length > 0) {
            console.log(`[BulletHell] 进入关卡 ${this._currentStageIndex + 1}/${this.stages.length}：${this.getCurrentStageName()}`);
            if (this.stages.length < 2) {
                console.warn('[BulletHell] 当前仅配置了 1 关，若需多关制请至少配置 2 个 StageConfig');
            }
        }

        if (this.debugStartWithBossFight) {
            this.scheduleOnce(() => {
                this.forceEnterCurrentStageBossFight();
            }, 0);
        }

        //定时刷怪
        this.schedule(() => {
            this.trySpawnRegularEnemy();
        }, Math.max(this.cyclTime, 0.08));
    }

    private onPlayerDeath(): void {
        // 仅标记玩家已进入死亡流程；真正的结算逻辑在死亡动画播放完后再执行。
    }

    private ensureDefaultStages(): void {
        if (this.stages.length >= 2) {
            return;
        }

        if (this.stages.length === 0) {
            this.stages = [this.createDefaultStage1(), this.createDefaultStage2()];
            console.warn('[BulletHell] 未配置 stages，已自动注入默认两关参数');
            return;
        }

        const stage1 = this.stages[0];
        const stage2 = this.createDefaultStage2(stage1);
        this.stages.push(stage2);
        console.warn('[BulletHell] 仅配置了 1 关，已自动补齐第 2 关参数');
    }

    private createDefaultStage1(): StageConfig {
        const stage = new StageConfig();
        stage.stageName = 'Stage 1';
        stage.scoreToSummonBoss = 900;
        stage.maxEnemies = Math.max(20, this.max);
        stage.minSpawnRadius = this.minSpawnRadius;
        stage.maxSpawnRadius = this.maxSpawnRadius;
        stage.bossPrefab = this.bossPrefab;
        stage.bossSpawnDelay = Math.max(0.5, this.bossSpawnDelay);
        stage.bossEntranceBufferTime = Math.max(0.8, this.bossEntranceBufferTime);
        stage.bossArenaWidth = Math.max(640, this.bossArenaWidth);
        stage.bossArenaHeight = Math.max(360, this.bossArenaHeight);
        stage.bossHpMultiplier = Math.max(24, this.bossHpMultiplier);
        stage.bossExpMultiplier = Math.max(2, this.bossExpMultiplier);
        stage.bossScoreMultiplier = Math.max(4, this.bossScoreMultiplier);

        stage.enemySpawnConfigs = this.buildDefaultStageEnemyConfigs(1.0, 1.0);
        return stage;
    }

    private createDefaultStage2(base?: StageConfig): StageConfig {
        const stage = new StageConfig();
        stage.stageName = 'Stage 2';
        stage.scoreToSummonBoss = Math.max(1800, (base?.scoreToSummonBoss ?? 900) + 900);
        stage.maxEnemies = Math.max(30, Math.floor((base?.maxEnemies || this.max) * 1.25));
        stage.minSpawnRadius = base?.minSpawnRadius || this.minSpawnRadius;
        stage.maxSpawnRadius = base?.maxSpawnRadius || this.maxSpawnRadius;
        stage.bossPrefab = base?.bossPrefab || this.bossPrefab;
        stage.bossSpawnDelay = Math.max(0.5, base?.bossSpawnDelay ?? this.bossSpawnDelay);
        stage.bossEntranceBufferTime = Math.max(1, base?.bossEntranceBufferTime ?? this.bossEntranceBufferTime);
        stage.bossArenaWidth = Math.max(760, base?.bossArenaWidth ?? this.bossArenaWidth);
        stage.bossArenaHeight = Math.max(420, base?.bossArenaHeight ?? this.bossArenaHeight);
        stage.bossHpMultiplier = Math.max(42, (base?.bossHpMultiplier ?? this.bossHpMultiplier) + 12);
        stage.bossExpMultiplier = Math.max(3, (base?.bossExpMultiplier ?? this.bossExpMultiplier) + 1);
        stage.bossScoreMultiplier = Math.max(6, (base?.bossScoreMultiplier ?? this.bossScoreMultiplier) + 2);

        stage.enemySpawnConfigs = this.buildDefaultStageEnemyConfigs(1.25, 0.8);
        return stage;
    }

    private buildDefaultStageEnemyConfigs(weightScale: number, intervalScale: number): EnemySpawnConfig[] {
        const configs: EnemySpawnConfig[] = [];

        if (this.ghost) {
            const ghostConfig = new EnemySpawnConfig();
            ghostConfig.prefab = this.ghost;
            ghostConfig.kind = EnemyKind.Ghost;
            ghostConfig.weight = Math.max(1, Math.floor(3 * weightScale));
            ghostConfig.spawnInterval = Math.max(0.12, 0.35 * intervalScale);
            ghostConfig.maxAlive = 0;
            ghostConfig.enabled = true;
            configs.push(ghostConfig);
        }

        if (this.snailTail) {
            const snailConfig = new EnemySpawnConfig();
            snailConfig.prefab = this.snailTail;
            snailConfig.kind = EnemyKind.SnailTail;
            snailConfig.weight = Math.max(1, Math.floor(2 * weightScale));
            snailConfig.spawnInterval = Math.max(0.12, 0.4 * intervalScale);
            snailConfig.maxAlive = 0;
            snailConfig.enabled = true;
            configs.push(snailConfig);
        }

        return configs;
    }

    private onEnemyKilled(data: EnemyKilledEventData): void {
        if (data.killedByPlayer) {
            this._totalKills += 1;
            this._totalScore += Math.max(0, data.score || 0);
            this._stageScore += Math.max(0, data.score || 0);

            const collectionResult = CollectionSystem.recordEnemyKill(data);
            if (collectionResult.unlockedNow && collectionResult.snapshot) {
                console.log(`[Collection] 已解锁卡片：${collectionResult.snapshot.definition.name}`);
            }
        }

        if (data.isBoss) {
            this._bossAlive = false;
            this.onBossDefeated();
            return;
        }

        if (this._bossSpawned || this._bossAlive || this._bossSpawnQueued) {
            return;
        }

        if (!this.canUnlockBossByCurrentStage()) {
            return;
        }

        this.queueBossSpawn();
    }

    private setupBalanceTables(): void {
        if (!this.enableBalanceTable) {
            this._balanceTables = [];
            return;
        }

        const defaults = getDefaultBalanceTables();
        const desiredCount = Math.max(1, this.stages.length);
        this._balanceTables = [];

        for (let i = 0; i < desiredCount; i++) {
            this._balanceTables.push(defaults[Math.min(i, defaults.length - 1)]);
        }
    }

    private getCurrentBalanceTable(): StageBalanceTable | null {
        if (!this.enableBalanceTable || this._balanceTables.length === 0) {
            return null;
        }

        const index = Math.max(0, Math.min(this._currentStageIndex, this._balanceTables.length - 1));
        return this._balanceTables[index] ?? null;
    }

    private applyStageBalanceContext(): void {
        this._stageElapsedTime = 0;
        this._reliefCheckTimer = 0;
        this._lastReliefDropTime = -9999;

        const table = this.getCurrentBalanceTable();
        const eliteStart = table?.elite.startTimeSec ?? 99999;
        this._nextEliteSpawnTime = Math.max(0.5, eliteStart);

        if (ExperienceSystem.inst) {
            ExperienceSystem.inst.configureExpCurve(table?.expCurve ?? []);
        }
    }

    private getCurrentPressureSample() {
        const table = this.getCurrentBalanceTable();
        return samplePressureAtTime(table?.pressureCurve ?? [], this._stageElapsedTime);
    }

    private canUnlockBoss(): boolean {
        const useKillReq = this.bossKillRequirement > 0;
        const useScoreReq = this.bossScoreRequirement > 0;

        if (!useKillReq && !useScoreReq) {
            return true;
        }

        const killOk = !useKillReq || this._totalKills >= this.bossKillRequirement;
        const scoreOk = !useScoreReq || this._totalScore >= this.bossScoreRequirement;

        if (this.bossUnlockMode === BossUnlockMode.All) {
            return killOk && scoreOk;
        }
        return killOk || scoreOk;
    }

    private canUnlockBossByCurrentStage(): boolean {
        const stage = this.getCurrentStage();
        if (!stage) {
            if (!this.bossPrefab) {
                return false;
            }
            return this.canUnlockBoss();
        }

        if (!stage.bossPrefab) {
            return false;
        }

        const targetScore = Math.max(0, stage.scoreToSummonBoss);
        if (targetScore <= 0) {
            return true;
        }

        return this._stageScore >= targetScore;
    }

    private queueBossSpawn(): void {
        this._bossSpawnQueued = true;
        this.clearActiveEnemiesForBossPhase();

        const stage = this.getCurrentStage();
        const delay = Math.max(0, stage?.bossSpawnDelay ?? this.bossSpawnDelay);
        this.scheduleOnce(() => {
            this._bossSpawnQueued = false;
            this.spawnBoss();
        }, delay);
    }

    public forceEnterCurrentStageBossFight(): void {
        if (this._isGameCleared || this._bossAlive || this._bossSpawned || this._bossSpawnQueued) {
            return;
        }

        const stage = this.getCurrentStage();
        const bossPrefab = stage?.bossPrefab ?? this.bossPrefab;
        if (!bossPrefab) {
            console.warn('[BulletHell] 无法直接进入 Boss 战：当前关未配置 Boss Prefab');
            return;
        }

        this.clearActiveEnemiesForBossPhase();
        this._bossSpawnQueued = false;
        this._bossSpawned = false;
        this._bossAlive = false;

        const targetScore = Math.max(0, stage?.scoreToSummonBoss ?? 0);
        if (targetScore > 0) {
            this._stageScore = Math.max(this._stageScore, targetScore);
        }

        this.spawnBoss();
    }

    private spawnBoss(): void {
        if (!this.objects) {
            return;
        }

        const stage = this.getCurrentStage();
        const bossPrefab = stage?.bossPrefab ?? this.bossPrefab;
        const hpMultiplier = stage?.bossHpMultiplier ?? this.bossHpMultiplier;
        const expMultiplier = stage?.bossExpMultiplier ?? this.bossExpMultiplier;
        const scoreMultiplier = stage?.bossScoreMultiplier ?? this.bossScoreMultiplier;
        const entranceBufferTime = stage?.bossEntranceBufferTime ?? this.bossEntranceBufferTime;

        if (!bossPrefab) {
            return;
        }

        const boss = BossEnemy.get(bossPrefab);
        if (!boss) {
            console.error('[BulletHell] Boss prefab missing BossEnemy component or failed to instantiate.');
            return;
        }

        boss.setBossMode(true, hpMultiplier, expMultiplier, scoreMultiplier);
    boss.applyBossCollectionMetadata();
        boss.insert(this.objects);

        // 斗兽场开场：以 Boss 出现点作为战场中心，避免与玩家重叠并强调关底仪式感。
        if (Player.inst) {
            tempPos.set(Player.inst.getPosition());
        } else {
            tempPos.set(Vec3.ZERO);
        }

        this.activateBossArena(tempPos);
        boss.setPosition(tempPos);
        boss.init();
        boss.beginBossEntranceBuffer(entranceBufferTime);

        this.placePlayerAtArenaStart();
        this._bossIntroCameraLockTime = Math.max(this._bossIntroCameraLockTime, entranceBufferTime + 0.1);

        this._bossIntroAttackLockTime = Math.max(0, this.bossIntroWeaponLockTime);
        if (this._bossIntroAttackLockTime > 0) {
            this.setPlayerWeaponsEnabled(false);
            this._bossIntroGunsLocked = true;
        }

        this._bossSpawned = true;
        this._bossAlive = true;

        console.log(`[BulletHell] 第 ${this._currentStageIndex + 1} 关 Boss 已生成，本关分数=${this._stageScore}，总分=${this._totalScore}`);
    }

    private onBossDefeated(): void {
        this.grantBossRewards();

        const nextStageIndex = this._currentStageIndex + 1;
        if (nextStageIndex >= this.stages.length || this.stages.length === 0) {
            this._isGameCleared = true;
            this.deactivateBossArena();
            this._bossIntroCameraLockTime = 0;
            this._bossIntroAttackLockTime = 0;
            if (this._bossIntroGunsLocked) {
                this.setPlayerWeaponsEnabled(true);
                this._bossIntroGunsLocked = false;
            }
            console.log(`[BulletHell] 最终 Boss 已击败，通关完成。总击杀=${this._totalKills}，总分=${this._totalScore}`);
            return;
        }

        this._currentStageIndex = nextStageIndex;
        this._stageScore = 0;
        this._bossSpawned = false;
        this._bossAlive = false;
        this._bossSpawnQueued = false;
        this._spawnCooldowns.clear();
        this.applyStageBalanceContext();
        this.deactivateBossArena();
        this._bossIntroCameraLockTime = 0;
        this._bossIntroAttackLockTime = 0;
        if (this._bossIntroGunsLocked) {
            this.setPlayerWeaponsEnabled(true);
            this._bossIntroGunsLocked = false;
        }

        console.log(`[BulletHell] 进入关卡 ${this._currentStageIndex + 1}/${this.stages.length}：${this.getCurrentStageName()}`);
    }

    private trySpawnRegularEnemy(): void {
        if (this.isGameOverActive()) {
            return;
        }

        if (this._isGameCleared) {
            return;
        }

        if (this._bossSpawnQueued || this._bossAlive || this._bossSpawned) {
            return;
        }

        const pressure = this.getCurrentPressureSample();
        const stageMax = Math.max(1, Math.floor(this.getCurrentStageMaxEnemies() * Math.max(0.2, pressure.maxAliveMul)));
        if (!this.objects || this.objects.children.length >= stageMax) {
            return;
        }

        const configs = this.getSpawnConfigs();
        if (configs.length === 0) {
            return;
        }

        const now = performance.now() * 0.001;
        const candidates: EnemySpawnConfig[] = [];

        for (const config of configs) {
            if (!config.enabled || !config.prefab) {
                continue;
            }

            if (config.maxAlive > 0 && this.countAliveByKind(config.kind) >= config.maxAlive) {
                continue;
            }

            const key = this.getConfigKey(config);
            const cooldownEnd = this._spawnCooldowns.get(key) ?? 0;
            if (now < cooldownEnd) {
                continue;
            }

            candidates.push(config);
        }

        if (candidates.length === 0) {
            return;
        }

        const selected = this.pickConfigByWeight(candidates);
        if (!selected) {
            return;
        }

        this.spawnRegularByConfig(selected);
        const interval = Math.max(0.02, selected.spawnInterval / Math.max(0.2, pressure.spawnRateMul));
        this._spawnCooldowns.set(this.getConfigKey(selected), now + interval);
    }

    private spawnRegularByConfig(config: EnemySpawnConfig): void {
        const pressure = this.getCurrentPressureSample();
        const enemy = this.getEnemyFromPrefab(config.kind, config.prefab);
        if (!enemy) {
            return;
        }

        enemy.setBossMode(false);
        enemy.setEliteMode(false, EliteSkillType.Dash);
        this.applyCollectionMetadataForRegularEnemy(enemy, config.kind);
        enemy.setDifficultyScaling(pressure.normalHpMul, pressure.normalSpeedMul, 1, 1);
        enemy.insert(this.objects);
        const { minRadius, maxRadius } = this.getRegularSpawnRadiusRange();
        this.getSpawnPosition(tempPos, minRadius, maxRadius);
        enemy.setPosition(tempPos);
        enemy.init();
    }

    private spawnEliteEnemy(): void {
        const table = this.getCurrentBalanceTable();
        const rule = table?.elite;
        if (!rule || !rule.enabled || this._bossAlive || this._bossSpawnQueued || this._bossSpawned) {
            return;
        }

        if (!this.objects || this.objects.children.length >= this.getCurrentStageMaxEnemies()) {
            return;
        }

        if (this._stageElapsedTime < rule.startTimeSec) {
            return;
        }

        if (this.countAliveEliteEnemies() >= Math.max(1, rule.maxAlive)) {
            return;
        }

        const configs = this.getSpawnConfigs();
        if (configs.length === 0) {
            return;
        }

        const selected = this.pickConfigByWeight(configs);
        if (!selected) {
            return;
        }

        const pressure = this.getCurrentPressureSample();
        const enemy = this.getEnemyFromPrefab(selected.kind, selected.prefab);
        if (!enemy) {
            return;
        }

        enemy.setBossMode(false);
        enemy.setEliteMode(true, rule.skillType, rule.skillCooldown, rule.explodeRadius, rule.explodeDamage);
        this.applyCollectionMetadataForRegularEnemy(enemy, selected.kind);
        enemy.setDifficultyScaling(
            pressure.normalHpMul * rule.hpMul,
            pressure.normalSpeedMul * rule.speedMul,
            rule.expMul,
            rule.scoreMul
        );

        enemy.insert(this.objects);
        const { minRadius, maxRadius } = this.getRegularSpawnRadiusRange();
        this.getSpawnPosition(tempPos, minRadius, maxRadius);
        enemy.setPosition(tempPos);
        enemy.init();
    }

    private countAliveEliteEnemies(): number {
        if (!this.objects) {
            return 0;
        }

        let count = 0;
        for (const child of this.objects.children) {
            const enemy = child.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isBoss) {
                continue;
            }
            if (enemy.isElite) {
                count++;
            }
        }
        return count;
    }

    private trySpawnReliefPickup(): void {
        const table = this.getCurrentBalanceTable();
        const relief = table?.relief;
        if (!relief || !relief.enabled || !Player.inst || !Player.inst.isAlive) {
            return;
        }

        if (this._stageElapsedTime - this._lastReliefDropTime < relief.minIntervalBetweenDropsSec) {
            return;
        }

        const pressure = this.getCurrentPressureSample();
        const hpRate = Player.inst.hpPercentage;
        const criticalHpThreshold = Math.max(0.1, relief.hpThreshold - 0.2);
        const isCriticalHp = hpRate <= criticalHpThreshold;
        const isUnderPressure = pressure.pressureIndex >= relief.pressureThreshold;
        const isLowHp = hpRate <= relief.hpThreshold;
        const shouldDrop = isCriticalHp || (isLowHp && isUnderPressure);
        if (!shouldDrop) {
            return;
        }

        const minuteScale = this._stageElapsedTime / 60;
        const expAmount = relief.expBurstBase + relief.expBurstPerMinute * minuteScale;
        if (isCriticalHp || isUnderPressure) {
            this.spawnPickupNearPlayer('exp_burst', expAmount, 0, 10);
        }

        if (isCriticalHp) {
            this.spawnPickupNearPlayer('heal_burst', relief.healAmount, 0, 8);
        } else {
            this.spawnPickupNearPlayer('temporary_damage_boost', relief.damageBoostMultiplier, relief.damageBoostDurationSec, 8);
        }

        this._lastReliefDropTime = this._stageElapsedTime;
    }

    private spawnPickupNearPlayer(effectType: PickupEffectType, effectValue: number, effectDuration: number, lifeTime: number): void {
        if (!this.temporaryPickupPrefab || !this.objects || !Player.inst) {
            return;
        }

        const pickup = TemporaryPickup.get(this.temporaryPickupPrefab);
        if (!pickup) {
            return;
        }

        pickup.insert(this.objects);

        const playerPos = Player.inst.getPosition();
        const angle = Math.random() * Math.PI * 2;
        const dist = 56 + Math.random() * 120;
        tempPos.set(
            playerPos.x + Math.cos(angle) * dist,
            playerPos.y + Math.sin(angle) * dist,
            0
        );

        pickup.initPickup(effectType, effectValue, effectDuration, lifeTime, tempPos);
    }

    private grantBossRewards(): void {
        const table = this.getCurrentBalanceTable();
        const reward = table?.bossReward;
        if (!reward) {
            return;
        }

        if (ExperienceSystem.inst) {
            const bonusExp = Math.max(1, Math.floor(reward.bonusExp + reward.bonusExpPerMinute * (this._stageElapsedTime / 60)));
            ExperienceSystem.inst.addExp(bonusExp, 'boss-reward');
        }

        const dropCount = Math.max(0, Math.floor(reward.bonusPickupCount));
        for (let i = 0; i < dropCount; i++) {
            const isExp = i % 2 === 0;
            const effectType: PickupEffectType = isExp ? 'exp_burst' : 'temporary_damage_boost';
            const value = isExp ? 80 + this._stageElapsedTime * 0.6 : 1.25;
            const duration = isExp ? 0 : 7;
            this.spawnPickupNearPlayer(effectType, value, duration, 12);
        }

        SkillSelectionSystem.inst?.triggerBossRewardSelection(Math.max(3, reward.rewardSkillOptionCount));
    }

    private getRegularSpawnRadiusRange(): { minRadius: number; maxRadius: number } {
        let minRadius = this.getCurrentMinSpawnRadius();
        let maxRadius = this.getCurrentMaxSpawnRadius();

        if (this.mobileNearSpawnEnabled) {
            minRadius = this.mobileNearSpawnMinRadius;
            maxRadius = this.mobileNearSpawnMaxRadius;
        }

        minRadius = Math.max(40, minRadius);
        maxRadius = Math.max(minRadius + 40, maxRadius);

        return { minRadius, maxRadius };
    }

    private getSpawnPosition(out: Vec3, minRadius: number, maxRadius: number): void {
        const center = Player.inst ? Player.inst.getPosition() : Vec3.ZERO;
        const min = Math.max(0, minRadius);
        const max = Math.max(min + 1, maxRadius > 0 ? maxRadius : this.raidus);
        const angle = Math.random() * Math.PI * 2;
        const dist = min + Math.random() * (max - min);

        out.set(
            center.x + Math.cos(angle) * dist,
            center.y + Math.sin(angle) * dist,
            0
        );
    }

    private getSpawnConfigs(): EnemySpawnConfig[] {
        const stage = this.getCurrentStage();
        const fromStage = stage?.enemySpawnConfigs?.filter(c => c && c.prefab && c.enabled) ?? [];
        if (fromStage.length > 0) {
            return fromStage;
        }

        const fromEditor = this.enemySpawnConfigs.filter(c => c && c.prefab && c.enabled);
        if (fromEditor.length > 0) {
            return fromEditor;
        }

        const fallback: EnemySpawnConfig[] = [];
        if (this.ghost) {
            fallback.push({
                prefab: this.ghost,
                kind: EnemyKind.Ghost,
                weight: 1,
                spawnInterval: 0.25,
                maxAlive: 0,
                enabled: true,
            } as EnemySpawnConfig);
        }
        if (this.snailTail) {
            fallback.push({
                prefab: this.snailTail,
                kind: EnemyKind.SnailTail,
                weight: 1,
                spawnInterval: 0.25,
                maxAlive: 0,
                enabled: true,
            } as EnemySpawnConfig);
        }

        return fallback;
    }

    private getCurrentStage(): StageConfig | null {
        if (!this.stages || this.stages.length === 0) {
            return null;
        }
        return this.stages[Math.max(0, Math.min(this._currentStageIndex, this.stages.length - 1))] ?? null;
    }

    private getCurrentStageName(): string {
        const stage = this.getCurrentStage();
        if (!stage) {
            return 'Default Stage';
        }
        return stage.stageName || `Stage-${this._currentStageIndex + 1}`;
    }

    private getCurrentStageMaxEnemies(): number {
        const stage = this.getCurrentStage();
        if (stage && stage.maxEnemies > 0) {
            return stage.maxEnemies;
        }
        return this.max;
    }

    private getCurrentMinSpawnRadius(): number {
        const stage = this.getCurrentStage();
        if (stage && stage.minSpawnRadius > 0) {
            return stage.minSpawnRadius;
        }
        return this.minSpawnRadius;
    }

    private getCurrentMaxSpawnRadius(): number {
        const stage = this.getCurrentStage();
        if (stage && stage.maxSpawnRadius > 0) {
            return stage.maxSpawnRadius;
        }
        return this.maxSpawnRadius;
    }

    private getCurrentBossArenaWidth(): number {
        const stage = this.getCurrentStage();
        const arenaWidth = stage?.bossArenaWidth ?? this.bossArenaWidth;
        return Math.max(220, arenaWidth);
    }

    private getCurrentBossArenaHeight(): number {
        const stage = this.getCurrentStage();
        const arenaHeight = stage?.bossArenaHeight ?? this.bossArenaHeight;
        return Math.max(160, arenaHeight);
    }

    private activateBossArena(center?: Vec3): void {
        this._bossFightActive = true;
        if (center) {
            this._bossArenaCenter.set(center);
        } else {
            const fallbackCenter = Player.inst ? Player.inst.getPosition() : Vec3.ZERO;
            this._bossArenaCenter.set(fallbackCenter);
        }

        if (Player.inst) {
            tempPos.set(Player.inst.getPosition());
            this.clampPositionToBossArena(tempPos);
            Player.inst.setPosition(tempPos);
        }

        console.log(`[BulletHell] Boss 战场已激活，中心=(${this._bossArenaCenter.x.toFixed(1)}, ${this._bossArenaCenter.y.toFixed(1)}), 尺寸=${this.getCurrentBossArenaWidth().toFixed(0)}x${this.getCurrentBossArenaHeight().toFixed(0)}`);
    }

    private deactivateBossArena(): void {
        this._bossFightActive = false;
        this._bossIntroCameraLockTime = 0;
        this._bossIntroAttackLockTime = 0;
        this.updateBossArenaHint(0);
    }

    private setPlayerWeaponsEnabled(enabled: boolean): void {
        if (!Player.inst) {
            return;
        }

        const guns = Player.inst.node.getComponentsInChildren(Gun);
        for (const gun of guns) {
            gun.enabled = enabled;
            if (!enabled) {
                gun.nextCycle = Math.max(gun.nextCycle, this.bossIntroWeaponLockTime);
            }
        }
    }

    private ensureBossArenaHintNode(): void {
        if (this._bossArenaHintNode && this._bossArenaHintGraphics) {
            return;
        }

        const node = new Node('BossArenaHint');
        const transform = node.addComponent(UITransform);
        transform.setContentSize(2, 2);
        const graphics = node.addComponent(Graphics);
        graphics.lineWidth = 5;
        graphics.strokeColor = new Color(255, 215, 120, 220);

        this.node.addChild(node);

        this._bossArenaHintNode = node;
        this._bossArenaHintGraphics = graphics;
        this._bossArenaHintNode.active = false;
    }

    private updateBossArenaHint(dt: number): void {
        if (!this._bossArenaHintNode || !this._bossArenaHintGraphics) {
            return;
        }

        const shouldShow = this._bossFightActive;
        this._bossArenaHintNode.active = shouldShow;
        if (!shouldShow) {
            this._bossArenaHintGraphics.clear();
            return;
        }

        let alpha = 220;
        if (this._bossIntroCameraLockTime > 0) {
            this._bossArenaHintFlashTime += dt;
            const wave = 0.5 + 0.5 * Math.sin(this._bossArenaHintFlashTime * 14);
            alpha = 120 + Math.floor(wave * 120);
        }

        this._bossArenaHintNode.setPosition(this._bossArenaCenter);

        const halfW = this.getCurrentBossArenaWidth() * 0.5;
        const halfH = this.getCurrentBossArenaHeight() * 0.5;

        const g = this._bossArenaHintGraphics;
        g.clear();
        g.lineWidth = 5;
        g.strokeColor = new Color(255, 220, 120, alpha);
        g.rect(-halfW, -halfH, halfW * 2, halfH * 2);
        g.stroke();
    }

    private placePlayerAtArenaStart(): void {
        if (!Player.inst) {
            return;
        }

        const halfHeight = this.getCurrentBossArenaHeight() * 0.5;
        const startOffsetY = Math.max(120, halfHeight * 0.65);
        tempPos.set(this._bossArenaCenter.x, this._bossArenaCenter.y - startOffsetY, 0);
        this.clampPositionToBossArena(tempPos);

        Player.inst.velocity.set(Vec3.ZERO);
        Player.inst.setPosition(tempPos);
    }

    public isBossFightActive(): boolean {
        return this._bossFightActive;
    }

    public clampPositionToBossArena(position: Vec3): void {
        if (!this._bossFightActive) {
            return;
        }

        const halfWidth = this.getCurrentBossArenaWidth() * 0.5;
        const halfHeight = this.getCurrentBossArenaHeight() * 0.5;

        position.x = Math.max(this._bossArenaCenter.x - halfWidth, Math.min(this._bossArenaCenter.x + halfWidth, position.x));
        position.y = Math.max(this._bossArenaCenter.y - halfHeight, Math.min(this._bossArenaCenter.y + halfHeight, position.y));
    }

    public projectBossArenaEdgePoint(origin: Vec3, direction: Vec3, out: Vec3): void {
        out.set(origin);
        if (!this._bossFightActive || direction.lengthSqr() <= 0.0001) {
            this.clampPositionToBossArena(out);
            return;
        }

        const halfWidth = this.getCurrentBossArenaWidth() * 0.5;
        const halfHeight = this.getCurrentBossArenaHeight() * 0.5;
        const minX = this._bossArenaCenter.x - halfWidth;
        const maxX = this._bossArenaCenter.x + halfWidth;
        const minY = this._bossArenaCenter.y - halfHeight;
        const maxY = this._bossArenaCenter.y + halfHeight;

        let travel = Number.POSITIVE_INFINITY;
        if (Math.abs(direction.x) > 0.0001) {
            const targetX = direction.x > 0 ? maxX : minX;
            travel = Math.min(travel, (targetX - origin.x) / direction.x);
        }
        if (Math.abs(direction.y) > 0.0001) {
            const targetY = direction.y > 0 ? maxY : minY;
            travel = Math.min(travel, (targetY - origin.y) / direction.y);
        }

        if (!Number.isFinite(travel) || travel < 0) {
            this.clampPositionToBossArena(out);
            return;
        }

        out.set(
            origin.x + direction.x * travel,
            origin.y + direction.y * travel,
            origin.z,
        );
        this.clampPositionToBossArena(out);
    }

    private clearActiveEnemiesForBossPhase(): void {
        if (!this.objects) {
            return;
        }

        const activeEnemies = [...this.objects.children];
        let clearedCount = 0;

        for (const child of activeEnemies) {
            const enemy = child.getComponent(Enemy);
            if (!enemy || enemy.isBoss) {
                continue;
            }

            const recycle = (enemy.constructor as any).put;
            if (typeof recycle === 'function') {
                recycle.call(enemy.constructor, enemy);
            } else {
                enemy.remove(false);
            }
            clearedCount++;
        }

        if (clearedCount > 0) {
            console.log(`[BulletHell] Boss 阶段开始，已清理场上 ${clearedCount} 个小怪`);
        }
    }

    private getConfigKey(config: EnemySpawnConfig): string {
        return `${config.kind}:${config.prefab?.name || 'none'}`;
    }

    private pickConfigByWeight(configs: EnemySpawnConfig[]): EnemySpawnConfig | null {
        let totalWeight = 0;
        for (const c of configs) {
            totalWeight += Math.max(0, c.weight);
        }

        if (totalWeight <= 0) {
            return configs[0] ?? null;
        }

        let seed = Math.random() * totalWeight;
        for (const c of configs) {
            seed -= Math.max(0, c.weight);
            if (seed <= 0) {
                return c;
            }
        }

        return configs[configs.length - 1] ?? null;
    }

    private countAliveByKind(kind: EnemyKind): number {
        if (!this.objects) {
            return 0;
        }

        let count = 0;
        for (const child of this.objects.children) {
            const enemy = child.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isBoss) {
                continue;
            }

            if (kind === EnemyKind.Ghost && enemy instanceof Ghost) {
                count++;
            } else if (kind === EnemyKind.SnailTail && enemy instanceof SnailTail) {
                count++;
            }
        }
        return count;
    }

    private getEnemyFromPrefab(kind: EnemyKind, prefab: Prefab): Enemy | null {
        if (!prefab) {
            return null;
        }

        if (kind === EnemyKind.Ghost) {
            return Ghost.get(prefab);
        }
        if (kind === EnemyKind.SnailTail) {
            return SnailTail.get(prefab);
        }

        return null;
    }

    private getCollectionIdForRegularKind(kind: EnemyKind): string {
        return kind === EnemyKind.SnailTail ? 'snail_tail' : 'ghost';
    }

    private applyCollectionMetadataForRegularEnemy(enemy: Enemy, kind: EnemyKind): void {
        const definition = CollectionSystem.getDefinition(this.getCollectionIdForRegularKind(kind));
        enemy.resetCollectionMetadata();
        if (definition) {
            enemy.setCollectionMetadata(definition.id, definition.name, false);
        }
    }

    private scheduleNextRareSpawn(): void {
        const minInterval = Math.max(6, this.rareSpawnIntervalMin);
        const maxInterval = Math.max(minInterval, this.rareSpawnIntervalMax);
        const interval = minInterval + Math.random() * (maxInterval - minInterval);
        this._nextRareSpawnTime = this._stageElapsedTime + interval;
    }

    private pickRareCollectionDefinition(): CollectionDefinition | null {
        const candidates = CollectionSystem.getPreferredRareDefinitions();
        if (candidates.length <= 0) {
            return null;
        }

        return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
    }

    private countAliveRareCollectionEnemies(): number {
        if (!this.objects) {
            return 0;
        }

        let count = 0;
        for (const child of this.objects.children) {
            const enemy = child.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isBoss) {
                continue;
            }

            if (enemy.isRareCollectionTarget) {
                count++;
            }
        }

        return count;
    }

    private trySpawnRareCollectionEnemy(): void {
        if (!this.rareSpawnEnabled || this._bossAlive || this._bossSpawnQueued || this._bossSpawned) {
            return;
        }

        if (!this.objects || this.objects.children.length >= this.getCurrentStageMaxEnemies()) {
            return;
        }

        if (this.countAliveRareCollectionEnemies() >= Math.max(1, this.rareMaxAlive)) {
            return;
        }

        const chance = Math.min(0.95, Math.max(0.05, this.rareSpawnChance + this._rareSpawnMissStreak * this.rareSpawnPityBonus));
        if (Math.random() > chance) {
            this._rareSpawnMissStreak += 1;
            return;
        }

        const definition = this.pickRareCollectionDefinition();
        if (!definition) {
            return;
        }

        const kind = definition.id === 'rare_can_mimic' ? EnemyKind.SnailTail : EnemyKind.Ghost;
        const prefab = kind === EnemyKind.SnailTail ? this.snailTail : this.ghost;
        const enemy = prefab ? this.getEnemyFromPrefab(kind, prefab) : null;
        if (!enemy) {
            return;
        }

        const pressure = this.getCurrentPressureSample();
        const rareSkillType = definition.id === 'rare_can_mimic' ? EliteSkillType.Explode : EliteSkillType.Ranged;

        enemy.setBossMode(false);
        enemy.setEliteMode(true, rareSkillType, 2.4, 110, 18);
        enemy.resetCollectionMetadata();
        enemy.setCollectionMetadata(definition.id, definition.name, true);
        enemy.setDifficultyScaling(pressure.normalHpMul * 2.1, pressure.normalSpeedMul * 1.15, 2.6, 3.2);
        enemy.insert(this.objects);

        const { minRadius, maxRadius } = this.getRegularSpawnRadiusRange();
        this.getSpawnPosition(tempPos, minRadius, maxRadius);
        enemy.setPosition(tempPos);
        enemy.init();

        this._rareSpawnMissStreak = 0;
        console.log(`[Collection] 稀有敌人出现：${definition.name}`);
    }

    createEnemy(x: number, y: number) {

        let enemy: Enemy = null;

        //随机产生两种
        if (Math.random() > 0.5)
            enemy = Ghost.get(this.ghost);
        else
            enemy = SnailTail.get(this.snailTail);

        if (!enemy) {
            return;
        }

        enemy.setBossMode(false);
        this.applyCollectionMetadataForRegularEnemy(enemy, enemy instanceof Ghost ? EnemyKind.Ghost : EnemyKind.SnailTail);

        enemy.insert(this.objects);

        tempPos.set(x,y,0);
        enemy.setPosition(tempPos);

        enemy.init(); //初始化
    }

    protected update(dt: number): void {
        if (this.isGameOverActive()) {
            return;
        }

        if (!this._isGameCleared && !this._bossFightActive) {
            this._stageElapsedTime += dt;
        }

        const table = this.getCurrentBalanceTable();
        const elite = table?.elite;
        if (elite && elite.enabled && this._stageElapsedTime >= this._nextEliteSpawnTime) {
            this.spawnEliteEnemy();
            this._nextEliteSpawnTime = this._stageElapsedTime + Math.max(1.5, elite.intervalSec * (0.85 + Math.random() * 0.3));
        }

        if (this.rareSpawnEnabled && !this._isGameCleared && !this._bossFightActive && this._stageElapsedTime >= this._nextRareSpawnTime) {
            this.trySpawnRareCollectionEnemy();
            this.scheduleNextRareSpawn();
        }

        const relief = table?.relief;
        if (relief && relief.enabled) {
            this._reliefCheckTimer += dt;
            if (this._reliefCheckTimer >= Math.max(0.5, relief.checkIntervalSec)) {
                this._reliefCheckTimer = 0;
                this.trySpawnReliefPickup();
            }
        }

        if (this._bossIntroAttackLockTime > 0) {
            this._bossIntroAttackLockTime = Math.max(0, this._bossIntroAttackLockTime - dt);
            if (this._bossIntroAttackLockTime <= 0 && this._bossIntroGunsLocked) {
                this.setPlayerWeaponsEnabled(true);
                this._bossIntroGunsLocked = false;
            }
        }

        //运行碰撞检测
        cCollider.inst.update(dt);
    }

    lateUpdate(dt: number): void {
        if (this.isGameOverActive()) {
            return;
        }

        //相机跟随：Boss 开场缓冲期间锁定在斗兽场中心，结束后恢复跟随玩家。
        const position = Player.inst.getPosition();
        let cameraTarget = position;
        if (this._bossIntroCameraLockTime > 0 && this._bossFightActive) {
            this._bossIntroCameraLockTime = Math.max(0, this._bossIntroCameraLockTime - dt);
            cameraTarget = this._bossArenaCenter;
        }

        this.updateBossArenaHint(dt);

        Vec3.lerp(tempPos, this.camera.position, cameraTarget, 0.25);

        if (this._cameraShakeTimer > 0) {
            this._cameraShakeTimer = Math.max(0, this._cameraShakeTimer - dt);
            const intensity = this._cameraShakeDuration > 0
                ? this._cameraShakeStrength * (this._cameraShakeTimer / this._cameraShakeDuration)
                : this._cameraShakeStrength;
            tempCameraShakeOffset.set(
                (Math.random() * 2 - 1) * intensity,
                (Math.random() * 2 - 1) * intensity,
                0,
            );
            tempPos.add(tempCameraShakeOffset);
        }

        this.camera.position = tempPos;

        //背景跟随
        let bg = this.node.getChildByName("bg");
        let sprite = bg.getComponent(Sprite);
        let material = sprite.getMaterial(0);
        let uvOffset = new Vec2(cameraTarget.x / 512.0, -cameraTarget.y / 512.0);
        material.setProperty("tilingOffset", uvOffset);
        bg.position = cameraTarget;

    }

    triggerCameraShake(strength: number = 12, duration: number = 0.14): void {
        this._cameraShakeStrength = Math.max(this._cameraShakeStrength, Math.max(0, strength));
        this._cameraShakeDuration = Math.max(this._cameraShakeDuration, Math.max(0.01, duration));
        this._cameraShakeTimer = Math.max(this._cameraShakeTimer, this._cameraShakeDuration);
    }

    public handlePlayerDefeat(attacker?: Node): void {
        if (this.isGameOverActive()) {
            return;
        }

        this._isPlayerDefeated = true;
        this.unscheduleAllCallbacks();
        this._bossSpawnQueued = false;
        this._bossAlive = false;
        this._bossSpawned = false;
        this._bossIntroAttackLockTime = 0;
        this._bossIntroCameraLockTime = 0;
        this._bossIntroGunsLocked = false;
        this._cameraShakeDuration = 0;
        this._cameraShakeStrength = 0;
        this._cameraShakeTimer = 0;
        this.deactivateBossArena();
        this.setPlayerWeaponsEnabled(false);
        this.clearGameplayNodes();

        const summary = this.buildGameOverSummary(attacker);
        GameStateManager.inst?.setState(GameState.GAME_OVER, summary);
        this.showGameOverSettlement(summary);
    }

    private isGameOverActive(): boolean {
        return !!GameStateManager.inst?.isGameOver || !!this._gameOverOverlay?.active;
    }

    private clearGameplayNodes(): void {
        if (this.objects) {
            for (const child of [...this.objects.children]) {
                child.destroy();
            }
        }

        if (this.bullets) {
            for (const child of [...this.bullets.children]) {
                child.destroy();
            }
        }
    }

    private buildGameOverSummary(attacker?: Node): { stageName: string; totalKills: number; totalScore: number; elapsedTime: number; level: number; attackerName: string } {
        return {
            stageName: this.getCurrentStageName(),
            totalKills: this._totalKills,
            totalScore: this._totalScore,
            elapsedTime: this._stageElapsedTime,
            level: ExperienceSystem.inst?.currentLevel ?? 1,
            attackerName: attacker?.name || '未知',
        };
    }

    private showGameOverSettlement(summary: { stageName: string; totalKills: number; totalScore: number; elapsedTime: number; level: number; attackerName: string }): void {
        const overlay = this.ensureGameOverOverlay();
        if (!overlay || !this._gameOverStatsLabel) {
            return;
        }

        const minutes = Math.floor(summary.elapsedTime / 60);
        const seconds = Math.floor(summary.elapsedTime % 60);
        const minuteText = minutes < 10 ? `0${minutes}` : `${minutes}`;
        const secondText = seconds < 10 ? `0${seconds}` : `${seconds}`;
        const timeText = `${minuteText}:${secondText}`;

        this._gameOverStatsLabel.string = [
            `关卡：${summary.stageName}`,
            `等级：${summary.level}`,
            `击杀：${summary.totalKills}`,
            `总分：${summary.totalScore}`,
            `时长：${timeText}`,
            `击杀者：${summary.attackerName}`,
            '',
            '点击“重新开始”进入下一局'
        ].join('\n');
        overlay.active = true;
    }

    private ensureGameOverOverlay(): Node | null {
        if (this._gameOverOverlay && this._gameOverStatsLabel) {
            return this._gameOverOverlay;
        }

        const parent = director.getScene()?.getChildByName('Canvas') ?? this.node;
        if (!parent) {
            return null;
        }

        const visibleSize = view.getVisibleSize();
        const overlay = new Node('GameOverSettlementOverlay');
        overlay.layer = parent.layer;
        const overlayTransform = overlay.addComponent(UITransform);
        overlayTransform.setContentSize(visibleSize.width, visibleSize.height);
        overlay.addComponent(BlockInputEvents);
        parent.addChild(overlay);
        overlay.setSiblingIndex(parent.children.length - 1);
        overlay.setPosition(0, 0, 0);
        this.bindOverlayInputBlockers(overlay);

        const backdrop = new Node('Backdrop');
        backdrop.layer = parent.layer;
        const backdropTransform = backdrop.addComponent(UITransform);
        backdropTransform.setContentSize(visibleSize.width, visibleSize.height);
        const backdropGraphics = backdrop.addComponent(Graphics);
        backdropGraphics.fillColor = new Color(8, 10, 18, 210);
        backdropGraphics.rect(-visibleSize.width * 0.5, -visibleSize.height * 0.5, visibleSize.width, visibleSize.height);
        backdropGraphics.fill();
        overlay.addChild(backdrop);
        this.bindOverlayInputBlockers(backdrop);

        const panelWidth = Math.min(visibleSize.width - 120, 520);
        const panelHeight = Math.min(visibleSize.height - 140, 420);
        const panel = new Node('Panel');
        panel.layer = parent.layer;
        const panelTransform = panel.addComponent(UITransform);
        panelTransform.setContentSize(panelWidth, panelHeight);
        const panelGraphics = panel.addComponent(Graphics);
        panelGraphics.fillColor = new Color(24, 28, 40, 242);
        panelGraphics.roundRect(-panelWidth * 0.5, -panelHeight * 0.5, panelWidth, panelHeight, 18);
        panelGraphics.fill();
        panelGraphics.lineWidth = 3;
        panelGraphics.strokeColor = new Color(255, 214, 140, 180);
        panelGraphics.roundRect(-panelWidth * 0.5, -panelHeight * 0.5, panelWidth, panelHeight, 18);
        panelGraphics.stroke();
        overlay.addChild(panel);
        this.bindOverlayInputBlockers(panel);

        const titleNode = new Node('Title');
        titleNode.layer = parent.layer;
        const titleTransform = titleNode.addComponent(UITransform);
        titleTransform.setContentSize(panelWidth - 80, 48);
        const titleLabel = titleNode.addComponent(Label);
        titleLabel.string = '本局结算';
        titleLabel.fontSize = 30;
        titleLabel.lineHeight = 36;
        titleLabel.color = new Color(255, 240, 210, 255);
        titleNode.setPosition(0, panelHeight * 0.5 - 54, 0);
        panel.addChild(titleNode);

        const statsNode = new Node('Stats');
        statsNode.layer = parent.layer;
        const statsTransform = statsNode.addComponent(UITransform);
        statsTransform.setContentSize(panelWidth - 96, 220);
        const statsLabel = statsNode.addComponent(Label);
        statsLabel.fontSize = 22;
        statsLabel.lineHeight = 32;
        statsLabel.color = new Color(224, 228, 240, 255);
        statsNode.setPosition(0, 24, 0);
        panel.addChild(statsNode);

        const restartButton = new Node('RestartButton');
        restartButton.layer = parent.layer;
        const restartTransform = restartButton.addComponent(UITransform);
        restartTransform.setContentSize(180, 60);
        const restartGraphics = restartButton.addComponent(Graphics);
        restartGraphics.fillColor = new Color(214, 96, 58, 255);
        restartGraphics.roundRect(-90, -30, 180, 60, 14);
        restartGraphics.fill();
        restartButton.addComponent(UIOpacity).opacity = 255;
        restartButton.setPosition(-104, -panelHeight * 0.5 + 62, 0);
        restartButton.on(Node.EventType.TOUCH_END, this.restartCurrentScene, this);
        panel.addChild(restartButton);
        this.bindOverlayInputBlockers(restartButton);

        const restartLabelNode = new Node('RestartLabel');
        restartLabelNode.layer = parent.layer;
        const restartLabelTransform = restartLabelNode.addComponent(UITransform);
        restartLabelTransform.setContentSize(180, 40);
        const restartLabel = restartLabelNode.addComponent(Label);
        restartLabel.string = '重新开始';
        restartLabel.fontSize = 24;
        restartLabel.lineHeight = 30;
        restartLabel.color = new Color(255, 248, 240, 255);
        restartButton.addChild(restartLabelNode);

        const homeButton = new Node('HomeButton');
        homeButton.layer = parent.layer;
        const homeTransform = homeButton.addComponent(UITransform);
        homeTransform.setContentSize(180, 60);
        const homeGraphics = homeButton.addComponent(Graphics);
        homeGraphics.fillColor = new Color(62, 96, 140, 255);
        homeGraphics.roundRect(-90, -30, 180, 60, 14);
        homeGraphics.fill();
        homeButton.addComponent(UIOpacity).opacity = 255;
        homeButton.setPosition(104, -panelHeight * 0.5 + 62, 0);
        homeButton.on(Node.EventType.TOUCH_END, this.returnToHomeScene, this);
        panel.addChild(homeButton);
        this.bindOverlayInputBlockers(homeButton);

        const homeLabelNode = new Node('HomeLabel');
        homeLabelNode.layer = parent.layer;
        const homeLabelTransform = homeLabelNode.addComponent(UITransform);
        homeLabelTransform.setContentSize(180, 40);
        const homeLabel = homeLabelNode.addComponent(Label);
        homeLabel.string = '返回';
        homeLabel.fontSize = 24;
        homeLabel.lineHeight = 30;
        homeLabel.color = new Color(240, 246, 255, 255);
        homeButton.addChild(homeLabelNode);

        this._gameOverOverlay = overlay;
        this._gameOverStatsLabel = statsLabel;
        this._gameOverOverlay.active = false;
        return this._gameOverOverlay;
    }

    private bindOverlayInputBlockers(node: Node): void {
        const stop = (event: any) => {
            if (typeof event?.propagationStopped !== 'undefined') {
                event.propagationStopped = true;
            }
            if (typeof event?.stopPropagation === 'function') {
                event.stopPropagation();
            }
        };

        node.on(Node.EventType.TOUCH_START, stop, this);
        node.on(Node.EventType.TOUCH_MOVE, stop, this);
        node.on(Node.EventType.TOUCH_END, stop, this);
        node.on(Node.EventType.TOUCH_CANCEL, stop, this);
    }

    private detachPlayerDeathListener(): void {
        const player = this._playerInstance;
        this._playerInstance = null;

        if (!player || !player.node || !player.node.isValid) {
            return;
        }

        player.off(PlayerHealthEvents.ON_DEATH, this.onPlayerDeath, this);
    }

    private restartCurrentScene(): void {
        const sceneName = director.getScene()?.name;
        if (!sceneName) {
            return;
        }

        this.detachPlayerDeathListener();
        SceneTransition.loadScene(sceneName, '重新开始中...');
    }

    private returnToHomeScene(): void {
        this.detachPlayerDeathListener();
        SceneTransition.loadScene('home', '返回首页...');
    }

}

