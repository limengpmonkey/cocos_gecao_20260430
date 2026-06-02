import { BlockInputEvents, Canvas, Color, Component, Graphics, Label, Layers, Node, Prefab, UITransform, UIOpacity, Widget, _decorator, director, instantiate, resources, tween, view } from 'cc';

const { ccclass } = _decorator;

@ccclass('SceneTransition')
export class SceneTransition extends Component {
    private static readonly OVERLAY_PREFAB_PATH = 'ui/SceneTransitionOverlay';
    private static _inst: SceneTransition | null = null;
    private static _preloadedScenes: Set<string> = new Set();
    private static _preloadingScenes: Set<string> = new Set();
    private static _pendingPreloadCallbacks: Map<string, Array<(success: boolean) => void>> = new Map();

    private _overlay: Node | null = null;
    private _background: Node | null = null;
    private _overlayOpacity: UIOpacity | null = null;
    private _messageLabel: Label | null = null;
    private _animationAnchor: Node | null = null;
    private _isTransitioning = false;
    private _isOverlayLoading = false;
    private _pendingTransition: { sceneName: string; message: string; minDuration: number } | null = null;

    public static loadScene(sceneName: string, message: string = '加载中...', minDuration: number = 0.5): void {
        if (!sceneName) {
            return;
        }

        const inst = this.ensureInstance();
        inst.requestSceneTransition(sceneName, message, minDuration);
    }

    public static preloadScene(sceneName: string): void {
        if (!sceneName) {
            return;
        }

        this.requestScenePreload(sceneName);
    }

    private static ensureInstance(): SceneTransition {
        if (this._inst && this._inst.isValid) {
            return this._inst;
        }

        const root = new Node('SceneTransitionRoot');
        root.layer = Layers.Enum.UI_2D;
        const canvas = root.addComponent(Canvas);
        canvas.alignCanvasWithScreen = true;

        const rootTransform = root.addComponent(UITransform);
        const rootWidget = root.addComponent(Widget);
        rootWidget.isAlignTop = true;
        rootWidget.isAlignBottom = true;
        rootWidget.isAlignLeft = true;
        rootWidget.isAlignRight = true;
        rootWidget.top = 0;
        rootWidget.bottom = 0;
        rootWidget.left = 0;
        rootWidget.right = 0;

        const visibleSize = view.getVisibleSize();
        rootTransform.setContentSize(visibleSize.width, visibleSize.height);
        root.setPosition(visibleSize.width * 0.5, visibleSize.height * 0.5, 0);

        const transition = root.addComponent(SceneTransition);
        director.addPersistRootNode(root);
        this._inst = transition;
        return transition;
    }

    onLoad(): void {
        SceneTransition._inst = this;
        this.node.active = false;
        this.initializeOverlay();
    }

    onDestroy(): void {
        if (SceneTransition._inst === this) {
            SceneTransition._inst = null;
        }
    }

    public getAnimationAnchor(): Node | null {
        return this._animationAnchor && this._animationAnchor.isValid ? this._animationAnchor : null;
    }

    private requestSceneTransition(sceneName: string, message: string, minDuration: number): void {
        if (this._overlay && this._overlayOpacity && this._messageLabel) {
            this.beginSceneTransition(sceneName, message, minDuration);
            return;
        }

        this._pendingTransition = { sceneName, message, minDuration };
        this.initializeOverlay();
    }

    private initializeOverlay(): void {
        if (this._overlay || this._isOverlayLoading) {
            return;
        }

        this._isOverlayLoading = true;
        resources.load(SceneTransition.OVERLAY_PREFAB_PATH, Prefab, (error, prefab) => {
            this._isOverlayLoading = false;
            if (!this.isValid) {
                return;
            }

            if (error || !prefab) {
                this.buildFallbackOverlay();
            } else {
                this.buildOverlayFromPrefab(prefab);
            }

            this.refreshOverlaySize();
            this.tryStartPendingTransition();
        });
    }

    private buildOverlayFromPrefab(prefab: Prefab): void {
        const overlay = instantiate(prefab);
        overlay.name = 'Overlay';
        this.applyLayerRecursively(overlay, Layers.Enum.UI_2D);
        overlay.setPosition(0, 0, 0);
        this.node.addChild(overlay);

        this.bindOverlayReferences(overlay);
        if (!this._overlay || !this._messageLabel || !this._background) {
            overlay.destroy();
            this.buildFallbackOverlay();
        }
    }

