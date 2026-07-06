/**
 * `/select` 角色选择(plan/ui-react-split.md §2)。
 *
 * 第 3+4 步:接通 `useGameState()` —— 点角色按钮时调
 * `progression.pickCharacter(id)`,Progression 内部切到 running scene
 * 并 emit `level:phase`;`<RouteSceneBridge>` 监听到后 navigate 到 `/play`。
 *
 * 角色列表来源:
 *  - 订阅 `level:phase` 事件,scene === "character_select" 时 SceneContext
 *    带 `characters: readonly CharacterId[]` 字段(roadmap §1 + runtime/types.ts);
 *  - 首版 Progression 默认 `["default"]`(由 GameSceneController 内部 hardcode)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 本文件不直接 import 任何 modules 下的 internal;Port 通过 Context 注入。
 *  - 当前页面只读 Context 的 progression 字段,其他字段不引。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useGameState } from "../runtime/GameStateContext";
import type { CharacterId } from "../runtime/types";

/**
 * 缓存最近一次 `character_select` scene 的 characters 列表。
 *
 * - 事件流:Progression 在切到 character_select 时发 `level:phase`,
 *   SceneContext.characters 是当前可选项。
 * - 首版默认 ["default"];接入真实角色系统后 Progression 的 characterList
 *   配置项会改变这里的渲染。
 */
function useCharacterList(): readonly CharacterId[] {
  const state = useGameState();
  const [list, setList] = useState<readonly CharacterId[]>([]);
  useEffect(() => {
    if (state === null) return;
    return state.bus.on("level:phase", (event) => {
      if (event.scene !== "character_select") return;
      if (event.context.scene !== "character_select") return;
      setList(event.context.characters);
    });
  }, [state]);
  return list;
}

export function CharacterSelectPage(): React.ReactElement {
  const navigate = useNavigate();
  const state = useGameState();
  const characters = useCharacterList();
  return (
    <section className="page">
      <h1 className="page__title">选择角色</h1>
      <ul className="character-list">
        {characters.length === 0 ? (
          <li className="character-list__empty">加载中…</li>
        ) : (
          characters.map((id) => (
            <li key={id} className="character-list__item">
              <button
                type="button"
                className="page__cta"
                onClick={() => {
                  if (state === null) {
                    // Context 还没就绪 —— 极少发生,降级走纯 navigate
                    // (后续切到 running 时 RouteSceneBridge 不会重新 fire)。
                    void navigate("/play");
                    return;
                  }
                  // 触发场景转移:character_select → running;RouteSceneBridge
                  // 收到 level:phase 后会 navigate 到 /play。
                  state.progression.pickCharacter(id);
                }}
              >
                {id}
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
