/**
 * Excalibur 引擎的生命周期与世界/敌人/相机逻辑。
 *
 * 此模块与 React / DOM 仅通过调用方传入的 `<canvas>` 引用接触,
 * 方便在没有 DOM 的环境下进行单测,并保证引擎随路由卸载。
 *
 * 世界坐标:
 *   - 世界是一个固定尺寸的方形 (`WORLD_SIZE x WORLD_SIZE`),整个世界在常见视口内可见。
 *   - 主角始终被绘制在屏幕中央(相机锁定),所以主角在屏幕坐标系不动,
 *     在世界坐标里可以走到 `WORLD_SIZE` 内的任意位置。
 *   - 敌人从世界内随机位置生成,沿世界坐标方向朝主角匀速移动。
 *   - 地图边界由四个 Fixed 类型的 EdgeCollider 充当墙,阻挡玩家与敌人。
 */
import {
  Actor,
  BoundingBox,
  CollisionType,
  Color,
  DisplayMode,
  Engine,
  ImageSource,
  Keys,
  LimitCameraBoundsStrategy,
  LockCameraToActorStrategy,
  Scene,
  Timer,
  Vector,
  type ActorArgs,
  type ExcaliburGraphicsContext,
} from "excalibur";
import playerImg from "../assets/player.jpg";
import enemyImg from "../assets/enemy.jpg";

import { Health } from "./components/Health";
import {
  ENEMY_CONTACT_DAMAGE,
  ENEMY_MAX_HP,
  ENEMY_TAG,
  HEALTH_BAR_BG_COLOR,
  HEALTH_BAR_BORDER_COLOR,
  HEALTH_BAR_BORDER_THICKNESS,
  HEALTH_BAR_FG_COLOR,
  HEALTH_BAR_HEIGHT,
  HEALTH_BAR_OFFSET_Y,
  HEALTH_BAR_WIDTH,
  PLAYER_FLASH_INTERVAL_S,
  PLAYER_FLASH_OPACITY_OFF,
  PLAYER_FLASH_OPACITY_ON,
  WALL_TAG,
} from "./balance";
import { Pistol } from "./weapons/Pistol";

/** 玩家初始 / 上限 HP(M0.1 与 M0.2 共用,后续若调阈值改这里即可)。 */
const PLAYER_MAX_HP = 100;
/** 世界地图边长(像素),明显大于玩家/敌人且能装进常见视口的正方形。 */
export const WORLD_SIZE = 800;
/** 玩家贴图绘制尺寸(像素)。 */
const PLAYER_SIZE = 48;
/** 玩家移动速度(像素/秒,世界坐标)。 */
const PLAYER_SPEED = 240;
/** 敌人贴图绘制尺寸(像素)。 */
const ENEMY_SIZE = 48;
/** 敌人速度(像素/秒,世界坐标)。比玩家稍慢,保持可玩。 */
const ENEMY_SPEED = 130;
/**
 * 敌人生成间隔(毫秒)。
 * M0.3 临时拉到 100ms 加速刷怪验证节奏,验完已还原。
 */
const ENEMY_SPAWN_INTERVAL_MS = 900;
/** 同一时刻场内敌人数量上限,避免密度失控。 */
const ENEMY_MAX_COUNT = 60;
/** 出生安全半径:敌人不会在玩家身边过近处生成。 */
const ENEMY_SAFE_RADIUS = 180;
/** 地图边界描边粗细(像素)。 */
const BORDER_THICKNESS = 6;

/** 玩家图片资源。`ImageSource.load()` 在启动引擎前异步加载。 */
const playerSprite = new ImageSource(playerImg);
/** 敌人图片资源。 */
const enemySprite = new ImageSource(enemyImg);

/**
 * 玩家 Actor。世界坐标定位,WASD/方向键在 `preupdate` 中修改世界速度。
 */
class Player extends Actor {}

/**
 * 玩家头顶的血条 Actor (M0.2)。
 *
 * - 不参与物理碰撞 (`CollisionType.PreventCollision`),只跟随玩家位置并绘制。
 * - 每帧在 `onPreUpdate` 中把自身 `pos` 与玩家同步,纵向偏移走 `HEALTH_BAR_OFFSET_Y`。
 * - 绘制顺序:血条 `z = 11` 在玩家之上(`z = 10`),避免被敌人/墙遮挡。
 * - 死亡时 (`Health.isDead`) 整条 bar 隐藏,M0.5 会接上 Game Over 面板。
 */
