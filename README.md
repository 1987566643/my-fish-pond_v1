# Fish Pond (Multi-user, Next.js + Vercel Postgres)

- 用户名/密码登录
- 多人画鱼 & 钓鱼（并发安全）
- 我的鱼（谁钓走了）
- 我的收获
- 留言板

## 部署
1. 创建 Vercel 项目，添加 Vercel Postgres
2. 添加环境变量：`POSTGRES_URL`, `JWT_SECRET`
3. 在 Postgres 控制台执行 README 中的建表 SQL
4. 部署即可

## 本地运行
```bash
npm i
cp .env.local.example .env.local  # 填入 POSTGRES_URL & JWT_SECRET
npm run dev
```

## SQL 架构
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fish (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data_url TEXT NOT NULL,
  w INT NOT NULL,
  h INT NOT NULL,
  in_pond BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fish_id UUID NOT NULL UNIQUE REFERENCES fish(id) ON DELETE CASCADE,
  angler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caught_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 一键部署（Deploy Button）
点击按钮即可克隆仓库并创建 Vercel 项目（随后在 Dashboard 里添加 Postgres 并填入环境变量）：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=<YOUR_REPO_URL>&env=POSTGRES_URL,JWT_SECRET&envDescription=POSTGRES_URL%20%E4%BD%9C%E4%B8%BA%E6%95%B0%E6%8D%AE%E5%BA%93%E8%BF%9E%E6%8E%A5%E4%B8%B2%EF%BC%8CJWT_SECRET%20%E7%94%A8%E4%BA%8E%E7%99%BB%E5%BD%95%E4%BC%9A%E8%AF%9D%E7%AD%BE%E5%90%8D&envLink=https%3A%2F%2Fvercel.com%2Fdocs%2Fdeploy-button)

> 提示：把上面链接中的 `<YOUR_REPO_URL>` 替换为你的公开 Git 仓库地址（例如 `https://github.com/yourname/my-fish-pond`）。

## GitHub Actions（CI/CD 到 Vercel）
本仓库已包含工作流：`.github/workflows/vercel.yml`。

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加以下 **Repository secrets**：
- `VERCEL_TOKEN`：在 Vercel → Account Settings → Tokens 创建
- `VERCEL_ORG_ID`：在本地项目的 `.vercel/project.json` 或 Vercel 项目设置中可见
- `VERCEL_PROJECT_ID`：同上

工作流行为：
- PR 分支：构建并创建 **Preview Deployment**
- 推送到 `main`：构建并部署到 **Production**

> 环境变量（如 `POSTGRES_URL`, `JWT_SECRET`）请在 Vercel 项目 → Settings → Environment Variables 配置。


---

### 新增表（点赞/公告）
```sql
-- 点赞/点踩记录
CREATE TABLE IF NOT EXISTS fish_reactions (
  fish_id UUID NOT NULL REFERENCES fish(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value   SMALLINT NOT NULL CHECK (value IN (1, -1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (fish_id, user_id)
);

-- 公告事件
CREATE TABLE IF NOT EXISTS pond_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('ADD','CATCH')),
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_fish_id UUID REFERENCES fish(id) ON DELETE SET NULL,
  target_owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);
```
