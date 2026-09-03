# Agent Note: Webworker 镜像接纳可解析的裸名 bundle

Status: implemented

[English](2026-09-03-webworker-image-bare-bundle-names.md) | 中文

## 问题

web profile 模板把社区插件市场写成裸名 bundle `dshmarket`（[bundle 笔记](../feature/2026-08-16-bundle-dshmarket-into-web-profile.zh.md)）。[webworker 镜像打包器](../architecture/2026-08-20-webworker-pack-lowering-and-preview.zh.md)此前丢弃所有裸名行：它的 roster 启发式只收带作用域或路径分隔符的名字，因为 preset 元数据（agent preset id）与裸名同形。即使收下，`dshmarket` 也解析不到——打包器只从仓库根解析 roster 种子，而 pnpm 把这个仅 CLI 声明的依赖留在 `apps/cli/node_modules/`。因此打包出的 web 预览无法启动：Loader 在镜像内解析不到 `dshmarket`。

## 决策

用可解析性而非名字形态区分包与 preset 元数据。`moduleNamesOf` 把裸名收进独立集合；`packVfsImage` 仅当 workspace 索引携带该名、或它能从主根或调用方传入的安装锚（`PackOptions.rosterResolveFrom`）解析时，才把它纳入 roster。种子物化走同一组锚解析；传递依赖仍只从其 importer 目录解析。`repository.ts` 导出 CLI 包目录作为锚，两个打包调用点（`bin.ts` 与 preview-boot 的自打包）都传入它。

仅准入还不够：可达性 sweep 此前只以 workspace 导出面为根，外部 roster 种子的 JavaScript 会作为不可达被剪掉，镜像仍缺 `dshmarket/lib/index.js`。现在 sweep 以每个物化 roster 包的导出面为根——workspace 与 vendored 包在运行时被按构造名寻址，外部种子由 Loader 行直接点名。传递的第三方依赖不持有面根，仍可经其 importer 被剪。

## 考虑过的替代方案

**白名单登记已知裸名 bundle。** 在打包器里维护名字表会复制 profile 模板的选择并随之漂移；可解析性读取的是安装本身已持有的地面真相。

**所有种子都从 CLI 包目录解析。** 打包器库按设计不持有仓库知识；把 CLI 锚硬编码进 `pack.ts` 会破坏这一划分，因此锚以选项形式由仓库适配层的调用方传入。

**把 `dshmarket` 提升到根 workspace 依赖。** 根依赖将只为镜像打包而存在，且 pnpm 并不保证提升；CLI 锚与真实 boot 解析 bundle 的方式（profile 目录加 CLI 安装）一致。

## 后果

打包出的 web 预览携带 `dshmarket` 及其依赖闭包，种子入口经 sweep 可达。未来 CLI 安装的任何裸名 bundle 无需改动打包器即可进入镜像；解析不到的裸名留在 roster 之外，且永远不会被报为 missing。准入检查的代价是 pack 时每个裸名一次解析遍历，被扎根的外部种子会保留其导出面可达的 JavaScript。规格覆盖：可解析裸名进入 roster 与镜像、不可解析裸名留在外且 `missing` 为空、仅锚可达的包经 `rosterResolveFrom` 解析成功且入口文件在 sweep 后保留。

镜像完整性与运行时能力是两个问题：预览 boot 现在会走到 `dshmarket` 的激活，并停在其 `undici` 链上——它要求 worker 兼容表未实现的 Node 内建模块（`assert`、`console`、`diagnostics_channel`、`dns`、`http2`、`querystring`、`timers`、`tls`），且其 I/O 路径需要 worker 的 `net` mock 拒绝提供的真实 socket。这一残余属于 webworker-runtime 的能力决策，而非打包器缺口。
