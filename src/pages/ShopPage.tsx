/**
 * `/shop` 商店(plan/ui-react-split.md §2)。
 *
 * 第 3+4 步:接通 `useGameState()` —— 商品列表通过 Progression 内部
 * `rewardShop.rollShopItems(level)` 拿(后续 Progression 暴露
 * `currentShopItems()` getter 后可直接读,本期先走 listRewards + 过滤)。
 *
 * 交互:
 *  - 点商品:调 `rewardShop.applyReward(id)`。Progression 的
 *    `reward:picked` 监听会自动把场景切到下一关 `running`,RouteSceneBridge
 *    收到 `level:phase` 后 navigate 到 `/play`。
 *  - "离开商店":调 `progression.advance()`(shop → running 转移;roadmap §1)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 本文件不直接 import 任何 modules 下的 internal;Port 通过 Context 注入。
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { useGameState } from "../runtime/GameStateContext";
import type { ShopItem } from "../runtime/types";

/**
 * 商品列表 —— `rewardShop.listRewards()` 拿全部注册项,过滤 `kind === "shop"`
 * 的子集,塞到 React 渲染。
 *
 * 第一版走"全部 shop kind 注册项";后续 Progression 提供关卡折扣/过滤时
 * 再改成 `progression.currentShopItems()`。
 */
function useShopItems(state: ReturnType<typeof useGameState>): readonly ShopItem[] {
  return useMemo(() => {
    if (state === null) return [];
    const list = state.rewardShop.listRewards();
    const items: ShopItem[] = [];
    for (const r of list) {
      if (r.kind !== "shop") continue;
      // `RewardRegistration` 的 name/description/price 都是 optional;
      // ShopItem 要求必填,做兜底默认值。
      items.push({
        id: r.id,
        name: r.name ?? r.id,
        description: r.description ?? "",
        price: r.price ?? 0,
      });
    }
    return items;
  }, [state]);
}

export function ShopPage(): React.ReactElement {
  const navigate = useNavigate();
  const state = useGameState();
  const items = useShopItems(state);
  return (
    <section className="page">
      <h1 className="page__title">商店</h1>
      <ul className="shop-list">
        {items.map((item) => (
          <li key={item.id} className="shop-list__item">
            <button
              type="button"
              className="shop-card"
              onClick={() => {
                if (state === null) return;
                // applyReward 由 Progression 监听 reward:picked 后自动调;
                // 这里直接调也行 —— Progression 的 reward:picked 监听会在
                // applyReward 完成后把场景切到 running,RouteSceneBridge 跳路由。
                state.rewardShop.applyReward(item.id);
              }}
            >
              <span className="shop-card__name">{item.name}</span>
              <span className="shop-card__desc">{item.description}</span>
              <span className="shop-card__price">{item.price}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="page__cta"
        onClick={() => {
          if (state === null) {
            void navigate("/play");
            return;
          }
          // shop → running 转移;roadmap §1 表 advance() 列。
          state.progression.advance();
        }}
      >
        离开商店
      </button>
    </section>
  );
}
