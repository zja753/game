/**
 * `KeyboardMap` — 物理键位 ↔ 语义 `InputKey` 的中间层(plan/modules/input.md §5)。
 *
 * 职责:
 *  1. 监听 DOM `keydown` / `keyup`,把物理键位(`KeyboardEvent.code`)翻成
 *     业务模块用的 `InputKey`(`runtime/types.ts` 的联合)。
 *  2. 维护"当前按下的语义键集合"(`Set<InputKey>`),供 `isDown` 实时查询。
 *  3. **不**做归一化 / 不发事件(那是 `IntentNormalizer` 的职责)。
 *  4. 提供 `consumeEdges()` — 每帧给 `IntentNormalizer` 一组"本帧新按下的键"
 *     (边沿触发 fire / pause 用),消费完就清空。
 *
 * 关键不变量(plan §6 验收点):
 *  - `enable` / `disable` 切换**不**清空按键表(玩家按着 W 暂停 → 恢复
 *    后仍被认为在按 W,Player 继续往前走)。
 *  - 重复键(`repeat: true`)抑制:`fire` 这类边沿事件不会因为"按住"被重复触发。
 *  - modifier(Ctrl / Meta / Alt)按下时**忽略**所有输入,避免浏览器快捷键
 *    (Cmd-W 关页签)被误识别为游戏输入。
 *  - 边沿队列不被 `disable` 清空(玩家按 fire 暂停的那一帧的"边沿"仍然记账;
 *    避免恢复后"漏一发" — 这是显式决策,如果以后要"暂停不消费边沿",
 *    在 InputModule 那层处理,不在 KeyboardMap 这里清)。
 */
import type { InputKey } from "../../../runtime/types";

/**
 * `KeyboardEvent.code` → 语义键 的静态映射。
 *
 * 用 `code`(物理键位)而不是 `key`(字符)的好处:键盘布局无关、Shift 状态无关。
 *
 * 未列出的 `code` 会被忽略(玩家按了不认识的键不影响游戏)。
 */
const KEY_CODE_MAP: Readonly<Record<string, InputKey>> = {
  // 移动
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  // 攻击:Space / J(右手小拇指 / 食指,土豆兄弟玩家习惯)
  Space: "fire",
  KeyJ: "fire",
  // 暂停:Esc / P
  Escape: "pause",
  KeyP: "pause",
};

/**
 * 判断一个 `KeyboardEvent` 是否带 modifier(Ctrl / Meta / Alt)。
 * Shift 不算:Shift+W 在某些键盘布局下有意义,且不冲突系统快捷键。
 */
function hasModifier(ev: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return Boolean(ev.ctrlKey) || Boolean(ev.metaKey) || Boolean(ev.altKey);
}

/** 监听目标(可注入,单测里塞个 `EventTarget` mock 即可)。 */
export type KeyboardEventTarget = EventTarget;

/** 供 `InputModule` 调用的"按下的语义键"判定钩子(给 `IntentNormalizer` 用)。 */
export interface KeyboardMapPort {
  /** 某语义键当前是否按下。 */
  isDown(key: InputKey): boolean;
  /** 当前按下的所有语义键(快照,迭代顺序按 set 插入顺序,仅供调试 / 序列化)。 */
  heldKeys(): ReadonlyArray<InputKey>;
  /**
   * 弹出"本帧起新按下的键"队列(去重、按首次出现顺序)。
   * `IntentNormalizer` 每帧 onTick 调一次,拿到所有 fire / pause 边沿。
   * 调用后内部队列清空。
   */
  consumeEdges(): ReadonlyArray<InputKey>;
}

export class KeyboardMap implements KeyboardMapPort {
  /** 当前按下的语义键集合;`disable` 不会清空它。 */
  private readonly held = new Set<InputKey>();

  /**
   * 自上次 `consumeEdges` 以来的"新按下"边沿队列。
   * 用 Set 而不是数组:同帧重复 `dispatchEvent('keydown', ...)`(理论上不应该
   * 发生,但浏览器扩展 / IME 偶尔会)只记一次。
   */
  private readonly edgeQueue = new Set<InputKey>();

  /** 已注册的 `keydown` / `keyup` 监听器引用,`disable` 时用来 remove。 */
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  /** 是否已挂监听(防止重复 `enable` 重复挂)。 */
  private enabled = false;

  private readonly target: KeyboardEventTarget;

  constructor(target: KeyboardEventTarget) {
    this.target = target;
    // 闭包捕获 `this`,`enable` / `disable` 内部增删的就是这一对函数。
    this.onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
    this.onKeyUp = (e: KeyboardEvent): void => this.handleKeyUp(e);
  }

  // ---- public API(plan §2 InputPort 子集 + 内部供 IntentNormalizer 用) ----

  isDown(key: InputKey): boolean {
    return this.held.has(key);
  }

  heldKeys(): ReadonlyArray<InputKey> {
    return Array.from(this.held);
  }

  consumeEdges(): ReadonlyArray<InputKey> {
    if (this.edgeQueue.size === 0) return EMPTY_KEYS;
    const out = Array.from(this.edgeQueue);
    this.edgeQueue.clear();
    return out;
  }

  /**
   * 强制清空按键表与边沿队列。
   *
   * 调用方:`InputModule` 在 `window.blur` 时调一次,防止 alt-tab 走人后
   * "按着的键"留在 `held` 里变成幽灵输入。
   * **不**由 `disable` 调(plan §6 验收点要求 disable 不清)。
   */
  clear(): void {
    this.held.clear();
    this.edgeQueue.clear();
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.target.addEventListener("keydown", this.onKeyDown as EventListener);
    this.target.addEventListener("keyup", this.onKeyUp as EventListener);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.target.removeEventListener("keydown", this.onKeyDown as EventListener);
    this.target.removeEventListener("keyup", this.onKeyUp as EventListener);
    // 按 plan §6:**不**清空 `held`,恢复时玩家按着的键仍然有效。
    // 边沿队列也**不**清空(见顶部 doc 决策)。
  }

  // ---- 测试 / 内部用旁路(单测里直接喂 KeyboardEvent-like 对象) ----

  /**
   * 直接吃一个 `KeyboardEvent` 跑 keydown 流程(单测用,避开 DOM 路径)。
   *
   * 接受任何带 `code` / `ctrlKey` / `metaKey` / `altKey` / `repeat` 字段的对象。
   * `shiftKey` 接受但不读(`hasModifier` 不计 Shift;`shiftKey?: true` 的对象字面量
   * 在测试里方便写)。
   */
  handleKeyDown(ev: {
    code: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    repeat?: boolean;
  }): void {
    if (ev.repeat) return;
    if (hasModifier(ev)) return;
    const key = KEY_CODE_MAP[ev.code];
    if (!key) return;
    // 边沿:键从"未按"→"按"才算。如果玩家已经按着 W 又收到一次非 repeat 的
    // keydown(罕见,但浏览器扩展 / 焦点切换可能发),不重复入队。
    if (this.held.has(key)) return;
    this.held.add(key);
    this.edgeQueue.add(key);
  }

  /**
   * 直接吃一个 `KeyboardEvent` 跑 keyup 流程(单测用)。
   */
  handleKeyUp(ev: {
    code: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  }): void {
    if (hasModifier(ev)) return;
    const key = KEY_CODE_MAP[ev.code];
    if (!key) return;
    this.held.delete(key);
    // 边沿:松开不入队列(没有"fire-up"这种事件)。
  }
}

/** 空边沿数组,避免每次 `consumeEdges` 调空都 `[]`。 */
const EMPTY_KEYS: ReadonlyArray<InputKey> = Object.freeze([]);
