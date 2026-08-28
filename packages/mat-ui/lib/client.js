// 探针版客户端 bundle：符合宿主 client-modules 契约（packages/client/tsdown.client.ts
// 的 CJS factory 形态）。id 必须与 profiles/mat.yml 插入行的 name 严格一致。
// Step 3 的 scripts/build-mat-ui.mjs（esbuild）会整体重写本文件。
window.__ModuleLoader__.load({
  id: '~/mat-harness/mat-dsh/packages/mat-ui',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    return module.exports
  },
})
