import { Link } from "react-router-dom";
import { useApi } from "../api/useApi";
import { AppShell, useIsDesktop } from "../components/AppShell";
import { ArticleRows, useArticleList } from "../components/ArticleList";
import { useAppData } from "../components/AppDataContext";
import { EmptyState, Spinner, palette } from "../components/ui";

export function ReadingListPage() {
  const isDesktop = useIsDesktop();
  const api = useApi();
  const list = useArticleList(api, { readingList: true });
  const { t } = useAppData();

  return (
    <AppShell>
      <main style={{ padding: "4px 24px 16px" }}>
        <header
          style={{
            alignItems: "center",
            background: palette.bg,
            borderBottom: `1px solid ${palette.mutedBorder}`,
            display: "flex",
            gap: "8px",
            padding: "8px 0",
            position: "sticky",
            top: isDesktop ? 0 : "51px",
            zIndex: 10,
          }}
        >
          <h1 style={{ flex: 1, fontSize: "20px", margin: 0 }}>{t("リーディングリスト")}</h1>
        </header>
        {list.loading && list.articles.length === 0 ? (
          <Spinner />
        ) : (
          <ArticleRows
            articles={list.articles}
            loading={list.loading}
            loadingMore={list.loadingMore}
            error={list.error}
            nextCursor={list.nextCursor}
            onRetry={() => void list.reload()}
            onLoadMore={() => void list.loadMore()}
            onUpdateState={(id, patch) => void list.updateState(id, patch)}
            emptyContent={
              <EmptyState>
                <p>{t("リーディングリストに保存した記事はありません。")}</p>
                <Link to="/articles" style={{ color: "inherit" }}>
                  {t("全ての記事")}
                </Link>
              </EmptyState>
            }
          />
        )}
      </main>
    </AppShell>
  );
}
