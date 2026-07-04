/**
 * `/` 路由占位。模块化开发路线下,这里后续会接 RootContainer 装配与 HUD,
 * 当前只展示一行说明,让 `pnpm dev` 有个可见落点。
 */
export function Home() {
  return (
    <section className="page">
      <h1>game</h1>
      <p>
        模块化开发中。详见 <code>plan/modular-roadmap.md</code>。
      </p>
    </section>
  );
}
