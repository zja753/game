/**
 * `FrameClock`:Runtime 的"统一时钟"实现(见 plan/modules/runtime.md §5.3)。
 *
 * 订阅 Excalibur `engine.on('preupdate', ...)`,把每帧 `e.elapsed`(毫秒)
 * 累加到 `accumulatedMs`,并把 `dt` 广播给所有 `onTick` 订阅者。
 *
 * 暂停语义:Excalibur 在 `engine.clock` 停止时**不**发 `preupdate`,
 * 所以 `accumulatedMs` 自然暂停累计,无需额外逻辑。
 */
import type { Engine, PreUpdateEvent } from "excalibur";

export class FrameClock {
  private subs: Set<(dt: number) => void> = new Set();
  // 游戏内时间(毫秒);`preupdate` 每帧累加 `dt`
  private accumulatedMs = 0;
  // attach 幂等性保护
  private attached = false;

  attach(engine: Engine): void {
    if (this.attached) return;
    this.attached = true;
    engine.on("preupdate", (e: PreUpdateEvent<Engine>) => {
      const dt = e.elapsed;
      this.accumulatedMs += dt;
      // 拷贝一份迭代,避免 cb 内部反订阅导致 Set 被修改
      for (const cb of this.subs) cb(dt);
    });
  }

  now(): number {
    return this.accumulatedMs;
  }

  onTick(cb: (dt: number) => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }
}
