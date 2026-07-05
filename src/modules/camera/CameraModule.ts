/**
 * `CameraModule` — Camera 模块对外的"装配层"(plan/modules/camera.md §2-§7)。
 *
 * 把两个内部子模块(`CameraController` / `CameraFollower`)组合起来,
 * 实现 `CameraPort` 接口的全部方法,然后把这个 Port 实例暴露给根容器 /
 * 其他模块使用。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 这个文件**只**能被根容器 `import`。
 *  - 其他模块**不能** import 它,只能 import 根容器传给它们的 `CameraPort`。
 *  - 本模块消费 `RuntimePort` / `MapObstaclePort` / `PlayerPort`(camera.md §6),
 *    **不持有** Combat / Enemy / Progression 等业务模块的 Port 引用。
 *
 * 权威字段(camera.md §4):
 *  - `camera.pos`(Excalibur `Scene.camera.pos`)—— 由 `CameraFollower` 写入,
 *    通过 `CameraPort.pos()` 读。
 *  - `camera.viewportSize` —— 派生自 `RuntimePort.viewportSize()`(不独立缓存)。
 *  - 当前 `clampRange` —— 派生自 `MapObstaclePort.bounds() + viewportSize`,
 *    **不**独立存储为可见字段(由 `computeCameraPos` / `isOnScreen` 实时算)。
 *
 * 模块间事件契约(plan §3 + EventBus 当前字典):
 *  - 订阅 `map:loaded`(切关时缓存标脏,下一帧重算 clamp 范围)。
 *  - 发出 `camera:moved { pos, viewportSize }`(与上一帧位置不同时才发)。
 *
 * 启动顺序:
 *  - 工厂在装配时**不**主动 `start()` follower —— 由根容器在装配阶段
 *    显式调 `port.start()` 完成"装配 → 启动"切换。这样测试可以装配完后
 *    注入 fake player position,再 `start()` 触发首帧 tick。
 *  - `start()` 是幂等的(内部 guard 防止重复订阅)。
 */
import type { Vec2 } from "../../runtime/types";
import type { GameEventBus } from "../../runtime/EventBus";
import type { RuntimePort } from "../runtime";
import type { MapObstaclePort } from "../../runtime/ports/MapObstaclePort";
import type { PlayerPort } from "../../runtime/ports/PlayerPort";
import type { CameraPort } from "../../runtime/ports/CameraPort";

import { createCameraController } from "./internal/CameraController";
import { createCameraFollower } from "./internal/CameraFollower";
import type { CameraFollower } from "./internal/CameraFollower";

/** `createCameraModule` 工厂签名。 */
export interface CameraModuleDeps {
  /** 事件总线(收 `map:loaded` / 发 `camera:moved`)。 */
  bus: GameEventBus;
  /** 引擎 / 帧 / 视口(`CameraFollower` 消费)。 */
  runtime: RuntimePort;
  /** 地图边界(`CameraFollower` 消费 + `isOnScreen` 派生)。 */
  obstacles: MapObstaclePort;
  /** 玩家位置(`CameraFollower` 消费)。 */
  player: PlayerPort;
}

/**
 * `createCameraModule` 工厂返回的扩展 Port(测试 / HMR 用)。
 *
 * 业务代码拿到的就是 `CameraPort`;`start()` 是装配完成后的"启动开关"
 * (roadmap §6 联调阶段 RootContainer 调一次;单测也通过它驱动 follower)。
 */
export type CameraPortFactory = (deps: CameraModuleDeps) => CameraPort & {
  /**
   * 启动帧驱动订阅 + 切关事件订阅(幂等)。**不**调 = follower 不工作;
   * `CameraPort.pos()` 会回退到 Excalibur 摄像机的初始位置(一般是 `{0,0}`)。
   * 由根容器 / 测试在装配完成后调一次。
   */
  start(): void;
  /** 测试 / HMR 用:停止帧驱动 + 切关订阅,dispose Camera。 */
  __dispose(): void;
};

/**
 * 创建 Camera 模块实例。
 *
 * 生命周期(由根容器保证):
 *  1. 根容器 `createCameraModule({ bus, runtime, obstacles, player })` → 拿 `CameraPort`。
 *  2. 根容器装配完所有模块后,调 `port.start()` 启动 follower。
 *  3. 业务模块(Combat / Enemy 调 `isOnScreen`、HudUi 订阅 `camera:moved`、其它模块
 *     调 `pos` / `viewportSize`)拿这个 Port。
 *  4. 销毁:根容器生命 = 进程生命,本模块**不**主动 dispose;测试 / HMR 可调
 *     `__dispose`(销毁 follower 订阅 + 重置内部状态)。
 */
export const createCameraModule: CameraPortFactory = (deps) => {
  // ---- 0. 内部子模块装配 ----
  const controller = createCameraController();
  let follower: CameraFollower = createCameraFollower({
    bus: deps.bus,
    runtime: deps.runtime,
    obstacles: deps.obstacles,
    player: deps.player,
    controller,
  });
  let started = false;
  let dispose: (() => void) | null = null;

  // ---- 1. 公开 Port ----
  const port: CameraPort = {
    pos(): Vec2 {
      // 读 Excalibur `Scene.camera.pos` 快照(camera.md §2 + CameraPort 注释)。
      // 装配期 / 测试无场景:兜底 `{0, 0}` 避免 null 污染。
      const scene = deps.runtime.engine.currentScene;
      if (!scene) return { x: 0, y: 0 };
      return { x: scene.camera.pos.x, y: scene.camera.pos.y };
    },
    viewportSize(): Vec2 {
      // 走 RuntimePort(RuntimeModule.viewportSize 已与 Excalibur 画布同步)。
      const r = deps.runtime.viewportSize();
      return { x: r.width, y: r.height };
    },
    isOnScreen(worldPos: Vec2): boolean {
      // 复用 controller 同一份 clamp 几何(关键不变量,camera.md §2 + §5)。
      const r = deps.runtime.viewportSize();
      return controller.isOnScreen(worldPos, deps.obstacles.bounds(), {
        x: r.width,
        y: r.height,
      });
    },
  };

  // ---- 2. 内部扩展(测试 / HMR 用)----
  const portWithExtras = port as CameraPort & {
    start: () => void;
    __dispose: () => void;
  };
  portWithExtras.start = (): void => {
    if (started) return; // 幂等
    dispose = follower.start();
    started = true;
  };
  portWithExtras.__dispose = (): void => {
    if (dispose) {
      dispose();
      dispose = null;
    }
    started = false;
    // follower 内部不持有可重入状态(`cachedBounds` 是单次缓存),
    // dispose 后下次 `start` 会重新创建一份 follower,避免 stale closure 污染。
    follower = createCameraFollower({
      bus: deps.bus,
      runtime: deps.runtime,
      obstacles: deps.obstacles,
      player: deps.player,
      controller,
    });
  };

  return portWithExtras;
};