    private buildFallbackOverlay(): void {
        const overlay = new Node('Overlay');
        overlay.layer = Layers.Enum.UI_2D;
        const overlayTransform = overlay.addComponent(UITransform);
        overlayTransform.setAnchorPoint(0.5, 0.5);
        const widget = overlay.addComponent(Widget);
        widget.isAlignTop = true;
        widget.isAlignBottom = true;
        widget.isAlignLeft = true;
        widget.isAlignRight = true;
        widget.top = 0;
        widget.bottom = 0;
        widget.left = 0;
        widget.right = 0;
        overlay.addComponent(BlockInputEvents);
        overlay.addComponent(UIOpacity).opacity = 0;

        const background = new Node('Background');
        background.layer = Layers.Enum.UI_2D;
        const backgroundTransform = background.addComponent(UITransform);
        backgroundTransform.setAnchorPoint(0.5, 0.5);
        const backgroundWidget = background.addComponent(Widget);
        backgroundWidget.isAlignTop = true;
        backgroundWidget.isAlignBottom = true;
        backgroundWidget.isAlignLeft = true;
        backgroundWidget.isAlignRight = true;
        backgroundWidget.top = 0;
        backgroundWidget.bottom = 0;
        backgroundWidget.left = 0;
        backgroundWidget.right = 0;
        background.addComponent(Graphics);
        overlay.addChild(background);

        const animationAnchor = new Node('AnimationAnchor');
        animationAnchor.layer = Layers.Enum.UI_2D;
        const anchorTransform = animationAnchor.addComponent(UITransform);
        anchorTransform.setContentSize(240, 240);
        const anchorWidget = animationAnchor.addComponent(Widget);
        anchorWidget.isAlignHorizontalCenter = true;
        anchorWidget.isAlignVerticalCenter = true;
        anchorWidget.horizontalCenter = 0;
        anchorWidget.verticalCenter = 96;
        overlay.addChild(animationAnchor);

        const labelNode = new Node('Message');
        labelNode.layer = Layers.Enum.UI_2D;
        const labelTransform = labelNode.addComponent(UITransform);
        labelTransform.setContentSize(360, 40);
        const labelWidget = labelNode.addComponent(Widget);
        labelWidget.isAlignHorizontalCenter = true;
        labelWidget.isAlignVerticalCenter = true;
        labelWidget.horizontalCenter = 0;
        labelWidget.verticalCenter = -18;
        const label = labelNode.addComponent(Label);
        label.string = '加载中...';
        label.fontSize = 26;
        label.lineHeight = 30;
        label.color = new Color(245, 241, 228, 255);
        overlay.addChild(labelNode);

        this.node.addChild(overlay);
        this.bindOverlayReferences(overlay);
    }

    private bindOverlayReferences(overlay: Node): void {
        this._overlay = overlay;
        this._background = overlay.getChildByName('Background');
        this._animationAnchor = overlay.getChildByName('AnimationAnchor');
        this._messageLabel = overlay.getChildByName('Message')?.getComponent(Label) ?? null;
        this._overlayOpacity = overlay.getComponent(UIOpacity) ?? overlay.addComponent(UIOpacity);
        this._overlayOpacity.opacity = 0;

        if (!overlay.getComponent(BlockInputEvents)) {
            overlay.addComponent(BlockInputEvents);
        }

        const overlayTransform = overlay.getComponent(UITransform) ?? overlay.addComponent(UITransform);
        overlayTransform.setAnchorPoint(0.5, 0.5);

        const overlayWidget = overlay.getComponent(Widget) ?? overlay.addComponent(Widget);
        overlayWidget.isAlignTop = true;
        overlayWidget.isAlignBottom = true;
        overlayWidget.isAlignLeft = true;
        overlayWidget.isAlignRight = true;
        overlayWidget.top = 0;
        overlayWidget.bottom = 0;
        overlayWidget.left = 0;
        overlayWidget.right = 0;

        if (this._background) {
            const backgroundTransform = this._background.getComponent(UITransform) ?? this._background.addComponent(UITransform);
            backgroundTransform.setAnchorPoint(0.5, 0.5);
            const backgroundWidget = this._background.getComponent(Widget) ?? this._background.addComponent(Widget);
            backgroundWidget.isAlignTop = true;
            backgroundWidget.isAlignBottom = true;
            backgroundWidget.isAlignLeft = true;
            backgroundWidget.isAlignRight = true;
            backgroundWidget.top = 0;
            backgroundWidget.bottom = 0;
            backgroundWidget.left = 0;
            backgroundWidget.right = 0;
        }
    }

