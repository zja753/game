/**
 * `createMockInput` — Input 模块的 Mock 工厂。
 *
 * 按 plan/modular-roadmap.md §0.3 / §5.1,Input 是"桥接型模块",为其他模块
 * (Player / Progression / …)的单测提供 stub。Mock 形态 = 一个 `InputPort`,
 * 让测试代码不依赖 DOM / Runtime 真实环境,直接驱动按键状态、断言收到的事件。
 *
 * 关键不变量:
 *  - **不**监听 DOM,纯 TS。
 *  - `press(key)` / `release(key)` 改内部状态,同时按真实模块语义
 *    维护"边沿队列";`emitMove()` 由测试显式触发(模拟"每帧一次 onTick")。
 *  - `axisMove()` / `axisAim()` 走和真实模块同样的归一化逻辑(直接
 *    调用 `IntentNormalizer` 是不行的——Mock 不持有 bus,所以这里重写一份
 *    纯函数化的版本,保证 mock 与真实实现行为一致)。
 *  - 暴露 `on(type, handler)` 给测试订阅事件,内部就是一个小 EventBus,
 *    避免依赖外部 `runtime/EventBus`。
 */
import type { InputKey, Vec2 } from "../../../runtime/types";
import type { InputPort } from "../../../runtime/ports/InputPort";
import type { GameEvent, GameEventType } from "../../../runtime/EventBus";
/** Mock 工厂的可调参数。 */
export interface MockInputOptions {
  /** 视口宽;默认 800。 */
  viewportWidth?: number;
  /** 视口高;默认 600。 */
  viewportHeight?: number;
}

/** `createMockInput` 返回的扩展 Port,带 spy / 驱动函数。 */
export interface MockInputHandle extends InputPort {
  /** 注入的"按下的语义键"集合(spy 视角)。 */
  readonly heldKeys: ReadonlyArray<InputKey>;
  /** 已 emit 的事件列表(spy 视角)。 */
  readonly emitted: ReadonlyArray<GameEvent>;
  /**
   * 测试驱动:模拟玩家按下某键。
   * 等价于真实模块收到一次非 repeat 的 `keydown`,会更新 `isDown` + 排队边沿。
   */
  press(key: InputKey): void;
  /** 测试驱动:模拟玩家松开某键。 */
  release(key: InputKey): void;
  /**
   * 测试驱动:模拟 Runtime 一帧(`IntentNormalizer.flush`)。
   * - 比较 `axisMove` 与上一帧,变化时 emit `input:move`。
   * - 消费边沿队列,emit `input:fire` / `input:pause`。
   */
  emitMove(): void;
  /**
   * 测试驱动:模拟鼠标移动(更新 `mousePos`)。
   */
  moveMouse(pos: Vec2): void;
  /** 订阅事件(给测试断言用,内部 mini bus)。 */
  on<T extends GameEventType>(
    type: T,
    handler: (event: Extract<GameEvent, { type: T }>) => void,
  ): () => void;
  /** 清空所有 spy / 状态(按键表、边沿队列、emitted 列表)。 */
  reset(): void;
}

/**
 * 把 (dx, dy) 归一化;与 `IntentNormalizer.normalizeOrZero` 行为一致。
 * 复刻一份而不是 import 内部子模块:Mock 工厂应只依赖公共类型,不能
 * 反向 import `modules/input/internal/*`(否则别的模块拿 Mock 时会
 * 把内部拽进来,破坏封装)。
 */
function normalizeOrZero(dx: number, dy: number): Vec2 {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

export function createMockInput(opts: MockInputOptions = {}): MockInputHandle {
  // ---- 状态 ----
  const vw = opts.viewportWidth ?? 800;
  const vh = opts.viewportHeight ?? 600;
  const held = new Set<InputKey>();
  const edgeQueue: InputKey[] = [];
  let mousePos: Vec2 = { x: 0, y: 0 };
  let lastAxis: Vec2 = { x: 0, y: 0 };
  const emitted: GameEvent[] = [];

  // ---- 内部 mini EventBus ----
  const subs = new Map<GameEventType, Set<(e: GameEvent) => void>>();
  function busEmit(ev: GameEvent): void {
    emitted.push(ev);
    const b = subs.get(ev.type);
    if (!b) return;
    for (const h of Array.from(b)) h(ev);
  }
  function busOn<T extends GameEventType>(
    type: T,
    handler: (event: Extract<GameEvent, { type: T }>) => void,
  ): () => void {
    const h = handler as (e: GameEvent) => void;
    let s = subs.get(type);
    if (!s) {
      s = new Set();
      subs.set(type, s);
    }
    s.add(h);
    return () => {
      s?.delete(h);
    };
  }

  // ---- 内部 helper(走与真实 IntentNormalizer 相同的归一化) ----
  function axisMoveRaw(): Vec2 {
    const up = held.has("up") ? 1 : 0;
    const down = held.has("down") ? 1 : 0;
    const left = held.has("left") ? 1 : 0;
    const right = held.has("right") ? 1 : 0;
    return normalizeOrZero(right - left, down - up);
  }
  function axisAimRaw(pos: Vec2): Vec2 {
    return normalizeOrZero(pos.x - vw / 2, pos.y - vh / 2);
  }

  // ---- Port 实现 ----
  const port: MockInputHandle = {
    isDown: (key) => held.has(key),
    axisMove: () => axisMoveRaw(),
    axisAim: (pos) => axisAimRaw(pos),
    mousePos: () => ({ x: mousePos.x, y: mousePos.y }),
    enable: () => {
      // mock 不挂 DOM,这里保持 no-op,保留接口对称。
    },
    disable: () => {
      // mock 不挂 DOM,这里保持 no-op,保留接口对称。
    },

    // ---- spy 视图 ----
    get heldKeys() {
      return Array.from(held);
    },
    get emitted() {
      return emitted;
    },

    // ---- 驱动方法 ----
    press(key) {
      // 严格边沿:首次按下才入队(模拟真实 KeyboardMap 的 `held.has(key)` 守卫)。
      if (held.has(key)) return;
      held.add(key);
      edgeQueue.push(key);
    },
    release(key) {
      held.delete(key);
    },
    emitMove() {
      const axis = axisMoveRaw();
      if (axis.x !== lastAxis.x || axis.y !== lastAxis.y) {
        lastAxis = axis;
        busEmit({ type: "input:move", dx: axis.x, dy: axis.y });
      }
      if (edgeQueue.length > 0) {
        const edges = edgeQueue.splice(0, edgeQueue.length);
        for (const k of edges) {
          if (k === "fire") busEmit({ type: "input:fire", pressed: true });
          else if (k === "pause") busEmit({ type: "input:pause", pressed: true });
          // 移动键的"边沿"不发事件——与真实 IntentNormalizer 一致。
        }
      }
    },
    moveMouse(pos) {
      mousePos = { x: pos.x, y: pos.y };
    },
    on: busOn,
    reset() {
      held.clear();
      edgeQueue.length = 0;
      mousePos = { x: 0, y: 0 };
      lastAxis = { x: 0, y: 0 };
      emitted.length = 0;
      subs.clear();
    },
  };

  return port;
}
