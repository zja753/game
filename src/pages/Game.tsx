import { useEffect, useRef } from "react";
import type { Engine } from "excalibur";
import { createGame, disposeGame } from "../game/scene";

/**
 * `/game` 路由的根组件,直接挂载 Excalibur 引擎,撑满整个视口。
 *
 * - canvas 元素位于路由根节点,父容器通过 `position: fixed` 占满视口。
 * - 引擎在 `useEffect` 内启动,卸载时通过清理函数释放,避免泄漏 RAF / 音频上下文。
 * - `useRef` 永远只存已就绪的 `Engine` 实例,清理时若 promise 仍未完成,
 *   会在 `.then` 内直接 dispose,不会泄漏。
 */
export function Game() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    void createGame(canvas).then((engine) => {
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
  }, []);

  return <canvas ref={canvasRef} className="game-canvas" />;
}
