# Aegis 内容安全平台原型

面向企业团队的内容安全 SaaS 网页原型：公开官网、开发者文档、在线试用，以及内部运营后台。

审核结果、登录、评估和发布都是本地模拟。界面会标明演示结果，不代表已经接入真实模型、真实身份认证或生产级授权。

## 技术栈

- Next.js 16（App Router）+ React 19 + TypeScript
- next-intl（`en` / `es` / `zh`，默认英语，URL 始终带语言前缀）
- Tailwind CSS v4 + 现有 shadcn / Base UI 组件
- `@xyflow/react` 工作流画布

## 本地开发

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。中间件会把未带语言前缀的路径转到 `/en`。

## 生产构建

```bash
npm run build
npm start
```

`npm start` 默认监听 3000 端口。

## 环境变量

见 `.env.example`。目前只使用 `NEXT_PUBLIC_SITE_URL` 生成规范链接。不要把真实 API Key、数据库凭证或第三方密钥写入前端或该文件。

## 路由

语言代码：`en`、`es`、`zh`（简体中文，`Intl` 使用 `zh-CN`）。

| 路径 | 说明 |
| --- | --- |
| `/[locale]` | 官网首页 |
| `/[locale]/products` | 产品能力 |
| `/[locale]/use-cases` | 应用场景 |
| `/[locale]/pricing` | 定价（演示套餐，需联系销售） |
| `/[locale]/contact` | 联系销售（仅本地校验，不会发信） |
| `/[locale]/privacy` `/[locale]/terms` | 政策占位 |
| `/[locale]/docs` | API 文档（快速开始、鉴权、文本、图片、错误码） |
| `/[locale]/playground` | 文本与图片模拟试用 |
| `/[locale]/login` `/register` `/forgot-password` | 认证表单原型 |
| `/[locale]/console` | 内部运营后台 |

后台子路径：`rules`、`workflows`、`capabilities`、`lab`、`releases`、`audit-logs`、`tasks`、`settings`。

仍保留的旧页面（不在新导航中）：`/[locale]/benchmarks`、`/[locale]/dashboard`。

## 语言

优先级：URL 中的语言，其次已保存的 `NEXT_LOCALE`，再次浏览器语言，最后英语。URL 已指定语言时不会被自动改写。切换语言会保留当前路径。界面文案在 `messages/` 与 `messages/platform/`；用户创建的规则名、工作流名和备注是业务数据，切换语言不会改写。

## 原型数据

运营数据存在浏览器 `localStorage` 键 `aegis_prototype_state_v1`。这不是数据库，也没有多用户隔离。可在后台「设置」中恢复种子数据。试用输入和图片只留在当前页面，图片使用本地预览，不会上传。

## 部署到公网

任意能运行 Node.js 的托管均可：

1. 设置 `NEXT_PUBLIC_SITE_URL` 为公网源站，例如 `https://example.com`。
2. 执行 `npm run build`。
3. 用 `npm start` 或平台的 Node 启动命令提供 `.next` 产物。
4. 在托管商侧开启 HTTPS。

Vercel：导入仓库后设置同一环境变量，构建命令 `npm run build`，无需额外服务。

公网访问这个原型时，请把它当作演示站。前端路由不能代替服务端鉴权。正式接入真实审核前，还需要身份认证、授权、租户隔离、服务端 API 代理、限流、上传校验、审计和密钥管理。

## 关键目录

```text
messages/platform/{en,es,zh}.json
src/app/[locale]/
src/components/platform/
src/lib/platform/
```
