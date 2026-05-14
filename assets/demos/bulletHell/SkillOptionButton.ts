// SkillOptionButton.ts
// 这是一个可复用的组件，用于自动把 SkillSelectionSystem 的技能选择逻辑绑定到按钮上。

import { _decorator, Component, Button } from 'cc';
import { SkillSelectionSystem } from './SkillSelectionSystem';

const { ccclass, property } = _decorator;

@ccclass('SkillOptionButton')
export class SkillOptionButton extends Component {
    @property({ tooltip: '当前按钮对应的技能 ID' })
    public skillId: string = '';

    // 运行时自动填充，不建议在编辑器里修改
    public skillSystem: SkillSelectionSystem = null;

    onLoad() {
        const btn = this.getComponent(Button);
        if (!btn) return;
        btn.node.on(Button.EventType.CLICK, this.onClick, this);
    }

    onDestroy() {
        const btn = this.getComponent(Button);
        if (btn) {
            btn.node.off(Button.EventType.CLICK, this.onClick, this);
        }
    }

    onClick() {
        if (!this.skillSystem) return;
        if (!this.skillId) return;
        this.skillSystem.selectSkill(this.skillId);
    }

    /**
     * 运行时设置技能ID 和 关联的 SkillSelectionSystem
     */
    public bind(skillId: string, system: SkillSelectionSystem) {
        this.skillId = skillId;
        this.skillSystem = system;
    }
}
