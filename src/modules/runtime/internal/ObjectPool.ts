/**
 * 泛型对象池。
 *
 * 生命周期三步:`acquire()` 拿(优先复用 free,空则 factory 现造)→
 * 用 → `release(t)` 还(强制 reset,推回 free)。`release` 同一对象多次幂等,
 * 避免重复 reset 污染下游。
 *
 * 不依赖 Excalibur,纯 TypeScript。
 */
export class ObjectPool<T> {
  /** 待复用的空闲对象栈(LIFO,后入先出)。 */
  private free: T[] = [];
  /** 当前借出未还的对象集合,用来检测重复 release。 */
  private readonly inUse: Set<T> = new Set();
  /** 累计 factory 调用次数,用于测试验证"无泄漏"。 */
  private totalCreated: number = 0;
  private readonly factory: () => T;
  private readonly reset: (t: T) => void;

  constructor(factory: () => T, reset: (t: T) => void) {
    this.factory = factory;
    this.reset = reset;
  }

  /**
   * 取一个对象:池里有就 pop,空就 factory 现造。
   * 内部登记到 inUse,保证 release 时能定位。
   */
  acquire(): T {
    const t = this.free.pop();
    if (t !== undefined) {
      this.inUse.add(t);
      return t;
    }
    const created = this.factory();
    this.totalCreated++;
    this.inUse.add(created);
    return created;
  }

  release(t: T): void {
    if (!this.inUse.delete(t)) return;
    this.reset(t);
    this.free.push(t);
  }

  /** 当前借出未还的数量。 */
  get inUseCount(): number {
    return this.inUse.size;
  }

  /**
   * 累计生产过的对象数(factory 调用次数)。
   * 用于测试验证 acquire/release 对称:全部 release 后 `inUseCount + free.length === size`。
   */
  get size(): number {
    return this.totalCreated;
  }
}
