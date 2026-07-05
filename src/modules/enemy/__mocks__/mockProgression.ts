/**
 * `createMockProgression` — Progression 模块的 Mock 工厂。
 *
 * 按 plan/modular-roadmap.md §0.3 / §5.1,Progression 是逻辑型模块;Mock 形态
 * = 一个 `ProgressionPort`,让 Enemy / Combat / Camera 等模块的单测能 stub
 * 关卡配置 / 场景状态。
 *
 * 关键不变量:
 *  - **不**持 Excalibur `Scene` / 引擎时钟(纯 TS)。
 *  - 默认 `level=1` / `xp=0` / `xpToNext=10` / `scene="running"` /
 *    `timer=60` / `currentLevelConfig.allowedKinds=["chaser"]` /
 *    `currentLevelConfig.enemyDensity=10`。
 *  - 测试可通过 `setLevelConfig` / `setScene` / `setTimer` 注入"关卡切换"语义。
 *  - 写方法(`pauseToggle` / `endRun` / `advance` / `pickCharacter`)全是 spy —
 *    仅累加调用次数,不实际改内部状态(测试不依赖副作用,只断言"被调过几次")。
 */
import type { CharacterId, GameScene, LevelConfig } from "../../../runtime/types";
import type { ProgressionPort } from "../../../runtime/ports/ProgressionPort";

/** Mock 工厂的可调参数。 */
export interface MockProgressionOptions {
  /** 初始关卡(1-based);默认 1。 */
  initialLevel?: number;
  /** 初始 `currentLevelConfig`;不传走默认 1 关(密度 10 / allowedKinds=["chaser"])。 */
  initialLevelConfig?: LevelConfig;
  /** 初始 scene;默认 `"running"`。 */
  initialScene?: GameScene;
  /** 初始 `timer`(秒);默认 60。 */
  initialTimer?: number;
}

/** `createMockProgression` 返回的扩展 Port,带 spy / 驱动函数。 */
export interface MockProgressionHandle extends ProgressionPort {
  /** spy:被调过的 `pauseToggle` 次数。 */
  readonly pauseToggleCount: number;
  /** spy:被调过的 `endRun` 次数。 */
  readonly endRunCount: number;
  /** spy:被调过的 `advance` 次数。 */
  readonly advanceCount: number;
  /** spy:被调过的 `startRun` 次数。 */
  readonly startRunCount: number;
  /** spy:`pickCharacter` 被调用的入参列表(测试断言"传了哪个 id")。 */
  readonly pickedCharacters: ReadonlyArray<CharacterId>;

  /** 测试驱动:直接覆盖 `level()` 返回值。 */
  setLevel(n: number): void;
  /** 测试驱动:直接覆盖 `scene()` 返回值。 */
  setScene(s: GameScene): void;
  /** 测试驱动:直接覆盖 `timer()` 返回值。 */
  setTimer(sec: number): void;
  /** 测试驱动:直接覆盖 `xp()` / `xpToNext()` 返回值。 */
  setXp(xp: number, toNext?: number): void;
  /** 测试驱动:直接覆盖 `currentLevelConfig()` 返回值。 */
  setLevelConfig(cfg: LevelConfig): void;
  /** 清空所有 spy 计数器(测试间隔离)。 */
  resetSpies(): void;
}

function makeDefaultConfig(density = 10): LevelConfig {
  return {
    duration: 60,
    enemyDensity: density,
    isFinal: false,
    allowedKinds: ["chaser"],
  };
}

/**
 * 创建一个 Mock Progression Port。
 */
export function createMockProgression(opts: MockProgressionOptions = {}): MockProgressionHandle {
  let level = opts.initialLevel ?? 1;
  let scene: GameScene = opts.initialScene ?? "running";
  let timer = opts.initialTimer ?? 60;
  let xp = 0;
  let xpToNext = 10;
  let levelConfig: LevelConfig = opts.initialLevelConfig ?? makeDefaultConfig();
  let pauseToggleCount = 0;
  let endRunCount = 0;
  let advanceCount = 0;
  let startRunCount = 0;
  let stageVal = 1;
  const pickedCharacters: CharacterId[] = [];
  const port: MockProgressionHandle = {
    level() {
      return level;
    },
    xp() {
      return xp;
    },
    xpToNext() {
      return xpToNext;
    },
    scene() {
      return scene;
    },
    currentLevelConfig() {
      return levelConfig;
    },
    timer() {
      return timer;
    },
    pauseToggle() {
      pauseToggleCount += 1;
    },
    endRun() {
      endRunCount += 1;
    },
    advance() {
      advanceCount += 1;
    },
    startRun() {
      startRunCount += 1;
    },
    stage() {
      return stageVal;
    },
    pickCharacter(id) {
      pickedCharacters.push(id);
    },
    // ---- spy 视图 ----
    get pauseToggleCount() {
      return pauseToggleCount;
    },
    get endRunCount() {
      return endRunCount;
    },
    get advanceCount() {
      return advanceCount;
    },
    get startRunCount() {
      return startRunCount;
    },
    get pickedCharacters() {
      return pickedCharacters.slice();
    },

    // ---- 驱动方法 ----
    setLevel(n) {
      level = n;
    },
    setScene(s) {
      scene = s;
    },
    setTimer(sec) {
      timer = sec;
    },
    setXp(v, toNext) {
      xp = v;
      if (toNext !== undefined) xpToNext = toNext;
    },
    setLevelConfig(cfg) {
      levelConfig = cfg;
    },
    resetSpies() {
      pauseToggleCount = 0;
      endRunCount = 0;
      advanceCount = 0;
      startRunCount = 0;
      pickedCharacters.length = 0;
    },
  };

  return port;
}