class HealthBar extends Actor {
  /** 玩家位置惰性读取器,避免缓存到过期 vector。 */
  private readonly getOwnerPos: () => Vector;
  /** 血量源,用来读 `hp / maxHp / isDead`。 */
  private readonly ownerHealth: Health;
  /** 上次可见性状态,用于死亡/复活切换时只重设一次 `isVisible`。 */
  private hidden: boolean = false;

  constructor(ownerHealth: Health, getOwnerPos: () => Vector) {
    super({
      x: 0,
      y: 0,
      width: HEALTH_BAR_WIDTH,
      height: HEALTH_BAR_HEIGHT,
      collisionType: CollisionType.PreventCollision,
    });
    this.ownerHealth = ownerHealth;
    this.getOwnerPos = getOwnerPos;
    this.z = 11;
  }

  override onPreUpdate(_engine: Engine, _elapsed: number): void {
    const owner = this.getOwnerPos();
    this.pos.setTo(owner.x, owner.y);
    const shouldShow = !this.ownerHealth.isDead;
    if (shouldShow === this.hidden) {
      this.graphics.isVisible = shouldShow;
      this.hidden = !shouldShow;
    }
  }

  /**
   * 血条绘制:外框 + 当前 HP 比例的红色前景条。
   *
   * 通过 `graphics.onPostDraw` 接入,绘制时已应用 actor transform,
   * 原点 `(0, 0)` 即 actor 中心(=玩家中心),所以血条直接用本地坐标偏移即可。
   */
  public installDraw(): void {
    this.graphics.onPostDraw = (ctx: ExcaliburGraphicsContext) => {
      const ratio = Math.max(0, this.ownerHealth.hp / this.ownerHealth.maxHp);
      const drawX = -HEALTH_BAR_WIDTH / 2;
      const drawY = -HEALTH_BAR_OFFSET_Y - HEALTH_BAR_HEIGHT / 2;
      const bg = Color.fromHex(HEALTH_BAR_BG_COLOR);
      const fg = Color.fromHex(HEALTH_BAR_FG_COLOR);
      const border = Color.fromHex(HEALTH_BAR_BORDER_COLOR);
      // 描边外框(底色用 BG 填充,描边用 BORDER)。
      ctx.drawRectangle(
        new Vector(drawX, drawY),
        HEALTH_BAR_WIDTH,
        HEALTH_BAR_HEIGHT,
        bg,
        border,
        HEALTH_BAR_BORDER_THICKNESS,
      );
      // 前景条按 `ratio` 占比,内缩描边宽度以免覆盖外框。
      const innerPad = HEALTH_BAR_BORDER_THICKNESS;
      const innerW = HEALTH_BAR_WIDTH - innerPad * 2;
      const innerH = HEALTH_BAR_HEIGHT - innerPad * 2;
      const fgW = innerW * ratio;
      if (fgW > 0) {
        ctx.drawRectangle(new Vector(drawX + innerPad, drawY + innerPad), fgW, innerH, fg);
      }
    };
  }
}

/**
 * 敌人 Actor,`preupdate` 内重新指向玩家方向做匀速追踪。
 * `getTarget` 是惰性取玩家位置的闭包,每帧调用以拿到最新的 `player.pos`。
 */
class Enemy extends Actor {
  /** 玩家位置的惰性读取器,避免缓存到固定向量。 */
  private readonly getTarget: () => Vector;
  /**
   * 接触伤害 (M0.3) —— 与玩家发生 `collisionstart` 时造成此数值伤害。
   * 默认走 `balance.ts` 的 `ENEMY_CONTACT_DAMAGE`,构造时可被覆写,
   * 留给 M3 敌人种类化做不同分支。
   */
  public readonly contactDamage: number;