    private tryStartPendingTransition(): void {
        if (!this._pendingTransition || !this._overlay || !this._overlayOpacity || !this._messageLabel) {
            return;
        }

        const pending = this._pendingTransition;
        this._pendingTransition = null;
        this.beginSceneTransition(pending.sceneName, pending.message, pending.minDuration);
    }

    private applyLayerRecursively(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) {
            this.applyLayerRecursively(child, layer);
        }
    }

    private beginSceneTransition(sceneName: string, message: string, minDuration: number): void {
        if (this._isTransitioning || !this._overlay || !this._overlayOpacity || !this._messageLabel) {
            return;
        }

        this._isTransitioning = true;
        this.refreshOverlaySize();
        this._messageLabel.string = message;
        this.node.active = true;
        this._overlayOpacity.opacity = 0;

        tween(this._overlayOpacity)
            .stop();
        tween(this._overlayOpacity)
            .to(0.18, { opacity: 255 })
            .call(() => this.preloadAndSwitchScene(sceneName, Math.max(0, minDuration), Date.now()))
            .start();
    }

    private preloadAndSwitchScene(sceneName: string, minDuration: number, startedAt: number): void {
        // 后台预热继续进行，但切场景本身不再强制等待 preload 完成，
        // 避免把首次冷加载完整串行暴露出来，导致比直接 loadScene 体感更慢。
        SceneTransition.requestScenePreload(sceneName);

        const elapsed = (Date.now() - startedAt) / 1000;
        const waitTime = Math.max(0, minDuration - elapsed);
        this.scheduleOnce(() => this.loadPreparedScene(sceneName), waitTime);
    }

    private loadPreparedScene(sceneName: string): void {
        const directorAny = director as any;
        directorAny.loadScene(sceneName, (loadError: Error | null) => {
            if (loadError) {
                this.finishSceneTransition();
                return;
            }

            this.scheduleOnce(() => {
                if (!this._overlayOpacity) {
                    this.finishSceneTransition();
                    return;
                }

                tween(this._overlayOpacity)
                    .to(0.22, { opacity: 0 })
                    .call(() => this.finishSceneTransition())
                    .start();
            }, 0.08);
        });
    }

    private finishSceneTransition(): void {
        this._isTransitioning = false;
        this.node.active = false;
    }

    private refreshOverlaySize(): void {
        if (!this._overlay || !this._background) {
            return;
        }

        const visibleSize = view.getVisibleSize();
        const rootTransform = this.node.getComponent(UITransform);
        rootTransform?.setContentSize(visibleSize.width, visibleSize.height);
        this.node.setPosition(visibleSize.width * 0.5, visibleSize.height * 0.5, 0);

        const overlayTransform = this._overlay.getComponent(UITransform);
        overlayTransform?.setContentSize(visibleSize.width, visibleSize.height);
        this._overlay.setPosition(0, 0, 0);

        const backgroundTransform = this._background.getComponent(UITransform);
        backgroundTransform?.setContentSize(visibleSize.width, visibleSize.height);

        const graphics = this._background.getComponent(Graphics) ?? this._background.addComponent(Graphics);
        if (graphics) {
            graphics.clear();
            graphics.fillColor = new Color(8, 10, 18, 255);
            graphics.rect(-visibleSize.width * 0.5, -visibleSize.height * 0.5, visibleSize.width, visibleSize.height);
            graphics.fill();
        }
    }

    private static requestScenePreload(sceneName: string, callback?: (success: boolean) => void): void {
        if (this._preloadedScenes.has(sceneName)) {
            callback?.(true);
            return;
        }

        if (callback) {
            const pending = this._pendingPreloadCallbacks.get(sceneName) ?? [];
            pending.push(callback);
            this._pendingPreloadCallbacks.set(sceneName, pending);
        }

        if (this._preloadingScenes.has(sceneName)) {
            return;
        }

        this._preloadingScenes.add(sceneName);
        const directorAny = director as any;
        directorAny.preloadScene(sceneName, null, (preloadError: Error | null) => {
            const success = !preloadError;
            if (success) {
                this._preloadedScenes.add(sceneName);
            }

            this._preloadingScenes.delete(sceneName);
            const callbacks = this._pendingPreloadCallbacks.get(sceneName) ?? [];
            this._pendingPreloadCallbacks.delete(sceneName);
            for (const pendingCallback of callbacks) {
                pendingCallback(success);
            }
        });
    }
}