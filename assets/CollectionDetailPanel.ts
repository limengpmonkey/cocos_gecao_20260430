import { _decorator, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import type { CollectionEntrySnapshot } from './demos/bulletHell/CollectionSystem';

const { ccclass, property } = _decorator;

@ccclass('CollectionDetailPanel')
export class CollectionDetailPanel extends Component {
    @property(Sprite)
    iconSprite: Sprite | null = null;

    @property(Node)
    iconDisplayHost: Node | null = null;

    @property(Label)
    iconLabel: Label | null = null;

    @property(Label)
    titleLabel: Label | null = null;

    @property(Label)
    statusLabel: Label | null = null;

    @property(Label)
    descriptionLabel: Label | null = null;

    @property(Label)
    strategyLabel: Label | null = null;

    @property(Node)
    homeButton: Node | null = null;

    @property(Node)
    gameButton: Node | null = null;

    @property(Node)
    resetButton: Node | null = null;

    public bindActions(onHome: () => void, onGame: () => void, onReset: () => void, target?: unknown): void {
        this.bindButton(this.homeButton, onHome, target);
        this.bindButton(this.gameButton, onGame, target);
        this.bindButton(this.resetButton, onReset, target);
    }

    public render(
        entry: CollectionEntrySnapshot,
        detailIcon: SpriteFrame | null,
        fallbackSymbol: string,
        lockedHint: string,
        lockedCondition: string,
        accentColor: Color,
    ): void {
        if (this.iconSprite) {
            this.iconSprite.spriteFrame = detailIcon;
            this.iconSprite.color = detailIcon ? Color.WHITE.clone() : accentColor.clone();
            this.iconSprite.node.active = !!detailIcon;
        }

        if (this.iconLabel) {
            this.iconLabel.string = entry.unlocked ? fallbackSymbol : '??';
            this.iconLabel.color = accentColor.clone();
            this.iconLabel.node.active = !detailIcon;
        }

        if (this.titleLabel) {
            this.titleLabel.string = entry.unlocked ? entry.definition.name : '未解锁收藏';
        }

        if (this.statusLabel) {
            this.statusLabel.string = entry.unlocked
                ? `${entry.definition.badge}  已收藏`
                : `${entry.definition.badge}  ${lockedHint}`;
        }

        if (this.descriptionLabel) {
            this.descriptionLabel.string = entry.unlocked
                ? `${entry.definition.shortDescription}\n\n${entry.definition.details}`
                : `尚未解锁该卡片。\n\n${lockedHint}\n\n解锁后将显示完整描述与详情。`;
        }

        if (this.strategyLabel) {
            this.strategyLabel.string = entry.unlocked
                ? `搜集策略\n${entry.definition.strategy}`
                : `解锁条件\n${lockedCondition}`;
        }
    }

    private bindButton(node: Node | null, handler: (() => void) | null, target?: unknown): void {
        if (!node || !handler) {
            return;
        }

        node.off(Node.EventType.TOUCH_END);
        node.on(Node.EventType.TOUCH_END, handler, target);
    }
}