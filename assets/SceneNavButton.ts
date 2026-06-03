import { _decorator, Button, Color, Component, director, Graphics, instantiate, Label, Layout, Node, Prefab, Sprite, SpriteFrame, UITransform, Vec3, Widget, warn } from 'cc';
import { CollectionEntrySnapshot, CollectionSystem } from './demos/bulletHell/CollectionSystem';
import { CollectionDetailPanel } from './CollectionDetailPanel';
import { ManagerScene } from './main';
import { SceneTransition } from './SceneTransition';

const { ccclass, property } = _decorator;

type CollectionFilterKey = 'all' | 'common' | 'boss' | 'rare' | 'locked';

interface ExistingCollectionFilterButton {
    key: CollectionFilterKey;
    node: Node;
    label: Label | null;
    sprite: Sprite | null;
}

@ccclass('CollectionCardVisualBinding')
class CollectionCardVisualBinding {
    @property({ tooltip: '图鉴 ID，例如 ghost、stage1_can_champion' })
    collectionId: string = '';

    @property({ type: SpriteFrame, tooltip: '列表卡片小图标' })
    cardIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '卡片预览区域图片' })
    previewFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '详情页图标' })
    detailIcon: SpriteFrame | null = null;

    @property({ type: Prefab, tooltip: '详情页图标位展示用动画 prefab；配置后会优先显示该 prefab。' })
    detailDisplayPrefab: Prefab | null = null;
}

@ccclass('SceneNavButton')
export class SceneNavButton extends Component {
    private _collectionInitialized = false;
    private _existingCollectionBound = false;
    private _collectionRoot: Node | null = null;
    private _collectionList: Node | null = null;
    private _summaryLabel: Label | null = null;
    private _detailTitle: Label | null = null;
    private _detailStatus: Label | null = null;
    private _detailDescription: Label | null = null;
    private _detailStrategy: Label | null = null;
    private _detailIcon: Label | null = null;
    private _selectedCollectionId = '';
    private _collectionFilter: CollectionFilterKey = 'all';
    private _existingProgressTitleLabel: Label | null = null;
    private _existingProgressValueLabel: Label | null = null;
    private _existingSelectedContainer: Node | null = null;
    private _existingScrollViewNode: Node | null = null;
    private _existingScrollViewViewNode: Node | null = null;
    private _existingContentNode: Node | null = null;
    private _existingItemTemplate: Node | null = null;
    private _existingFilterButtons: ExistingCollectionFilterButton[] = [];
    private _detailPanelNode: Node | null = null;
    private _detailPanelBinding: CollectionDetailPanel | null = null;
    private _detailIconSprite: Sprite | null = null;
    private _detailDisplayHost: Node | null = null;
    private _detailDisplayInstance: Node | null = null;

    @property
    homeSceneName: string = 'home';

    @property
    collectionSceneName: string = 'collection';

    @property
    gameSceneName: string = 'game';

    @property({ tooltip: '仅在明确需要时才启用运行时重建 collection UI；默认关闭以保留 scene 原始内容。' })
    enableCollectionRuntimeBootstrap: boolean = false;

    @property({ tooltip: '测试用：进入 collection 场景时先清空收集存档。' })
    debugResetCollectionOnStart: boolean = false;

    @property({ tooltip: '测试用：进入 collection 场景时直接解锁全部图鉴。' })
    debugUnlockAllCollectionOnStart: boolean = false;

    @property({ tooltip: '测试用：给指定图鉴 id 设置击杀进度，例如 ghost、snail_tail、ghost_boss。留空则不处理。' })
    debugSetCollectionProgressId: string = 'ghost';

    @property({ tooltip: '测试用：给上面 id 写入的击杀数。达到阈值后会直接显示为已解锁。' })
    debugSetCollectionProgressCount: number = 100;

    @property({
        type: [CollectionCardVisualBinding],
        tooltip: '按 collectionId 配置卡片列表图标、预览图和详情图标'
    })
    collectionCardVisualBindings: CollectionCardVisualBinding[] = [];

