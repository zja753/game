import { useCallback, useEffect, useRef, useState } from "react";
import type { Engine } from "excalibur";
import { createGame, disposeGame } from "../game/scene";

/**
 * `/game` 路由的根组件,直接挂载 Excalibur 引擎,撑满整个视口。
 *
 * - canvas 元素位于路由根节点,父容器通过 `position: fixed` 占满视口。
 * - 引擎在 `useEffect` 内启动,卸载时通过清理函数释放,避免泄漏 RAF / 音频上下文。
 * - `useRef` 永远只存已就绪的 `Engine` 实例,清理时若 promise 仍未完成,
 *   会在 `.then` 内直接 dispose,不会泄漏。
 * - M0.5:玩家死亡 → Excalibur 端 `onPlayerDeath` 回调 → 切换到 `gameOver` 状态,
 *   DOM 浮层覆盖 canvas。点击"重开"→ `disposeGame` 旧实例 → 递增 `gameKey` →
 *   React 重挂 `<canvas>` → `useEffect` 重建引擎 → `setGameOver(false)`。
 *   `useRef` 保留旧引擎引用,在卸载分支里释放,避免 React 19 StrictMode 双重调用泄漏。
 */
export function Game() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  /**
   * `gameKey` 用于在"重开"时强制 React 重建 canvas 元素 + `useEffect`。
   * 比起"同一 canvas 反复 dispose + create",key 化更简单也更安全:
   * Excalibur 内部对 canvas 绑定的若干 listener 会随元素一起消失,无残留。
   */
  const [gameKey, setGameKey] = useState(0);
  const [isGameOver, setIsGameOver] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    void createGame(canvas, {
      onPlayerDeath: () => {
        // 该回调从 Excalibur 内部事件触发,此时引擎时钟已停。
        // React 18+ 的自动批处理会让多个 setState 合批,这里只发一个就够。
        setIsGameOver(true);
      },
    }).then((engine) => {
      if (disposed) {
        // 卸载先于启动完成,直接释放避免泄漏。
        disposeGame(engine);
        return;
      }
      engineRef.current = engine;
    });

    return () => {
      disposed = true;
      const current = engineRef.current;
      engineRef.current = null;
      if (current) disposeGame(current);
    };
  }, [gameKey]);

  const handleRestart = useCallback(() => {
    // 不在这里手动 dispose:React 会因为 `key` 变化而卸载旧 canvas,
    // `<canvas>` 卸载时自动触发旧 `useEffect` 的 cleanup,
    // cleanup 内会读 `engineRef.current` 并 dispose,避免双 dispose 与 DOM 重复 removeChild。
    // 显式 dispose 反而会与 Excalibur `dispose()` 内的 `parentNode.removeChild` 冲突。
    setIsGameOver(false);
    setGameKey((k) => k + 1);
  }, []);

  return (
    <>
      <canvas
        // 用 gameKey 强制 React 卸载旧 canvas,Excalibur 与之绑定的资源随之消失。
        key={gameKey}
        ref={canvasRef}
        className="game-canvas"
      />
      {isGameOver && (
        <div
          className="game-over-overlay"
          // 阻止 pointer 事件穿透到 canvas,避免误触空格再次触发逻辑(虽然 clock 已停)。
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="game-over-panel" role="dialog" aria-modal="true">
            <h2 className="game-over-title">Game Over</h2>
            <p className="game-over-subtitle">你被围殴了。</p>
            <button
              type="button"
              className="game-over-button"
              onClick={handleRestart}
              // 自动 focus,键盘按 Enter / Space 也能直接重开。
              autoFocus
            >
              重开
            </button>
          </div>
        </div>
      )}
    </>
  );
}
