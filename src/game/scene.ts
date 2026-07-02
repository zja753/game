/**
 * Excalibur 引擎的生命周期与最小演示场景。
 *
 * 此模块与 React / DOM 仅通过调用方传入的 `<canvas>` 引用接触,
 * 方便在没有 DOM 的环境下进行单测,并保证引擎随路由卸载。
 */
import { Actor, Color, DisplayMode, Engine, Keys, Scene, type ActorArgs } from "excalibur";

/** 玩家方块大小(像素)。 */
const PLAYER_SIZE = 48;
/** 玩家移动速度(像素 / 秒)。 */
const PLAYER_SPEED = 240;

type PlayerConfig = Pick<ActorArgs, "x" | "y" | "width" | "height" | "color">;

class Player extends Actor {
  constructor(config: PlayerConfig) {
    super(config);
  }
}

/**
 * 创建并启动 Excalibur 引擎,把演示场景挂到传入的 `<canvas>` 上。
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
    // 像素风格关闭抗锯齿,演示方块边缘更锐利。
    antialiasing: false,
  });

  const scene = new Scene();
  const player = new Player({
    x: engine.drawWidth / 2,
    y: engine.drawHeight / 2,
    width: PLAYER_SIZE,
    height: PLAYER_SIZE,
    color: Color.fromHex("#4cc9f0"),
  });
  scene.add(player);

  // 通过闭包捕获 `player`,避免依赖 `evt.target` 在不同 Excalibur 版本上的类型差异。
  player.on("preupdate", ({ engine: eng, elapsed }) => {
    let dx = 0;
    let dy = 0;
    if (eng.input.keyboard.isHeld(Keys.Left) || eng.input.keyboard.isHeld(Keys.A)) {
      dx -= 1;
    }
    if (eng.input.keyboard.isHeld(Keys.Right) || eng.input.keyboard.isHeld(Keys.D)) {
      dx += 1;
    }
    if (eng.input.keyboard.isHeld(Keys.Up) || eng.input.keyboard.isHeld(Keys.W)) {
      dy -= 1;
    }
    if (eng.input.keyboard.isHeld(Keys.Down) || eng.input.keyboard.isHeld(Keys.S)) {
      dy += 1;
    }

    // 对角线归一化:同时按两个方向时不让速度变大。
    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.sqrt(2);
      dx *= inv;
      dy *= inv;
    }

    const vx = dx * PLAYER_SPEED;
    const vy = dy * PLAYER_SPEED;

    // 用本帧预估位移做边界裁剪,避免方块跑出可视区。
    // Excalibur 中 `vel` 的单位是像素 / 秒。
    const dt = elapsed / 1000;
    const half = PLAYER_SIZE / 2;
    const nextX = player.pos.x + vx * dt;
    const nextY = player.pos.y + vy * dt;
    const clampedVx = nextX < half || nextX > eng.drawWidth - half ? 0 : vx;
    const clampedVy = nextY < half || nextY > eng.drawHeight - half ? 0 : vy;

    player.vel.setTo(clampedVx, clampedVy);
  });

  engine.add("demo", scene);
  return engine.start().then(() => engine);
}

/**
 * 释放 Excalibur 引擎。`dispose()` 自身幂等,所以重复调用安全。
 */
export function disposeGame(engine: Engine): void {
  if (!engine.isDisposed()) engine.dispose();
}