    @property({ type: SpriteFrame, tooltip: '未命中图标绑定时使用的默认卡片图标' })
    fallbackCollectionCardIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '未命中图标绑定时使用的默认详情图标' })
    fallbackCollectionDetailIcon: SpriteFrame | null = null;

    @property({ type: Prefab, tooltip: '图鉴详情面板 Prefab。配置后将接管详情区域，方便替换和管理。' })
    collectionDetailPanelPrefab: Prefab | null = null;

    start(): void {
        this.prewarmPrimaryScenes();
        this.applyCollectionDebugOverrides();

        if (this.bindExistingCollectionScene()) {
            return;
        }

        if (!this.shouldBootstrapCollectionScene()) {
            return;
        }

        this.buildCollectionSceneRuntime();
    }

    private prewarmPrimaryScenes(): void {
        const sceneName = director.getScene()?.name;
        if (sceneName === this.homeSceneName) {
            SceneTransition.preloadScene(this.gameSceneName);
            return;
        }

        if (sceneName === this.gameSceneName) {
            SceneTransition.preloadScene(this.homeSceneName);
        }
    }

    public goHome(): void {
        const manager = ManagerScene.getInstance();
        if (manager) {
            manager.openHome();
            return;
        }

        warn('[SceneNavButton] ManagerScene not found, fallback to direct load home');
        SceneTransition.loadScene(this.homeSceneName, '返回首页...');
    }

    public goCollection(): void {
        const manager = ManagerScene.getInstance();
        if (manager) {
            manager.openCollection();
            return;
        }

        warn('[SceneNavButton] ManagerScene not found, fallback to direct load collection');
        SceneTransition.loadScene(this.collectionSceneName, '打开图鉴...');
    }

    public goGame(): void {
        const manager = ManagerScene.getInstance();
        if (manager) {
            manager.openGame();
            return;
        }

        warn('[SceneNavButton] ManagerScene not found, fallback to direct load game');
        SceneTransition.loadScene(this.gameSceneName, '进入战斗...');
    }

    private shouldBootstrapCollectionScene(): boolean {
        const scene = director.getScene();
        return this.enableCollectionRuntimeBootstrap && !!scene && scene.name === this.collectionSceneName && this.node.name === 'main';
    }

    private isCollectionSceneMain(): boolean {
        const scene = director.getScene();
        return !!scene && scene.name === this.collectionSceneName && this.node.name === 'main';
    }

    private applyCollectionDebugOverrides(): void {
        if (!this.isCollectionSceneMain()) {
            return;
        }

        if (this.debugResetCollectionOnStart) {
            CollectionSystem.debugResetAll();
        }

        if (this.debugUnlockAllCollectionOnStart) {
            CollectionSystem.debugUnlockAll();
        }

        const id = this.debugSetCollectionProgressId.trim();
        if (id) {
            CollectionSystem.debugSetProgress(id, this.debugSetCollectionProgressCount);
        }
    }

    private bindExistingCollectionScene(): boolean {
        if (!this.isCollectionSceneMain()) {
            return false;
        }

        if (this._existingCollectionBound) {
            this.refreshExistingCollectionView();
            return true;
        }

        const header = this.findNodeByName(this.node, 'headercontainer');
        const selectedContainer = this.findNodeByName(this.node, 'selectedcontainer');
        const cardsContainer = this.findNodeByName(this.node, 'cardscontainer');
        const scrollViewNode = cardsContainer ? this.findNodeByName(cardsContainer, 'ScrollView') : null;
        const viewNode = scrollViewNode ? this.findNodeByName(scrollViewNode, 'view') : null;
        const contentNode = cardsContainer ? this.findNodeByName(cardsContainer, 'content') : null;
        const itemTemplate = contentNode ? this.findNodeByName(contentNode, 'item') : null;

        if (!header || !selectedContainer || !cardsContainer || !scrollViewNode || !viewNode || !contentNode || !itemTemplate) {
            return false;
        }

        this._existingCollectionBound = true;
        this._existingSelectedContainer = selectedContainer;
        this._existingScrollViewNode = scrollViewNode;
        this._existingScrollViewViewNode = viewNode;
        this._existingContentNode = contentNode;
        this._existingItemTemplate = itemTemplate;
        this._existingItemTemplate.active = false;

        this.configureExistingCollectionGridLayout();

        this.bindExistingHeaderButtons(header);
        this.bindExistingProgressLabels();
        this.bindExistingFilterButtons(selectedContainer);
        this.ensureCollectionDetailPanelForExistingScene();
        this.refreshExistingCollectionView();
        return true;
    }

    private configureExistingCollectionGridLayout(): void {
        if (!this._existingScrollViewNode || !this._existingScrollViewViewNode || !this._existingContentNode || !this._existingItemTemplate) {
            return;
        }

        const scrollTransform = this._existingScrollViewNode.getComponent(UITransform);
        const viewTransform = this._existingScrollViewViewNode.getComponent(UITransform);
        const contentTransform = this._existingContentNode.getComponent(UITransform);
        const itemTransform = this._existingItemTemplate.getComponent(UITransform);
        const usableWidth = Math.max(680, (scrollTransform?.contentSize.width ?? 720) - 28);

        if (viewTransform) {
            viewTransform.setContentSize(usableWidth, viewTransform.contentSize.height);
        }

        if (contentTransform) {
            contentTransform.setContentSize(usableWidth, contentTransform.contentSize.height);
        }

        if (itemTransform) {
            itemTransform.setContentSize(320, 136);
            itemTransform.setAnchorPoint(0.5, 0.5);
        }

        const contentLayout = this._existingContentNode.getComponent(Layout) ?? this._existingContentNode.addComponent(Layout);
        contentLayout.type = Layout.Type.GRID;
        contentLayout.resizeMode = Layout.ResizeMode.CONTAINER;
        contentLayout.constraint = Layout.Constraint.FIXED_COL;
        contentLayout.constraintNum = 2;
        contentLayout.cellSize.set(320, 136);
        contentLayout.startAxis = Layout.AxisDirection.HORIZONTAL;
        contentLayout.spacingX = 18;
        contentLayout.spacingY = 18;
        contentLayout.paddingTop = 12;
        contentLayout.paddingBottom = 24;
        contentLayout.paddingLeft = 12;
        contentLayout.paddingRight = 12;
    }

    private bindExistingHeaderButtons(header: Node): void {
        const backButtonNode = header.getChildByName('returnbutton') ?? header.getChildByName('Button');
        const settingButtonNode = header.getChildByName('playbutton') ?? header.getChildByName('settingbutton');

        if (backButtonNode) {
            const label = this.findLabelInNode(backButtonNode);
            if (label) {
                label.string = '返回';
            }
            backButtonNode.off(Node.EventType.TOUCH_END);
            backButtonNode.on(Node.EventType.TOUCH_END, () => this.goHome(), this);
        }

        if (settingButtonNode) {
            const label = this.findLabelInNode(settingButtonNode);
            if (label) {
                label.string = '狩猎';
            }
            settingButtonNode.off(Node.EventType.TOUCH_END);
            settingButtonNode.on(Node.EventType.TOUCH_END, () => this.goGame(), this);
        }

        this.ensureExistingCollectionResetButton(header);
    }

    private ensureExistingCollectionResetButton(header: Node): void {
        let resetButtonNode = header.getChildByName('CollectionResetButton');
        if (!resetButtonNode) {
            resetButtonNode = new Node('CollectionResetButton');
            resetButtonNode.layer = header.layer;
            resetButtonNode.setPosition(228, 0, 0);
            resetButtonNode.addComponent(UITransform).setContentSize(132, 42);
            const graphics = resetButtonNode.addComponent(Graphics);
            graphics.fillColor = this.colorFromHex('#6f2f2f');
            graphics.strokeColor = this.colorFromHex('#ff9e7a');
            graphics.lineWidth = 2;
            graphics.roundRect(-66, -21, 132, 42, 12);
            graphics.fill();
            graphics.stroke();

            const label = this.createLabel(resetButtonNode, 'CollectionResetLabel', '清空图鉴', 18, '#fff4df', new Vec3(0, 0, 0), 132, 24, 0.5, 0.5);
            label.enableWrapText = false;
            header.addChild(resetButtonNode);
        }

        resetButtonNode.off(Node.EventType.TOUCH_END);
        resetButtonNode.on(Node.EventType.TOUCH_END, () => this.resetCollectionProgress(), this);
    }

    private bindExistingProgressLabels(): void {
        const allLabels = this.node.getComponentsInChildren(Label);
        this._existingProgressTitleLabel = allLabels.find(label => label.string.includes('收集进度')) ?? null;
        this._existingProgressValueLabel = allLabels.find(label => /%$/.test(label.string.trim())) ?? null;
    }

    private bindExistingFilterButtons(selectedContainer: Node): void {
        const filterConfigs: Array<{ name: string; key: CollectionFilterKey; label: string }> = [
            { name: 'Button-004', key: 'all', label: '全部' },
            { name: 'Button-001', key: 'common', label: '小怪' },
            { name: 'Button', key: 'boss', label: 'Boss' },
            { name: 'Button-002', key: 'rare', label: '稀有' },
            { name: 'Button-003', key: 'locked', label: '未解锁' },
        ];

        this._existingFilterButtons = [];
        for (const config of filterConfigs) {
            const node = selectedContainer.getChildByName(config.name);
            if (!node) {
                continue;
            }

            const label = this.findLabelInNode(node);
            if (label) {
                label.string = config.label;
            }

            node.off(Node.EventType.TOUCH_END);
            node.on(Node.EventType.TOUCH_END, () => {
                this._collectionFilter = config.key;
                this.refreshExistingCollectionView();
            }, this);

            this._existingFilterButtons.push({
                key: config.key,
                node,
                label,
                sprite: node.getComponent(Sprite),
            });
        }
    }

    private refreshExistingCollectionView(): void {
        if (!this._existingContentNode || !this._existingItemTemplate) {
            return;
        }

        const entries = this.getFilteredCollectionEntries();
        if (entries.length <= 0) {
            this.setDetailPanelVisibility(false);
            return;
        }

        if (!entries.some(entry => entry.definition.id === this._selectedCollectionId)) {
            this._selectedCollectionId = '';
        }

        for (const child of [...this._existingContentNode.children]) {
            if (child !== this._existingItemTemplate) {
                child.destroy();
            }
        }

        for (const entry of entries) {
            const itemNode = instantiate(this._existingItemTemplate);
            itemNode.active = true;
            itemNode.name = `CollectionItem-${entry.definition.id}`;

            const transform = itemNode.getComponent(UITransform);
            if (transform) {
                transform.setContentSize(320, 136);
                transform.setAnchorPoint(0.5, 0.5);
            }

            this.renderCollectionImageCard(itemNode, entry, entry.definition.id === this._selectedCollectionId);

            const button = itemNode.getComponent(Button) ?? itemNode.addComponent(Button);
            button.zoomScale = 1.03;
            itemNode.off(Node.EventType.TOUCH_END);
            itemNode.on(Node.EventType.TOUCH_END, () => {
                console.log('[SceneNavButton] 点击图鉴卡片(现有场景)', entry.definition.id, entry.definition.name);
                this._selectedCollectionId = entry.definition.id;
                CollectionSystem.markSeen(entry.definition.id);
                this.refreshExistingCollectionView();
            }, this);

            this._existingContentNode.addChild(itemNode);
        }

        this.refreshExistingProgressLabels(entries);
        this.refreshExistingFilterButtonStyles();

        const selected = entries.find(entry => entry.definition.id === this._selectedCollectionId) ?? null;
        if (!selected) {
            this.setDetailPanelVisibility(false);
            return;
        }

        this.updateDetailPanel(selected);
    }

    private getFilteredCollectionEntries(): CollectionEntrySnapshot[] {
        const entries = CollectionSystem.getAllSnapshots();
        switch (this._collectionFilter) {
            case 'common':
                return entries.filter(entry => entry.definition.rarity === 'common');
            case 'boss':
                return entries.filter(entry => entry.definition.rarity === 'boss');
            case 'rare':
                return entries.filter(entry => entry.definition.rarity === 'rare');
            case 'locked':
                return entries.filter(entry => !entry.unlocked);
            case 'all':
            default:
                return entries;
        }
    }

    private refreshExistingProgressLabels(entries: CollectionEntrySnapshot[]): void {
        const overview = CollectionSystem.getOverview();
        const percent = overview.totalCount > 0 ? Math.round((overview.unlockedCount / overview.totalCount) * 100) : 0;

        if (this._existingProgressTitleLabel) {
            this._existingProgressTitleLabel.string = `总收集进度：${overview.unlockedCount}/${overview.totalCount}`;
        }

        if (this._existingProgressValueLabel) {
            this._existingProgressValueLabel.string = `${percent}%`;
        }
    }

    private refreshExistingFilterButtonStyles(): void {
        for (const filterButton of this._existingFilterButtons) {
            const active = filterButton.key === this._collectionFilter;
            if (filterButton.sprite) {
                filterButton.sprite.color = active ? this.colorFromHex('#ffd36e') : this.colorFromHex('#ffffff');
            }
            if (filterButton.label) {
                filterButton.label.color = this.colorFromHex(active ? '#50390b' : '#202020');
            }
        }
    }

    private ensureCollectionDetailPanelForExistingScene(): void {
        if (!this._existingSelectedContainer || this._detailPanelBinding || this._detailTitle) {
            return;
        }

        const hostParent = this.node.parent ?? this.node;
        const host = new Node('CollectionDetailPanelHost');
        host.layer = hostParent.layer;
        const hostTransform = host.addComponent(UITransform);
        const parentTransform = hostParent.getComponent(UITransform);
        hostTransform.setContentSize(parentTransform?.contentSize.width ?? 720, parentTransform?.contentSize.height ?? 1280);
        const hostWidget = host.addComponent(Widget);
        hostWidget.isAlignTop = true;
        hostWidget.isAlignBottom = true;
        hostWidget.isAlignLeft = true;
        hostWidget.isAlignRight = true;
        hostWidget.top = 0;
        hostWidget.bottom = 0;
        hostWidget.left = 0;
        hostWidget.right = 0;
        host.setPosition(0, 0, 0);
        hostParent.addChild(host);
        this.bringNodeToFront(host);

        const panelAnchor = new Node('CollectionDetailPanelAnchor');
        panelAnchor.layer = host.layer;
        panelAnchor.addComponent(UITransform).setContentSize(680, 520);
        panelAnchor.setPosition(0, -40, 0);
        host.addChild(panelAnchor);

        const detailNode = this.instantiateCollectionDetailPanelPrefab(panelAnchor.layer);
        if (detailNode) {
            panelAnchor.addChild(detailNode);
            detailNode.setPosition(0, 0, 0);

            this._detailPanelNode = detailNode;
            this._detailPanelBinding = this.prepareCollectionDetailPanel(detailNode);
            this._detailPanelBinding?.bindActions(
                () => this.goHome(),
                () => this.goGame(),
                () => this.resetCollectionProgress(),
                this,
            );
            this.setDetailPanelVisibility(false);
            return;
        }

        this.buildExistingCollectionFallbackDetailPanel(panelAnchor);
        this.setDetailPanelVisibility(false);
    }

    private instantiateCollectionDetailPanelPrefab(layer: number): Node | null {
        if (!this.collectionDetailPanelPrefab) {
            return null;
        }

        try {
            const detailNode = instantiate(this.collectionDetailPanelPrefab);
            this.applyLayerRecursively(detailNode, layer);
            console.log('[SceneNavButton] 图鉴详情 prefab 实例化成功', detailNode.name, this.collectionDetailPanelPrefab.name);
            return detailNode;
        } catch (error) {
            console.warn('[SceneNavButton] 图鉴详情 prefab 实例化失败，已回退内置详情面板', error);
            return null;
        }
    }

    private buildExistingCollectionFallbackDetailPanel(parent: Node): void {
        const detailPanel = this.createPanel(parent, 'DetailPanel', 660, 468, 0, 0, '#1f2732', '#ffcf70');
        const detailDisplayHost = new Node('DetailDisplayHost');
        detailDisplayHost.layer = detailPanel.layer;
        detailDisplayHost.setPosition(-248, 170, 0);
        detailDisplayHost.addComponent(UITransform).setContentSize(120, 120);
        detailPanel.addChild(detailDisplayHost);
        this._detailDisplayHost = detailDisplayHost;

        const detailIconNode = new Node('DetailIconSprite');
        detailIconNode.setPosition(-248, 170, 1);
        detailIconNode.addComponent(UITransform).setContentSize(88, 88);
        this._detailIconSprite = detailIconNode.addComponent(Sprite);
        this._detailIconSprite.node.active = false;
        detailPanel.addChild(detailIconNode);
        this._detailIcon = this.createLabel(detailPanel, 'DetailIcon', '--', 38, '#ffcf70', new Vec3(-248, 170, 1), 96, 72);
        this._detailTitle = this.createLabel(detailPanel, 'DetailTitle', '', 30, '#fff6d8', new Vec3(-220, 176, 0), 470, 40);
        this._detailStatus = this.createLabel(detailPanel, 'DetailStatus', '', 16, '#8fd7d8', new Vec3(-220, 136, 0), 470, 26);
        this._detailDescription = this.createLabel(detailPanel, 'DetailDescription', '', 18, '#d5dde4', new Vec3(-300, 84, 0), 600, 176);
        this._detailStrategy = this.createLabel(detailPanel, 'DetailStrategy', '', 16, '#a5d8c6', new Vec3(-300, -82, 0), 600, 170);

        const homeButton = this.createPanel(detailPanel, 'HomeAction', 180, 54, -108, -184, '#36576a', '#79f2de');
        this.createLabel(homeButton, 'HomeActionLabel', '返回主页', 20, '#f8f4e2', new Vec3(0, 0, 0), 180, 28, 0.5, 0.5);
        homeButton.on(Node.EventType.TOUCH_END, () => this.goHome(), this);

        const gameButton = this.createPanel(detailPanel, 'GameAction', 180, 54, 108, -184, '#725538', '#ffcf70');
        this.createLabel(gameButton, 'GameActionLabel', '开始狩猎', 20, '#fff7df', new Vec3(0, 0, 0), 180, 28, 0.5, 0.5);
        gameButton.on(Node.EventType.TOUCH_END, () => this.goGame(), this);

        const resetButton = this.createPanel(detailPanel, 'ResetCollectionAction', 180, 48, 0, -246, '#6f2f2f', '#ff9e7a');
        this.createLabel(resetButton, 'ResetCollectionActionLabel', '清空图鉴', 18, '#fff4df', new Vec3(0, 0, 0), 180, 24, 0.5, 0.5);
        resetButton.on(Node.EventType.TOUCH_END, () => this.resetCollectionProgress(), this);
    }

    private prepareCollectionDetailPanel(detailNode: Node): CollectionDetailPanel | null {
        const contentNode = this.resolveDetailPanelContentNode(detailNode);
        const iconLabelNode = this.findNodeByName(contentNode, 'DetailIconLabel');
        const titleNode = this.findNodeByName(contentNode, 'DetailTitle');
        const statusNode = this.findNodeByName(contentNode, 'DetailStatus');
        const descriptionNode = this.findNodeByName(contentNode, 'DetailDescription');
        const strategyNode = this.findNodeByName(contentNode, 'DetailStrategy');
        const binding = this.findDetailPanelBinding(detailNode, contentNode);
        binding.iconDisplayHost = binding.iconDisplayHost ?? this.findNodeByName(contentNode, 'DetailDisplayHost');
        binding.iconSprite = binding.iconSprite ?? this.findNodeByName(contentNode, 'DetailIconSprite')?.getComponent(Sprite) ?? null;
        binding.iconLabel = binding.iconLabel ?? (iconLabelNode ? this.findLabelInNode(iconLabelNode) : null);
        binding.titleLabel = binding.titleLabel ?? (titleNode ? this.findLabelInNode(titleNode) : null);
        binding.statusLabel = binding.statusLabel ?? (statusNode ? this.findLabelInNode(statusNode) : null);
        binding.descriptionLabel = binding.descriptionLabel ?? (descriptionNode ? this.findLabelInNode(descriptionNode) : null);
        binding.strategyLabel = binding.strategyLabel ?? (strategyNode ? this.findLabelInNode(strategyNode) : null);
        binding.homeButton = binding.homeButton ?? this.findNodeByName(contentNode, 'HomeAction');
        binding.gameButton = binding.gameButton ?? this.findNodeByName(contentNode, 'GameAction');
        binding.resetButton = binding.resetButton ?? this.findNodeByName(contentNode, 'ResetCollectionAction');

        this.hydrateCollectionDetailPanel(binding, binding.node);
        this._detailDisplayHost = binding.iconDisplayHost;
        console.log('[SceneNavButton] 图鉴详情面板已绑定', {
            root: detailNode.name,
            content: contentNode.name,
            bindingNode: binding.node.name,
            hasNamedTitleNode: !!titleNode,
            hasNamedDescriptionNode: !!descriptionNode,
            hasIconSprite: !!binding.iconSprite,
            hasTitle: !!binding.titleLabel,
            hasDescription: !!binding.descriptionLabel,
        });
        return binding;
    }

    private findDetailPanelBinding(detailNode: Node, contentNode: Node): CollectionDetailPanel {
        const existingBinding = detailNode.getComponent(CollectionDetailPanel)
            ?? detailNode.getComponentInChildren(CollectionDetailPanel)
            ?? contentNode.getComponent(CollectionDetailPanel)
            ?? contentNode.getComponentInChildren(CollectionDetailPanel);

        if (existingBinding) {
            return existingBinding;
        }

        return contentNode.addComponent(CollectionDetailPanel);
    }

    private resolveDetailPanelContentNode(detailNode: Node): Node {
        const canvasNode = detailNode.getChildByName('Canvas');
        if (!canvasNode) {
            return detailNode;
        }

        detailNode.setPosition(0, 0, 0);
        const detailTransform = detailNode.getComponent(UITransform) ?? detailNode.addComponent(UITransform);
        detailTransform.setContentSize(660, 468);

        canvasNode.setPosition(0, 0, 0);
        const canvasTransform = canvasNode.getComponent(UITransform) ?? canvasNode.addComponent(UITransform);
        canvasTransform.setContentSize(660, 468);

        const cameraNode = canvasNode.getChildByName('Camera');
        if (cameraNode) {
            cameraNode.active = false;
        }

        console.log('[SceneNavButton] 检测到内嵌 Canvas 详情 prefab，已规范化到详情容器', detailNode.name);
        return canvasNode;
    }

    private hydrateCollectionDetailPanel(binding: CollectionDetailPanel, detailNode: Node): void {
        const rootTransform = detailNode.getComponent(UITransform) ?? detailNode.addComponent(UITransform);
        rootTransform.setContentSize(660, 468);

        if (detailNode.children.length === 0) {
            const background = new Node('PanelBg');
            background.layer = detailNode.layer;
            background.addComponent(UITransform).setContentSize(660, 468);
            const backgroundSprite = background.addComponent(Sprite);
            backgroundSprite.color = this.colorFromHex('#1f2732');
            detailNode.addChild(background);
        }

        if (!binding.iconSprite && !binding.iconLabel) {
            const iconSpriteNode = new Node('DetailIconSprite');
            iconSpriteNode.layer = detailNode.layer;
            iconSpriteNode.setPosition(-248, 170, 0);
            iconSpriteNode.addComponent(UITransform).setContentSize(88, 88);
            binding.iconSprite = iconSpriteNode.addComponent(Sprite);
            binding.iconSprite.node.active = false;
            detailNode.addChild(iconSpriteNode);

            const iconLabel = this.createLabel(detailNode, 'DetailIconLabel', '--', 38, '#ffcf70', new Vec3(-248, 170, 0), 96, 72, 0.5, 0.5);
            iconLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
            iconLabel.verticalAlign = Label.VerticalAlign.CENTER;
            iconLabel.isBold = true;
            binding.iconLabel = iconLabel;
        }

        if (!binding.iconDisplayHost) {
            const displayHost = new Node('DetailDisplayHost');
            displayHost.layer = detailNode.layer;
            displayHost.setPosition(-248, 170, -1);
            displayHost.addComponent(UITransform).setContentSize(120, 120);
            detailNode.addChild(displayHost);
            binding.iconDisplayHost = displayHost;
        }

        if (!binding.titleLabel) {
            binding.titleLabel = this.createLabel(detailNode, 'DetailTitle', '', 30, '#fff6d8', new Vec3(-88, 176, 0), 420, 44, 0, 0.5);
            binding.titleLabel.isBold = true;
        }

        if (!binding.statusLabel) {
            binding.statusLabel = this.createLabel(detailNode, 'DetailStatus', '', 16, '#8fd7d8', new Vec3(-88, 136, 0), 420, 26, 0, 0.5);
        }

        if (!binding.descriptionLabel) {
            const label = this.createLabel(detailNode, 'DetailDescription', '', 18, '#d5dde4', new Vec3(-298, 84, 0), 596, 176);
            label.overflow = Label.Overflow.RESIZE_HEIGHT;
            label.enableWrapText = true;
            binding.descriptionLabel = label;
        }

        if (!binding.strategyLabel) {
            const label = this.createLabel(detailNode, 'DetailStrategy', '', 16, '#a5d8c6', new Vec3(-298, -82, 0), 596, 170);
            label.overflow = Label.Overflow.RESIZE_HEIGHT;
            label.enableWrapText = true;
            binding.strategyLabel = label;
        }

        if (!binding.homeButton) {
            const button = this.createPanel(detailNode, 'HomeAction', 180, 54, -156, -202, '#36576a', '#79f2de');
            this.createLabel(button, 'HomeActionLabel', '返回主页', 20, '#f8f4e2', new Vec3(0, 0, 0), 180, 28, 0.5, 0.5);
            binding.homeButton = button;
        }

        if (!binding.gameButton) {
            const button = this.createPanel(detailNode, 'GameAction', 180, 54, 56, -202, '#725538', '#ffcf70');
            this.createLabel(button, 'GameActionLabel', '开始狩猎', 20, '#fff7df', new Vec3(0, 0, 0), 180, 28, 0.5, 0.5);
            binding.gameButton = button;
        }

        if (!binding.resetButton) {
            const button = this.createPanel(detailNode, 'ResetCollectionAction', 180, 48, -50, -252, '#6f2f2f', '#ff9e7a');
            this.createLabel(button, 'ResetCollectionActionLabel', '清空图鉴', 18, '#fff4df', new Vec3(0, 0, 0), 180, 24, 0.5, 0.5);
            binding.resetButton = button;
        }
    }

    private applyLayerRecursively(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) {
            this.applyLayerRecursively(child, layer);
        }
    }

    private bringNodeToFront(node: Node | null): void {
        if (!node?.parent) {
            return;
        }

        node.setSiblingIndex(node.parent.children.length - 1);
    }

    private getCollectionVisualBinding(collectionId: string): CollectionCardVisualBinding | null {
        const normalizedId = collectionId.trim();
        for (const binding of this.collectionCardVisualBindings) {
            if (binding.collectionId.trim() === normalizedId) {
                return binding;
            }
        }
        return null;
    }

    private getCollectionCardIcon(collectionId: string): SpriteFrame | null {
        return this.getCollectionVisualBinding(collectionId)?.cardIcon ?? this.fallbackCollectionCardIcon;
    }

    private getCollectionDetailIcon(collectionId: string): SpriteFrame | null {
        return this.getCollectionVisualBinding(collectionId)?.detailIcon
            ?? this.getCollectionVisualBinding(collectionId)?.cardIcon
            ?? this.fallbackCollectionDetailIcon
            ?? this.fallbackCollectionCardIcon;
    }

    private getCollectionDetailDisplayPrefab(collectionId: string): Prefab | null {
        return this.getCollectionVisualBinding(collectionId)?.detailDisplayPrefab ?? null;
    }

    private renderCollectionImageCard(itemNode: Node, entry: CollectionEntrySnapshot, selected: boolean): void {
        const uiLayer = itemNode.layer;
        const rootLabel = itemNode.getComponent(Label) ?? this.findLabelInNode(itemNode);
        if (rootLabel) {
            rootLabel.string = '';
            rootLabel.enabled = false;
        }

        for (const child of [...itemNode.children]) {
            child.destroy();
        }

        const backgroundNode = new Node('Background');
        backgroundNode.layer = uiLayer;
        backgroundNode.setPosition(0, 0, 0);
        backgroundNode.addComponent(UITransform).setContentSize(320, 136);
        const backgroundGraphics = backgroundNode.addComponent(Graphics);
        backgroundGraphics.clear();
        backgroundGraphics.fillColor = this.colorFromHex(entry.unlocked ? '#f2f8ec' : '#d9e0d2');
        backgroundGraphics.strokeColor = this.colorFromHex(selected ? '#ffe181' : entry.definition.accent);
        backgroundGraphics.lineWidth = selected ? 4 : 2;
        backgroundGraphics.roundRect(-160, -68, 320, 136, 18);
        backgroundGraphics.fill();
        backgroundGraphics.stroke();
        itemNode.addChild(backgroundNode);

        const cardIconFrame = this.getCollectionCardIcon(entry.definition.id);
        const iconNode = new Node('Icon');
        iconNode.layer = uiLayer;
        iconNode.setPosition(-124, 12, 0);
        iconNode.addComponent(UITransform).setContentSize(72, 72);
        if (cardIconFrame) {
            const iconSprite = iconNode.addComponent(Sprite);
            iconSprite.spriteFrame = cardIconFrame;
            iconSprite.color = Color.WHITE.clone();
        } else {
            const iconLabel = iconNode.addComponent(Label);
            iconLabel.string = entry.unlocked ? this.getCardSymbol(entry.definition.id) : '??';
            iconLabel.fontSize = 22;
            iconLabel.lineHeight = 28;
            iconLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
            iconLabel.verticalAlign = Label.VerticalAlign.CENTER;
            iconLabel.color = this.colorFromHex(entry.unlocked ? '#253028' : '#61727c');
        }
        itemNode.addChild(iconNode);

        const titleNode = new Node('Title');
    titleNode.layer = uiLayer;
        titleNode.setPosition(-78, 4, 0);
        const titleTransform = titleNode.addComponent(UITransform);
        titleTransform.setContentSize(240, 26);
        titleTransform.setAnchorPoint(0, 0.5);
        const titleLabel = titleNode.addComponent(Label);
        titleLabel.string = entry.unlocked ? entry.definition.name : '未解锁卡片';
        titleLabel.fontSize = 18;
        titleLabel.lineHeight = 22;
        titleLabel.overflow = Label.Overflow.CLAMP;
        titleLabel.color = this.colorFromHex('#253028');
        itemNode.addChild(titleNode);

        const statusNode = new Node('Status');
    statusNode.layer = uiLayer;
        statusNode.setPosition(-78, -24, 0);
        const statusTransform = statusNode.addComponent(UITransform);
        statusTransform.setContentSize(240, 22);
        statusTransform.setAnchorPoint(0, 0.5);
        const statusLabel = statusNode.addComponent(Label);
        statusLabel.string = entry.definition.rarity === 'common'
            ? `进度 ${Math.min(entry.killCount, entry.definition.unlockTarget)}/${entry.definition.unlockTarget}`
            : (entry.unlocked ? '已完成收集' : '待解锁');
        statusLabel.fontSize = 14;
        statusLabel.lineHeight = 18;
        statusLabel.color = this.colorFromHex('#4b5a4e');
        itemNode.addChild(statusNode);

        const badgeNode = new Node('Badge');
    badgeNode.layer = uiLayer;
        badgeNode.setPosition(116, -40, 0);
        const badgeTransform = badgeNode.addComponent(UITransform);
        badgeTransform.setContentSize(78, 22);
        const badgeLabel = badgeNode.addComponent(Label);
        badgeLabel.string = entry.definition.badge;
        badgeLabel.fontSize = 13;
        badgeLabel.lineHeight = 18;
        badgeLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        badgeLabel.color = this.colorFromHex(entry.definition.accent);
        itemNode.addChild(badgeNode);
    }

    private formatExistingCollectionItem(entry: CollectionEntrySnapshot, selected: boolean): string {
        const marker = selected ? '>> ' : '';
        const visualToken = entry.unlocked ? '[已解锁图]' : '[未解锁图]';
        const title = entry.unlocked ? entry.definition.name : '未解锁卡片';
        const progressText = entry.definition.rarity === 'common'
            ? `${Math.min(entry.killCount, entry.definition.unlockTarget)}/${entry.definition.unlockTarget}`
            : entry.unlocked ? '已完成' : '待解锁';
        const detailText = entry.unlocked ? entry.definition.shortDescription : this.getLockedHint(entry);
        return `${marker}${visualToken} ${title}\n${entry.definition.badge}  ${progressText}\n${detailText}`;
    }

    private findNodeByName(root: Node, name: string): Node | null {
        if (root.name === name) {
            return root;
        }

        for (const child of root.children) {
            const found = this.findNodeByName(child, name);
            if (found) {
                return found;
            }
        }

        return null;
    }

    private findLabelInNode(node: Node): Label | null {
        return node.getComponent(Label) ?? node.getComponentInChildren(Label);
    }

    private buildCollectionSceneRuntime(): void {
        if (this._collectionInitialized) {
            this.refreshCollectionView();
            return;
        }

        this._collectionInitialized = true;
        for (const child of [...this.node.children]) {
            child.active = false;
        }

        const root = new Node('CollectionRuntimeRoot');
        root.addComponent(UITransform).setContentSize(720, 1280);
        const rootWidget = root.addComponent(Widget);
        rootWidget.isAlignTop = true;
        rootWidget.isAlignBottom = true;
        rootWidget.isAlignLeft = true;
        rootWidget.isAlignRight = true;
        rootWidget.top = 0;
        rootWidget.bottom = 0;
        rootWidget.left = 0;
        rootWidget.right = 0;
        this.node.addChild(root);
        this._collectionRoot = root;

        const titlePanel = this.createPanel(root, 'TitlePanel', 660, 96, 0, 520, '#1f2f3d', '#79f2de');
        this.createLabel(titlePanel, 'Title', '怪物收藏册', 34, '#f5f1dd', new Vec3(-290, 12, 0), 340, 40);
        this.createLabel(titlePanel, 'SubTitle', '斩杀、发现、补完全部图鉴卡片', 16, '#b9d6df', new Vec3(-290, -20, 0), 420, 26);

        const summaryPanel = this.createPanel(root, 'SummaryPanel', 660, 92, 0, 414, '#273949', '#4fa7b3');
        this._summaryLabel = this.createLabel(summaryPanel, 'SummaryLabel', '', 20, '#fff8de', new Vec3(-300, 0, 0), 600, 60);

        const listPanel = this.createPanel(root, 'ListPanel', 660, 442, 0, 120, '#13212c', '#3a6775');
        const listContent = new Node('ListContent');
        listContent.setPosition(0, 0, 0);
        const listTransform = listContent.addComponent(UITransform);
        listTransform.setContentSize(620, 402);
        const listLayout = listContent.addComponent(Layout);
        listLayout.type = Layout.Type.VERTICAL;
        listLayout.resizeMode = Layout.ResizeMode.CONTAINER;
        listLayout.spacingY = 10;
        listLayout.paddingTop = 12;
        listLayout.paddingBottom = 12;
        listLayout.paddingLeft = 10;
        listLayout.paddingRight = 10;
        listPanel.addChild(listContent);
        this._collectionList = listContent;

        const prefabDetailNode = this.instantiateCollectionDetailPanelPrefab(root.layer);
        if (prefabDetailNode) {
            const detailHost = new Node('DetailPanelHost');
            detailHost.setPosition(0, -370, 0);
            detailHost.addComponent(UITransform).setContentSize(660, 468);
            root.addChild(detailHost);
            this.bringNodeToFront(detailHost);

            detailHost.addChild(prefabDetailNode);
            prefabDetailNode.setPosition(0, 0, 0);

            this._detailPanelNode = prefabDetailNode;
            this._detailPanelBinding = this.prepareCollectionDetailPanel(prefabDetailNode);
            this._detailPanelBinding?.bindActions(
                () => this.goHome(),
                () => this.goGame(),
                () => this.resetCollectionProgress(),
                this,
            );
        } else {
            const detailPanel = this.createPanel(root, 'DetailPanel', 660, 468, 0, -370, '#1f2732', '#ffcf70');
            const detailIconNode = new Node('DetailIconSprite');
            detailIconNode.setPosition(-286, 174, 0);
            detailIconNode.addComponent(UITransform).setContentSize(72, 72);
            this._detailIconSprite = detailIconNode.addComponent(Sprite);
            this._detailIconSprite.node.active = false;
            detailPanel.addChild(detailIconNode);
            this._detailIcon = this.createLabel(detailPanel, 'DetailIcon', '--', 38, '#ffcf70', new Vec3(-286, 174, 0), 86, 56);
            this._detailTitle = this.createLabel(detailPanel, 'DetailTitle', '', 30, '#fff6d8', new Vec3(-220, 176, 0), 470, 40);
            this._detailStatus = this.createLabel(detailPanel, 'DetailStatus', '', 16, '#8fd7d8', new Vec3(-220, 136, 0), 470, 26);
            this._detailDescription = this.createLabel(detailPanel, 'DetailDescription', '', 18, '#d5dde4', new Vec3(-300, 84, 0), 600, 176);
            this._detailStrategy = this.createLabel(detailPanel, 'DetailStrategy', '', 16, '#a5d8c6', new Vec3(-300, -82, 0), 600, 170);

            const homeButton = this.createPanel(detailPanel, 'HomeAction', 180, 54, -108, -184, '#36576a', '#79f2de');
            this.createLabel(homeButton, 'HomeActionLabel', '返回主页', 20, '#f8f4e2', new Vec3(0, 0, 0), 180, 28, 0.5, 0.5);
            homeButton.on(Node.EventType.TOUCH_END, () => this.goHome(), this);

            const gameButton = this.createPanel(detailPanel, 'GameAction', 180, 54, 108, -184, '#725538', '#ffcf70');
            this.createLabel(gameButton, 'GameActionLabel', '开始狩猎', 20, '#fff7df', new Vec3(0, 0, 0), 180, 28, 0.5, 0.5);
            gameButton.on(Node.EventType.TOUCH_END, () => this.goGame(), this);

            const resetButton = this.createPanel(detailPanel, 'ResetCollectionAction', 180, 48, 0, -246, '#6f2f2f', '#ff9e7a');
            this.createLabel(resetButton, 'ResetCollectionActionLabel', '清空图鉴', 18, '#fff4df', new Vec3(0, 0, 0), 180, 24, 0.5, 0.5);
            resetButton.on(Node.EventType.TOUCH_END, () => this.resetCollectionProgress(), this);
        }

        this.refreshCollectionView();
    }

    private resetCollectionProgress(): void {
        CollectionSystem.debugResetAll();
        this._selectedCollectionId = '';
        this.setDetailPanelVisibility(false);

        if (this._existingCollectionBound) {
            this.refreshExistingCollectionView();
            return;
        }

        this.refreshCollectionView();
    }

    private refreshCollectionView(): void {
        const entries = CollectionSystem.getAllSnapshots();
        if (entries.length <= 0 || !this._collectionList) {
            this.setDetailPanelVisibility(false);
            return;
        }

        if (!entries.some(entry => entry.definition.id === this._selectedCollectionId)) {
            this._selectedCollectionId = '';
        }

        this._collectionList.removeAllChildren();
        for (const entry of entries) {
            this._collectionList.addChild(this.createCollectionCard(entry));
        }

        const overview = CollectionSystem.getOverview();
        if (this._summaryLabel) {
            this._summaryLabel.string = `已收藏 ${overview.unlockedCount}/${overview.totalCount}   稀有 ${overview.rareUnlockedCount}/${overview.rareTotalCount}   普通怪靠累计击杀，Boss 与稀有目标击败一次即收录`;
        }

        const selected = entries.find(entry => entry.definition.id === this._selectedCollectionId) ?? null;
        if (!selected) {
            this.setDetailPanelVisibility(false);
            return;
        }

        this.updateDetailPanel(selected);
    }

    private createCollectionCard(entry: CollectionEntrySnapshot): Node {
        const isSelected = entry.definition.id === this._selectedCollectionId;
        const node = new Node(`Card-${entry.definition.id}`);
        node.addComponent(UITransform).setContentSize(600, 54);

        const fill = entry.unlocked ? '#233847' : '#19242d';
        const stroke = isSelected ? '#ffcf70' : entry.definition.accent;
        const panel = this.drawPanel(node, 600, 54, fill, stroke);
        panel.lineWidth = isSelected ? 3 : 2;

        const cardIconFrame = this.getCollectionCardIcon(entry.definition.id);
        if (cardIconFrame) {
            const iconNode = new Node('SymbolIcon');
            iconNode.setPosition(-268, 0, 0);
            iconNode.addComponent(UITransform).setContentSize(42, 42);
            const iconSprite = iconNode.addComponent(Sprite);
            iconSprite.spriteFrame = cardIconFrame;
            iconSprite.color = Color.WHITE.clone();
            node.addChild(iconNode);
        } else {
            const symbolText = entry.unlocked ? this.getCardSymbol(entry.definition.id) : '??';
            this.createLabel(node, 'Symbol', symbolText, 22, entry.unlocked ? entry.definition.accent : '#61727c', new Vec3(-268, 0, 0), 52, 32, 0.5, 0.5);
        }

        const title = entry.unlocked ? entry.definition.name : '未解锁卡片';
        this.createLabel(node, 'Title', title, 20, '#fff4cf', new Vec3(-228, 11, 0), 300, 26);
        this.createLabel(node, 'Badge', entry.definition.badge, 14, entry.definition.accent, new Vec3(190, 11, 0), 100, 22, 1, 1);

        const progressText = entry.unlocked
            ? '已完成收集'
            : `进度 ${Math.min(entry.killCount, entry.definition.unlockTarget)}/${entry.definition.unlockTarget}`;
        const subText = entry.unlocked ? entry.definition.shortDescription : this.getLockedHint(entry);
        this.createLabel(node, 'Subtitle', subText, 13, '#bfc8cf', new Vec3(-228, -12, 0), 410, 20);
        this.createLabel(node, 'Progress', progressText, 13, '#9ae1d2', new Vec3(264, -12, 0), 120, 20, 1, 1);

        node.on(Node.EventType.TOUCH_END, () => {
            console.log('[SceneNavButton] 点击图鉴卡片(运行时布局)', entry.definition.id, entry.definition.name);
            this._selectedCollectionId = entry.definition.id;
            CollectionSystem.markSeen(entry.definition.id);
            this.refreshCollectionView();
        }, this);
        return node;
    }

    private updateDetailPanel(entry: CollectionEntrySnapshot): void {
        console.log('[SceneNavButton] 刷新图鉴详情', entry.definition.id, entry.definition.name, {
            unlocked: entry.unlocked,
            hostActive: this._detailPanelNode?.parent?.active ?? null,
            panelActive: this._detailPanelNode?.active ?? null,
        });
        CollectionSystem.markSeen(entry.definition.id);
        this.setDetailPanelVisibility(true);
        this.bringNodeToFront(this._detailPanelNode?.parent ?? this._detailPanelNode);

        const detailIcon = this.getCollectionDetailIcon(entry.definition.id);
        const detailDisplayPrefab = entry.unlocked ? this.getCollectionDetailDisplayPrefab(entry.definition.id) : null;
        const accentColor = this.colorFromHex(entry.unlocked ? entry.definition.accent : '#6f7f88');
        const lockedHint = this.getLockedHint(entry);
        const lockedCondition = this.getLockedCondition(entry);

        this.refreshDetailDisplayPrefab(detailDisplayPrefab);

        if (this._detailPanelBinding) {
            if (this._detailPanelBinding.iconSprite) {
                this._detailPanelBinding.iconSprite.node.active = !detailDisplayPrefab && !!detailIcon;
            }

            if (this._detailPanelBinding.iconLabel) {
                this._detailPanelBinding.iconLabel.node.active = !detailDisplayPrefab && !detailIcon;
            }

            this._detailPanelBinding.render(
                entry,
                detailDisplayPrefab ? null : detailIcon,
                this.getCardSymbol(entry.definition.id),
                lockedHint,
                lockedCondition,
                accentColor,
            );
            return;
        }

        if (this._detailIconSprite) {
            this._detailIconSprite.spriteFrame = detailIcon;
            this._detailIconSprite.node.active = !detailDisplayPrefab && !!detailIcon;
        }

        if (this._detailIcon) {
            this._detailIcon.string = entry.unlocked ? this.getCardSymbol(entry.definition.id) : '??';
            this._detailIcon.color = accentColor;
            this._detailIcon.node.active = !detailDisplayPrefab && !detailIcon;
        }

        if (this._detailTitle) {
            this._detailTitle.string = entry.unlocked ? entry.definition.name : '未解锁收藏';
        }

        if (this._detailStatus) {
            this._detailStatus.string = entry.unlocked
                ? `${entry.definition.badge}  已收藏` : `${entry.definition.badge}  ${lockedHint}`;
        }

        if (this._detailDescription) {
            this._detailDescription.string = entry.unlocked
                ? `${entry.definition.shortDescription}\n\n${entry.definition.details}`
                : `尚未解锁该卡片。\n\n${lockedHint}\n\n解锁后将显示完整描述与详情。`;
        }

        if (this._detailStrategy) {
            this._detailStrategy.string = entry.unlocked
                ? `搜集策略\n${entry.definition.strategy}`
                : `解锁条件\n${lockedCondition}`;
        }
    }

    private refreshDetailDisplayPrefab(displayPrefab: Prefab | null): void {
        const host = this._detailPanelBinding?.iconDisplayHost ?? this._detailDisplayHost;
        if (!host) {
            return;
        }

        const currentName = this._detailDisplayInstance?.name ?? '';
        const nextName = displayPrefab?.data?.name ?? '';
        if (this._detailDisplayInstance && displayPrefab && currentName === nextName) {
            this._detailDisplayInstance.active = true;
            return;
        }

        if (this._detailDisplayInstance) {
            this._detailDisplayInstance.destroy();
            this._detailDisplayInstance = null;
        }

        if (!displayPrefab) {
            return;
        }

        try {
            const instance = instantiate(displayPrefab);
            this.applyLayerRecursively(instance, host.layer);
            instance.setPosition(0, 0, 0);
            host.addChild(instance);
            this._detailDisplayInstance = instance;
        } catch (error) {
            console.warn('[SceneNavButton] 图鉴详情动画 prefab 实例化失败，已回退静态图标', error);
        }
    }

    private setDetailPanelVisibility(visible: boolean): void {
        if (this._detailPanelNode?.parent) {
            this._detailPanelNode.parent.active = visible;
        }

        if (this._detailPanelNode) {
            this._detailPanelNode.active = visible;
        }
    }

    private getLockedCondition(entry: CollectionEntrySnapshot): string {
        if (entry.definition.rarity === 'boss') {
            return '击败对应 Boss 一次后立即收录。';
        }
        if (entry.definition.rarity === 'rare') {
            return '等待稀有敌人随机现身，并亲手完成一次击杀。';
        }
        return `继续击杀该类敌人，当前 ${Math.min(entry.killCount, entry.definition.unlockTarget)}/${entry.definition.unlockTarget}。`;
    }

    private getLockedHint(entry: CollectionEntrySnapshot): string {
        if (entry.definition.rarity === 'boss') {
            return '击败一次即可收录';
        }
        if (entry.definition.rarity === 'rare') {
            return '随机出现，击败一次解锁';
        }
        return `还需 ${Math.max(0, entry.definition.unlockTarget - entry.killCount)} 次击杀`;
    }

    private getCardSymbol(id: string): string {
        switch (id) {
            case 'ghost':
                return 'GH';
            case 'snail_tail':
                return 'CAN';
            case 'ghost_boss':
                return 'B1';
            case 'snail_tail_boss':
                return 'B2';
            case 'rare_phantom_messenger':
                return 'R1';
            case 'rare_can_mimic':
                return 'R2';
            default:
                return '--';
        }
    }

    private createPanel(parent: Node, name: string, width: number, height: number, x: number, y: number, fillHex: string, strokeHex: string): Node {
        const node = new Node(name);
        node.setPosition(x, y, 0);
        node.addComponent(UITransform).setContentSize(width, height);
        this.drawPanel(node, width, height, fillHex, strokeHex);
        parent.addChild(node);
        return node;
    }

    private drawPanel(node: Node, width: number, height: number, fillHex: string, strokeHex: string): Graphics {
        const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
        graphics.clear();
        graphics.fillColor = this.colorFromHex(fillHex);
        graphics.strokeColor = this.colorFromHex(strokeHex);
        graphics.lineWidth = 2;
        graphics.rect(-width * 0.5, -height * 0.5, width, height);
        graphics.fill();
        graphics.stroke();
        return graphics;
    }

    private createLabel(
        parent: Node,
        name: string,
        text: string,
        fontSize: number,
        colorHex: string,
        position: Vec3,
        width: number,
        height: number,
        anchorX: number = 0,
        anchorY: number = 1,
    ): Label {
        const node = new Node(name);
        node.setPosition(position);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(width, height);
        transform.setAnchorPoint(anchorX, anchorY);

        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.max(fontSize + 6, Math.floor(fontSize * 1.35));
        label.color = this.colorFromHex(colorHex);
        label.overflow = Label.Overflow.CLAMP;
        label.enableWrapText = true;
        parent.addChild(node);
        return label;
    }

    private colorFromHex(hex: string): Color {
        const color = new Color();
        Color.fromHEX(color, hex);
        return color;
    }
}
