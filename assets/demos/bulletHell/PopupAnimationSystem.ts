// PopupAnimationSystem.ts
import { _decorator, Component, Node, tween, Vec3, Color, Sprite, v3, view, instantiate } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('PopupAnimationSystem')
export class PopupAnimationSystem extends Component {
    // 弹窗组件引用
    @property(Node)
    popupPanel: Node = null;  // 弹窗主体
    
    @property(Node)
    background: Node = null;  // 背景遮罩
    
    @property
    showDuration: number = 0.5;  // 显示动画时长
    @property
    hideDuration: number = 0.3;  // 隐藏动画时长
    
    // 动画预设
    private animationPresets = {
        elastic: { 
            show: { duration: 0.6, easing: 'elasticOut' },
            hide: { duration: 0.3, easing: 'elasticIn' }
        },
        bounce: { 
            show: { duration: 0.7, easing: 'backOut' },
            hide: { duration: 0.4, easing: 'backIn' }
        },
        smooth: { 
            show: { duration: 0.5, easing: 'smooth' },
            hide: { duration: 0.3, easing: 'smooth' }
        }
    };
    
    onLoad(): void {
        this.setInitialState();
    }
    
    /**
     * 设置初始状态
     */
    private setInitialState(): void {
        if (this.background) {
            const bgSprite = this.background.getComponent(Sprite);
            if (bgSprite) {
                bgSprite.color = new Color(bgSprite.color.r, bgSprite.color.g, bgSprite.color.b, 0);
            }
        }
        
        if (this.popupPanel) {
            this.popupPanel.setScale(0, 0, 0);
            const panelSprite = this.popupPanel.getComponent(Sprite);
            if (panelSprite) {
                panelSprite.color = new Color(panelSprite.color.r, panelSprite.color.g, panelSprite.color.b, 0);
            }
        }
    }
    
    /**
     * 显示弹窗（弹性效果）
     */
    public showWithElastic(callback?: () => void): void {
        this.node.active = true;
        
        // 背景淡入
        if (this.background) {
            const bgSprite = this.background.getComponent(Sprite);
            if (bgSprite) {
                const c = bgSprite.color;
                tween(bgSprite)
                    .to(0.2, { color: new Color(c.r, c.g, c.b, 180) })
                    .start();
            }
        }
        
        // 弹窗弹性动画
        if (this.popupPanel) {
            const panelSprite = this.popupPanel.getComponent(Sprite);
            
            // 并行动画：缩放 + 旋转 + 淡入
            const panelTween = tween(this.popupPanel)
                .parallel(
                    // 缩放（带弹性）
                    tween(this.popupPanel)
                        .to(0.5, { scale: v3(1.1, 1.1, 1) }, { easing: 'elasticOut' })
                        .to(0.1, { scale: v3(1, 1, 1) }),
                    
                    // 轻微旋转效果
                    tween(this.popupPanel)
                        .by(0.2, { eulerAngles: v3(0, 0, 5) })
                        .by(0.2, { eulerAngles: v3(0, 0, -5) })
                        .to(0.1, { eulerAngles: v3(0, 0, 0) })
                )
                .call(() => {
                    callback?.();
                });
            
            if (panelSprite) {
                const c = panelSprite.color;
                tween(panelSprite)
                    .to(0.3, { color: new Color(c.r, c.g, c.b, 255) })
                    .start();
            }
            panelTween.start();
        }
    }
    
    /**
     * 显示弹窗（3D飞入效果）
     */
    public showWith3DFlyIn(direction: 'top' | 'bottom' | 'left' | 'right' = 'top', callback?: () => void): void {
        this.node.active = true;
        
        // 设置初始位置和状态
        const startPos = this.getStartPosition(direction);
        this.popupPanel.setPosition(startPos);
        this.popupPanel.setScale(v3(0.5, 0.5, 1));
        
        if (this.background) {
            const bgSprite = this.background.getComponent(Sprite);
            if (bgSprite) {
                bgSprite.color = new Color(bgSprite.color.r, bgSprite.color.g, bgSprite.color.b, 0);
                const c = bgSprite.color;
                tween(bgSprite)
                    .to(0.3, { color: new Color(c.r, c.g, c.b, 180) })
                    .start();
            }
        }
        
        // 3D飞入动画
        tween(this.popupPanel)
            .parallel(
                // 飞到中心
                tween(this.popupPanel)
                    .to(0.5, { position: v3(0, 0, 0) }, { easing: 'backOut' }),
                
                // 缩放
                tween(this.popupPanel)
                    .to(0.5, { scale: v3(1, 1, 1) }, { easing: 'elasticOut' }),
                
                // 3D旋转
                tween(this.popupPanel)
                    .to(0.3, { eulerAngles: v3(0, 0, 360) }, { easing: 'cubicOut' })
            )
            .call(() => {
                callback?.();
            })
            .start();
    }
    
    private getStartPosition(direction: string): Vec3 {
        const screenSize = view.getVisibleSize();
        
        switch(direction) {
            case 'top':
                return v3(0, screenSize.height, 0);
            case 'bottom':
                return v3(0, -screenSize.height, 0);
            case 'left':
                return v3(-screenSize.width, 0, 0);
            case 'right':
                return v3(screenSize.width, 0, 0);
            default:
                return v3(0, screenSize.height, 0);
        }
    }
    
    /**
     * 隐藏弹窗（收缩效果）
     */
    public hideWithShrink(callback?: () => void): void {
        // 背景淡出
        if (this.background) {
            const bgSprite = this.background.getComponent(Sprite);
            if (bgSprite) {
                const c = bgSprite.color;
                tween(bgSprite)
                    .to(0.2, { color: new Color(c.r, c.g, c.b, 0) })
                    .start();
            }
        }
        
        // 弹窗收缩动画
        if (this.popupPanel) {
            const panelSprite = this.popupPanel.getComponent(Sprite);
            
            const shrinkTween = tween(this.popupPanel)
                .to(0.3, { scale: v3(0.1, 0.1, 1) })
                .call(() => {
                    this.node.active = false;
                    this.setInitialState(); // 重置状态
                    callback?.();
                });
            
            if (panelSprite) {
                const c = panelSprite.color;
                tween(panelSprite)
                    .to(0.2, { color: new Color(c.r, c.g, c.b, 0) })
                    .start();
            }
            shrinkTween.start();
        }
    }
    
    /**
     * 显示弹窗（带粒子特效）
     */
    public showWithParticleEffect(particlePrefab: Node, callback?: () => void): void {
        this.node.active = true;
        
        // 播放粒子特效
        this.playParticleEffect(particlePrefab, v3(0, 0, 0));
        
        // 延迟显示弹窗
        this.scheduleOnce(() => {
            this.showWithElastic(callback);
        }, 0.3);
    }
    
    private playParticleEffect(prefab: Node, position: Vec3): void {
        const particle = instantiate(prefab);
        particle.position = position;
        this.node.addChild(particle);
        
        // 自动销毁
        this.scheduleOnce(() => {
            particle.destroy();
        }, 2);
    }
}