  constructor(
    config: ActorArgs,
    getTarget: () => Vector,
    contactDamage: number = ENEMY_CONTACT_DAMAGE,
  ) {
    super(config);
    this.getTarget = getTarget;
    this.contactDamage = contactDamage;
    // M0.4:挂血量 + 敌人 tag。
    // 血量组件默认 30 点 (Pistol 三发必杀);tag 让 `Pistol.findNearestEnemy` / `Projectile.handleCollision`
    // 用 O(1) 命中分支识别敌人。后续 M0.6 在 `Health` 归零时 `kill()` 敌人。
    this.addComponent(new Health({ maxHp: ENEMY_MAX_HP }));
    this.addTag(ENEMY_TAG);
  }

  override onPreUpdate(_engine: Engine, _elapsed: number): void {
    const goal = this.getTarget();
    const dx = goal.x - this.pos.x;
    const dy = goal.y - this.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      this.vel.setTo((dx / dist) * ENEMY_SPEED, (dy / dist) * ENEMY_SPEED);
    } else {
      this.vel.setTo(0, 0);
    }
  }
}

/**
 * 四个不可见 Wall Actor,每个仅持有一条 EdgeCollider 用作碰撞墙。
 * EdgeCollider 是单段线碰撞,把它放到 actor 中心(0,0)即可表示世界本地坐标的边。
 */
function buildWalls(): Actor[] {
  const half = WORLD_SIZE / 2;
  const make = (begin: Vector, end: Vector): Actor => {
    const wall = new Actor({
      x: 0,
      y: 0,
      // 占个非零尺寸以兼容 Excalibur 对 actor 的边界计算。
      width: WORLD_SIZE,
      height: WORLD_SIZE,
      collisionType: CollisionType.Fixed,
    });
    // 新 API:通过 collider 组件安装单段线碰撞器。
    wall.collider.useEdgeCollider(begin, end);
    // M0.4:给墙打 tag,投射物靠 `hasTag('wall')` 判定撞墙自毁。
    wall.addTag(WALL_TAG);
    return wall;
  };
  // 顺时针四条边;EdgeCollider 不参与绘制,只挡碰撞。
  return [
    make(new Vector(-half, -half), new Vector(half, -half)), // 上
    make(new Vector(half, -half), new Vector(half, half)), // 右
    make(new Vector(half, half), new Vector(-half, half)), // 下
    make(new Vector(-half, half), new Vector(-half, -half)), // 左
  ];
}

/**
 * 在世界内、与玩家距离超过 `ENEMY_SAFE_RADIUS` 的随机位置生成一个敌人。
 * 凑不够条件时重试最多 8 次,然后放弃这一轮的生成。
 */
function spawnEnemy(scene: Scene, getPlayerPos: () => Vector): void {
  for (let attempt = 0; attempt < 8; attempt++) {
    const half = WORLD_SIZE / 2 - ENEMY_SIZE / 2 - BORDER_THICKNESS;
    const x = (Math.random() * 2 - 1) * half;
    const y = (Math.random() * 2 - 1) * half;
    const player = getPlayerPos();
    if (Math.hypot(x - player.x, y - player.y) < ENEMY_SAFE_RADIUS) continue;

    const enemy = new Enemy(
      {
        x,
        y,
        width: ENEMY_SIZE,
        height: ENEMY_SIZE,
        collisionType: CollisionType.Active,
      },
      () => getPlayerPos(),
    );
    // 贴图;加载未完成时 Excalibur 会回退占位方块。
    enemy.graphics.use(
      enemySprite.toSprite({ destSize: { width: ENEMY_SIZE, height: ENEMY_SIZE } }),
    );
    scene.add(enemy);
    return;
  }
}

/**
 * 创建并启动 Excalibur 引擎,把世界场景挂到传入的 `<canvas>` 上。
 *
 * 调用方负责:
 *   1. 在 React `useEffect` 中调用,并把返回值交给清理函数;
 *   2. 卸载时调用 `disposeGame(engine)` 释放 RAF / 音频上下文。
 */
