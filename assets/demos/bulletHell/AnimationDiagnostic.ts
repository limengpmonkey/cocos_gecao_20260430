// AnimationDiagnostic.ts
import { _decorator, Component, Animation, Sprite } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('AnimationDiagnostic')
export class AnimationDiagnostic extends Component {
    onLoad() {
        console.log('=== 动画诊断开始 ===');
        
        const anim = this.getComponent(Animation);
        const sprite = this.getComponent(Sprite);
        
        if (!anim) {
            console.error('❌ 没有Animation组件');
            return;
        }
        
        if (!sprite) {
            console.error('❌ 没有Sprite组件');
            return;
        }
        
        console.log('✅ 找到Animation和Sprite组件');
        console.log('📁 Sprite当前帧:', sprite.spriteFrame ? sprite.spriteFrame.name : '无');
        console.log('🎬 动画剪辑数:', anim.clips.length);
        
        // 检查每个动画剪辑
        anim.clips.forEach((clip, index) => {
            console.log(`  剪辑${index}: ${clip.name}`, {
                时长: clip.duration,
                帧数: clip.keys.length
            });
        });
        
        // 尝试播放
        if (anim.defaultClip) {
            console.log('🚀 尝试播放默认剪辑:', anim.defaultClip.name);
            
            // 监听动画事件
            anim.on(Animation.EventType.PLAY, () => {
                console.log('▶️ 动画开始播放');
            });
            
            anim.on(Animation.EventType.STOP, () => {
                console.log('⏹️ 动画停止');
            });
            
            anim.on(Animation.EventType.FINISHED, () => {
                console.log('✅ 动画播放完成');
            });
            
            // 立即播放
            anim.play(anim.defaultClip.name);
            
            // 监控状态
            this.schedule(() => {
                const state = anim.getState(anim.defaultClip.name);
                if (state) {
                    console.log('⏱️ 动画状态:', {
                        播放中: state.isPlaying,
                        暂停: state.isPaused,
                        速度: state.speed,
                        时间: state.time.toFixed(2)
                    });
                    
                    // 检查Sprite当前帧
                    console.log('🖼️ Sprite当前帧:', sprite.spriteFrame ? sprite.spriteFrame.name : '无');
                }
            }, 0.5); // 每0.5秒输出一次
        }
    }
}