// PixelPerfectScaler.ts - 像素完美缩放控制器
import { _decorator, Component, Sprite, Vec3 } from 'cc';
const { ccclass, property } = _decorator;
@ccclass('PixelPerfectScaler')
export class PixelPerfectScaler extends Component {
    private _originalScale: Vec3 = new Vec3(1, 1, 1);

    get originalScale(): Readonly<Vec3> {
        return this._originalScale;
    }

    get scaleMultiplier(): number {
        return this.calculateScaleMultiplier();
    }

    @property({ tooltip: "基础素材尺寸" })
    basePixelSize: number = 32; // 基础素材尺寸（32x32）
    
    @property({ tooltip: "目标显示尺寸" })
    targetPixelSize: number = 64; // 目标显示尺寸
    
    @property({ tooltip: "是否保持整数倍缩放" })
    keepIntegerScale: boolean = true;
    
    onLoad(): void {
        this._originalScale.set(this.node.scale);
        this.applyPixelPerfectScale();
    }
    
    applyPixelPerfectScale(): void {
        const sprite = this.getComponent(Sprite);
        if (!sprite) return;

        const baseSize = Math.max(1, this.basePixelSize);
        const targetSize = Math.max(1, this.targetPixelSize);
        const scaleMultiplier = this.calculateScaleMultiplier();
        
        // 基于原始缩放应用，避免重复调用时不断叠乘变大
        this.node.setScale(
            this._originalScale.x * scaleMultiplier,
            this._originalScale.y * scaleMultiplier,
            this._originalScale.z * scaleMultiplier
        );
        
        // 设置像素过滤器
        this.setupPixelFilter(sprite, scaleMultiplier);
        
        // console.log(`像素缩放: ${baseSize} -> ${targetSize} (${scaleMultiplier}x)`);
    }

    private calculateScaleMultiplier(): number {
        const baseSize = Math.max(1, this.basePixelSize);
        const targetSize = Math.max(1, this.targetPixelSize);

        if (this.keepIntegerScale) {
            return Math.max(1, Math.floor(targetSize / baseSize));
        }

        return targetSize / baseSize;
    }
    
    setupPixelFilter(sprite: Sprite, scale: number): void {
        // 确保像素风格清晰
        if (sprite.spriteFrame) {
            // 设置材质为像素风格
            // 注意：Cocos Creator 3.x 中需要设置材质的过滤模式
            const material = sprite.customMaterial || sprite.getMaterial(0);
            if (material) {
                // 某些材质没有该属性，避免运行时报错
                try {
                    material.setProperty('pixelSnap', 1);
                } catch {
                    // 忽略不支持 pixelSnap 的材质
                }
            }
        }
    }
}