export function createGame(canvas: HTMLCanvasElement): Promise<Engine> {
  const engine = new Engine({
    canvasElement: canvas,
    // 充满 canvas 所在的 DOM 容器,与路由全屏布局配合。
    displayMode: DisplayMode.FillContainer,
    backgroundColor: Color.fromHex("#1b1d22"),
    // 像素风格关闭抗锯齿,贴图/方块边缘更锐利。
    antialiasing: false,
  });

  // 后台异步加载两张图片;不阻塞引擎启动,失败时 Excalibur 也会给出占位。
  void Promise.all([playerSprite.load(), enemySprite.load()]);

  const scene = new Scene();

  const player = new Player({
    x: 0,
    y: 0,
    width: PLAYER_SIZE,
    height: PLAYER_SIZE,
    color: Color.fromHex("#4cc9f0"),
  });
  // 把玩家钉在最高绘制层,被敌人追上时仍能看清本体。
  player.z = 10;
  player.graphics.use(
    playerSprite.toSprite({ destSize: { width: PLAYER_SIZE, height: PLAYER_SIZE } }),
  );
  scene.add(player);

  // M0.1:在玩家身上挂 `Health`,后续 M0.2 复用同一组件做血条 / 闪白。
  // 此处用 `addComponent` 而非构造期注入,是因为 `Player` 类本身不持有任何业务字段。
  const playerHealth = new Health({ maxHp: PLAYER_MAX_HP });
  player.addComponent(playerHealth);

  const playerHealthBar = new HealthBar(playerHealth, () => player.pos);
  playerHealthBar.installDraw();
  scene.add(playerHealthBar);

  for (const wall of buildWalls()) scene.add(wall);

  // 相机锁主角 + 限制不超过地图。
  const camera = scene.camera;
  camera.addStrategy(new LockCameraToActorStrategy(player));
  camera.addStrategy(
    new LimitCameraBoundsStrategy(
      new BoundingBox(-WORLD_SIZE / 2, -WORLD_SIZE / 2, WORLD_SIZE / 2, WORLD_SIZE / 2),
    ),
  );
  camera.zoom = 1;

  // 玩家输入 → 世界速度。捕获 player 闭包,避免对 evt.target 的版本依赖。
  player.on("preupdate", ({ engine: eng, elapsed }) => {
    let dx = 0;
    let dy = 0;
    if (eng.input.keyboard.isHeld(Keys.Left) || eng.input.keyboard.isHeld(Keys.A)) dx -= 1;
    if (eng.input.keyboard.isHeld(Keys.Right) || eng.input.keyboard.isHeld(Keys.D)) dx += 1;
    if (eng.input.keyboard.isHeld(Keys.Up) || eng.input.keyboard.isHeld(Keys.W)) dy -= 1;
    if (eng.input.keyboard.isHeld(Keys.Down) || eng.input.keyboard.isHeld(Keys.S)) dy += 1;

    // 对角线归一化:同时按两个方向时不让速度变大。
    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.sqrt(2);
      dx *= inv;
      dy *= inv;
    }

    // 边界裁剪:本帧预估位移不能让玩家跑出方框;墙也会兜底。
    const dt = elapsed / 1000;
    const half = WORLD_SIZE / 2 - PLAYER_SIZE / 2;
    const nextX = player.pos.x + dx * PLAYER_SPEED * dt;
    const nextY = player.pos.y + dy * PLAYER_SPEED * dt;
    const clampedDx = nextX < -half || nextX > half ? 0 : dx;
    const clampedDy = nextY < -half || nextY > half ? 0 : dy;

    player.vel.setTo(clampedDx * PLAYER_SPEED, clampedDy * PLAYER_SPEED);
  });

  // M0.4:玩家按攻击键(空格)→ 调 `Pistol.tryFire`。
  // - `wasPressed` 是 Excalibur 的"按下当帧触发一次"事件,避免按住空格时每帧都发弹。
  // - `tryFire` 内部已做好节流(只在成功开火后才推进),所以这里反复按都没事。
  // - TODO:接鼠标左键(M0.4 文档要求"留 TODO:接鼠标左键")。
  const pistol = new Pistol();
  player.on("preupdate", (evt) => {
    if (!evt.engine.input.keyboard.wasPressed(Keys.Space)) return;
    pistol.tryFire({
      now: evt.engine.clock.now(),
      owner: player,
      ownerPos: player.pos,
      scene,
    });
  });

  // M0.3 接触伤害:
  // - 玩家与 `Enemy` 发生 `collisionstart` 时,Enemy 对玩家造成 `enemy.contactDamage` 伤害。
  // - 用 `inContactEnemies` 集合 + `collisionend` 标志位,
  //   防止同一 enemy 在重叠期间每帧重复扣血;实际节流仍由 `Health` 的无敌帧把关。
  // - M0.6 接入敌人 `Health` 后,在 `kill()` 之前通过 `isKilled()` 短路掉扣血,
  //   此处提前预留该判断,避免后续再改接触逻辑。
  // 设计选择说明:用 Set + collisionend 标志,而不是 excalibur 的 `pair` API,
  //   是为了把状态完全收敛在玩家侧,enemy 端零侵入。
  const inContactEnemies = new Set<Enemy>();
  player.on("collisionstart", (evt) => {
    const other = evt.other.owner;
    if (!(other instanceof Enemy)) return;
    if (other.isKilled()) return;
    inContactEnemies.add(other);
    playerHealth.takeDamage(other.contactDamage, { source: other });
  });
  player.on("collisionend", (evt) => {
    const other = evt.other.owner;
    if (!(other instanceof Enemy)) return;
    inContactEnemies.delete(other);
  });

  // M0.2:玩家受伤后的 alpha 闪白。
  // 仅在 `Health.invulnerableTimer > 0` 期间以 `FLASH_INTERVAL_S` 为周期切换 ON/OFF 透明度;
  // 无敌帧耗尽时立即把 alpha 复位成 `ON`,确保玩家从闪烁状态"干净"地切回正常显示。
  let flashAccumS = 0;
  let flashOn = true;
  player.on("preupdate", ({ elapsed }) => {
    if (!playerHealth.isInvulnerable()) {
      if (!flashOn) {
        flashOn = true;
        player.graphics.opacity = PLAYER_FLASH_OPACITY_ON;
      }
      flashAccumS = 0;
      return;
    }
    flashAccumS += elapsed / 1000;
    if (flashAccumS >= PLAYER_FLASH_INTERVAL_S) {
      flashAccumS = 0;
      flashOn = !flashOn;
      player.graphics.opacity = flashOn ? PLAYER_FLASH_OPACITY_ON : PLAYER_FLASH_OPACITY_OFF;
    }
  });

  // 地图边界可视化:用一个不可见 actor 当锚点,onPostDraw 画描边矩形。
  const mapOverlay = new Actor({ x: 0, y: 0, width: 1, height: 1 });
  mapOverlay.graphics.onPostDraw = (ctx) => {
    const half = WORLD_SIZE / 2;
    ctx.save();
    // drawRectangle(pos, width, height, color, stroke?, strokeThickness?)
    ctx.drawRectangle(
      new Vector(-half, -half),
      WORLD_SIZE,
      WORLD_SIZE,
      Color.Transparent,
      Color.fromHex("#3a4150"),
      BORDER_THICKNESS,
    );
    ctx.restore();
  };
  scene.add(mapOverlay);

  // 敌人脱离世界视作已离开生存区:删除以释放内存。
  // 同时把崩溃的、无意义的越界敌人清理掉。
  scene.on("postupdate", () => {
    const half = WORLD_SIZE / 2;
    for (const actor of scene.actors) {
      if (!(actor instanceof Enemy)) continue;
      if (actor.pos.x < -half || actor.pos.x > half || actor.pos.y < -half || actor.pos.y > half) {
        actor.kill();
      }
    }
  });

  // 持续生成敌人。
  const spawnTimer = new Timer({
    interval: ENEMY_SPAWN_INTERVAL_MS,
    repeats: true,
    action: () => {
      const enemies = scene.actors.filter((a): a is Enemy => a instanceof Enemy);
      if (enemies.length >= ENEMY_MAX_COUNT) return;
      spawnEnemy(scene, () => player.pos);
    },
  });
  scene.add(spawnTimer);
  spawnTimer.start();

  engine.add("world", scene);
  // 显式切到 world:Excalibur 引擎默认激活的是空的 root 场景。
  return engine
    .start()
    .then(() => engine.goToScene("world"))
    .then(() => engine);
}

/**
 * 释放 Excalibur 引擎。`dispose()` 自身幂等,所以重复调用安全。
 */
export function disposeGame(engine: Engine): void {
  if (!engine.isDisposed()) engine.dispose();
}
