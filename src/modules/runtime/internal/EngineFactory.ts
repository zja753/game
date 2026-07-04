/**
 * `EngineFactory`:Runtime 的"造 / 销毁 Excalibur Engine"实现(见 plan/modules/runtime.md §5.1)。
 *
 * 职责:
 *  - `new Engine(...)` 创建引擎并配置视觉默认值(antialiasing / suppressConsoleBootMessage)。
 *  - 监听 window resize / devicePixelRatio 变化。
 *    `Fixed` 模式下 Excalibur 不会自动跟踪 window,需要手动同步 canvas 尺寸;
 *    其它显示模式(自适应容器 / 全屏等)由 Excalibur Screen 内部处理。
 *  - 通过 WeakMap 把监听句柄挂在 engine 实例上,确保多个 engine 实例互不干扰,
 *    `destroy(engine)` 时能精确拆卸对应的那一组监听。
 *
 * 不做:不做任何业务逻辑、不持有 Scene 句柄、不驱动帧。
 */
import { Engine, Color, DisplayMode } from "excalibur";
import type { Subscription } from "excalibur";

/** `create` 的可选配置。 */
export interface EngineFactoryOptions {
  width?: number;
  height?: number;
  /** CSS 色值(`#rrggbb` / `#rrggbbaa`),可选;提供时塞到 `engine.backgroundColor`。 */
  backgroundColor?: string;
}

/** WeakMap:engine -> 该 engine 注册的全部监听句柄(便于 destroy 时一次性拆掉)。 */
const handles = new WeakMap<Engine, { dispose: () => void }>();

/**
 * 创建一个新的 Excalibur Engine,挂好 resize / DPR 监听,登记到 WeakMap。
 * 多次调用是合法的(测试场景),每个 engine 独立一组监听。
 */
export function create(canvas: HTMLCanvasElement, opts: EngineFactoryOptions = {}): Engine {
  const engine = new Engine({
    canvasElement: canvas,
    width: opts.width ?? 800,
    height: opts.height ?? 600,
    antialiasing: true,
    suppressConsoleBootMessage: true,
  });

  if (opts.backgroundColor) {
    engine.backgroundColor = Color.fromHex(opts.backgroundColor);
  }

  // 收集所有订阅句柄,统一走一个 dispose
  const screenResizeSub: Subscription = engine.screen.events.on("resize", () => {
    // Excalibur 的 Screen 自己已经处理了非 Fixed 模式的视口/DPR;
    // 我们这条订阅目前主要供 RuntimeModule 后续接入扩展用(比如通知 Camera 重算 clamp)。
    // 这里**不**重复写 canvas 尺寸,避免和 Excalibur 内部互相覆盖。
  });

  let windowResizeDispose: (() => void) | null = null;
  let dprDispose: (() => void) | null = null;

  // Fixed 模式下 Excalibur 不会自动跟踪 window resize,我们手动同步一次。
  if (engine.screen.displayMode === DisplayMode.Fixed) {
    const onWindowResize = () => {
      const targetWidth = opts.width ?? canvas.clientWidth ?? 800;
      const targetHeight = opts.height ?? canvas.clientHeight ?? 600;
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      // 把当前尺寸写回 screen.resolution,供 Camera / viewport 查询用。
      engine.screen.resolution = { width: targetWidth, height: targetHeight };
      engine.screen.applyResolutionAndViewport();
    };
    window.addEventListener("resize", onWindowResize);
    windowResizeDispose = () => window.removeEventListener("resize", onWindowResize);
  }

  // 监听 devicePixelRatio 变化(Retina 拖窗口到外接屏时常见)。
  const dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const onDprChange = () => {
    engine.screen.applyResolutionAndViewport();
  };
  // Safari <= 13.1 走 addListener/removeListener;现代浏览器走 addEventListener。
  if (typeof dprQuery.addEventListener === "function") {
    dprQuery.addEventListener("change", onDprChange);
    dprDispose = () => dprQuery.removeEventListener("change", onDprChange);
  } else {
    const legacy = dprQuery as unknown as {
      addListener: (cb: () => void) => void;
      removeListener: (cb: () => void) => void;
    };
    legacy.addListener(onDprChange);
    dprDispose = () => legacy.removeListener(onDprChange);
  }

  handles.set(engine, {
    dispose: () => {
      screenResizeSub.close();
      windowResizeDispose?.();
      dprDispose?.();
    },
  });

  return engine;
}

/**
 * 销毁 engine:pop 出 WeakMap 上的监听句柄并 dispose,再调 `engine.stop()` 与 `engine.dispose()`。
 * WeakMap miss 时(未登记或已销毁)只走 stop + dispose。
 */
export function destroy(engine: Engine): void {
  const entry = handles.get(engine);
  if (entry) {
    entry.dispose();
    handles.delete(engine);
  }
  engine.stop();
  engine.dispose();
}
