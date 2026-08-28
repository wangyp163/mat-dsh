// 包根入口：loader 的 tsx 目录解析只认 index.{ts,js,json}（不读 package.json
// main，见 Step 0 探针 ERR_MODULE_NOT_FOUND index.json），而 client-modules 注册表
// 又要求 entry name 能 resolve 出 package.json —— 包根 index.ts 让两边同时成立。
export * from './src/index.ts'
