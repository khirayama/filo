import SwiftUI

struct StatusScreen: View {
    @State private var status: StatusOverview?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isRefreshing = false
    @State private var busyFeedId: Int?
    @State private var notice: String?
    @State private var filterText = ""
    @State private var statusFilter: StatusFilter = .all
    @Environment(\.filoIsDesktop) private var isDesktop

    var body: some View {
        FiloPage("処理ステータス") {
            FiloIconButton(.refresh, label: "再読み込み") { Task { await load() } }
            FiloButton(isRefreshing && busyFeedId == nil ? "取得中…" : "すべて取得", kind: .primary, small: true) {
                Task { await refreshAll() }
            }
            .disabled(isRefreshing)
            .padding(.trailing, 8)
        } content: {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let errorMessage {
                        FiloErrorBox(message: errorMessage) { Task { await load() } }
                    }
                    if isLoading || status == nil {
                        FiloSpinner()
                    } else if let status {
                        stats(status)
                        subscriptionsSection(status)
                    }
                }
                .padding(.horizontal, isDesktop ? FiloMetrics.desktopGutter : FiloMetrics.gutter)
                .padding(.top, 24)
                .padding(.bottom, 64)
            }
            .refreshable { await load() }
        }
        .overlay(alignment: .bottom) {
            if let notice { FiloToast(message: notice) }
        }
        .animation(.easeOut(duration: 0.2), value: notice)
        .task(id: notice) {
            guard notice != nil else { return }
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            notice = nil
        }
        .task {
            await load()
        }
    }

    // MARK: - Sections

    private func stats(_ s: StatusOverview) -> some View {
        HStack(spacing: 0) {
            stat("購読", "\(s.feeds.total)")
            stat("記事", s.articles.total.formatted())
            stat("最終取得", s.feeds.lastFetchedAt.map { isDesktop ? DateFormatting.time($0) : DateFormatting.compact($0) } ?? "—")
        }
        .background(RoundedRectangle(cornerRadius: FiloMetrics.radiusLarge).fill(FiloPalette.surface))
        .overlay(RoundedRectangle(cornerRadius: FiloMetrics.radiusLarge).strokeBorder(FiloPalette.mutedBorder, lineWidth: 1))
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(localized: label)
                .filoFont(12)
                .foregroundStyle(FiloPalette.muted)
            Text(value)
                .filoFont(isDesktop ? 20 : 15, .bold)
                .monospacedDigit()
                .lineLimit(1)
        }
        .padding(isDesktop ? 16 : 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func subscriptionsSection(_ s: StatusOverview) -> some View {
        let visible = visibleSubscriptions(s)
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.format("購読一覧（%ld）", s.subscriptionStatuses.count))
                .filoFont(15, .bold)
                .accessibilityAddTraits(.isHeader)
            if !s.subscriptionStatuses.isEmpty {
                HStack(spacing: 8) {
                    FiloTextField(placeholder: "購読名で検索", text: $filterText)
                    FiloSelect(
                        selection: $statusFilter,
                        options: StatusFilter.allCases.map { ($0, L10n.string($0.label)) },
                        label: "状態",
                        minWidth: 110,
                    )
                    .fixedSize()
                    Text("\(visible.count)/\(s.subscriptionStatuses.count)")
                        .filoFont(12)
                        .monospacedDigit()
                        .foregroundStyle(FiloPalette.muted)
                        .frame(minWidth: 44, alignment: .trailing)
                }
            }
            if s.subscriptionStatuses.isEmpty {
                FiloEmptyState(icon: .rss, message: "購読がありません。")
            } else if visible.isEmpty {
                FiloEmptyState(message: "条件に一致する購読がありません。")
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(visible) { sub in
                        subscriptionRow(sub)
                    }
                }
                .overlay(alignment: .top) { FiloDivider() }
            }
        }
    }

    private func subscriptionRow(_ sub: StatusSubscription) -> some View {
        let fetchBusy = sub.fetchJob?.isActive == true || busyFeedId == sub.feedId && isRefreshing
        let rowError = hasStatusAttention(sub) ? (sub.fetchJob?.lastError ?? sub.lastError) : nil
        return HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                NavigationLink(value: AppRoute.subscriptionDetail(sub.subscriptionId)) {
                    Text(sub.feedTitle)
                        .filoFont(14, .semibold)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                FlowLayout(spacing: 10, lineSpacing: 6) {
                    overallBadge(sub)
                    if let job = sub.fetchJob, job.status != "completed" {
                        jobBadge(job)
                    } else if sub.lastResult == "error" {
                        FiloBadge(label: "取得失敗", tone: .danger)
                    }
                    Text(sub.lastFetchedAt.map { DateFormatting.time($0) } ?? "—")
                        .filoFont(12)
                        .foregroundStyle(FiloPalette.muted)
                        .frame(height: 20)
                }
                if let rowError {
                    Text(rowError)
                        .filoFont(12)
                        .foregroundStyle(FiloPalette.danger)
                }
            }
            FiloIconButton(.refresh, label: fetchBusy ? "取得中…" : "このフィードを取得", size: 16) {
                Task { await refreshFeed(sub.feedId) }
            }
            .disabled(isRefreshing || fetchBusy)
        }
        .foregroundStyle(FiloPalette.text)
        .padding(.vertical, 8)
        .frame(minHeight: 56)
        .overlay(alignment: .bottom) { FiloDivider() }
    }

    @ViewBuilder
    private func overallBadge(_ sub: StatusSubscription) -> some View {
        if hasStatusAttention(sub) {
            FiloBadge(label: "失敗", tone: .danger)
        } else if sub.fetchJob?.stalled == true {
            FiloBadge(label: "中断", tone: .danger)
        } else if sub.fetchJob?.status == "running" {
            FiloBadge(label: "取得中", tone: .warn)
        } else if sub.fetchJob?.status == "pending" {
            FiloBadge(label: "取得待ち", tone: .warn)
        } else if sub.feedStatus == "paused" {
            FiloBadge(label: "停止")
        } else {
            FiloBadge(label: "完了", tone: .ok)
        }
    }

    // Per-row job badge: only while something is queued, running, or broken.
    @ViewBuilder
    private func jobBadge(_ job: FeedJob) -> some View {
        let label = L10n.string("取得")
        if job.stalled {
            FiloBadge(label: label + L10n.string("中断"), tone: .danger)
        } else if job.status == "failed" {
            FiloBadge(label: label + L10n.string("失敗"), tone: .danger)
        } else if job.status == "running" {
            FiloBadge(label: label + L10n.string("中"), tone: .warn)
        } else {
            FiloBadge(label: label + L10n.string("待ち"), tone: .warn)
        }
    }

    // Same actionable-first order as the web default sort.
    private func visibleSubscriptions(_ s: StatusOverview) -> [StatusSubscription] {
        let query = filterText.trimmingCharacters(in: .whitespacesAndNewlines).localizedLowercase
        return s.subscriptionStatuses
            .filter { sub in
                if !query.isEmpty && !sub.feedTitle.localizedLowercase.contains(query) { return false }
                switch statusFilter {
                case .all: return true
                case .attention: return hasStatusAttention(sub)
                case .fetching: return sub.fetchJob?.status == "pending" || sub.fetchJob?.status == "running"
                case .paused: return sub.feedStatus == "paused"
                }
            }
            .sorted { lhs, rhs in
                let left = statusRank(lhs), right = statusRank(rhs)
                return left == right ? lhs.feedTitle.localizedStandardCompare(rhs.feedTitle) == .orderedAscending : left < right
            }
    }

    // MARK: - Actions

    private func load() async {
        isLoading = status == nil
        do {
            status = try await APIClient.shared.getStatus()
            errorMessage = nil
        } catch {
            // only surface load errors when there is nothing to show
            if status == nil {
                errorMessage = ErrorMessages.message(for: error)
            }
        }
        isLoading = false
    }

    private func refreshAll() async {
        isRefreshing = true
        notice = nil
        do {
            let result = try await APIClient.shared.refreshFeeds(force: true)
            FiloAnalytics.track("refresh_feeds", parameters: ["source": "status", "enqueued": result.enqueued])
            notice = result.enqueued > 0
                ? L10n.format("%ld件のフィードの取得を開始しました。", result.enqueued)
                : L10n.string("取得対象のフィードがありません。")
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isRefreshing = false
    }

    private func refreshFeed(_ feedId: Int) async {
        busyFeedId = feedId
        isRefreshing = true
        notice = nil
        do {
            _ = try await APIClient.shared.refreshFeed(feedId)
            FiloAnalytics.track("refresh_feed", parameters: ["source": "status", "feed_id": feedId])
            notice = L10n.string("フィードの取得を開始しました。")
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isRefreshing = false
        busyFeedId = nil
    }

}

// Keep the same actionable-first order as the web and Android status screens.
private func statusRank(_ sub: StatusSubscription) -> Int {
    if hasStatusAttention(sub) { return 0 }
    if sub.fetchJob?.stalled == true { return 1 }
    if sub.fetchJob?.status == "running" { return 2 }
    if sub.fetchJob?.status == "pending" { return 3 }
    if sub.feedStatus == "paused" { return 4 }
    return 5
}

private func hasStatusAttention(_ sub: StatusSubscription) -> Bool {
    sub.consecutiveFailures > 0
        || sub.fetchJob?.status == "failed"
        || sub.lastResult == "error"
}

private enum StatusFilter: CaseIterable, Hashable {
    case all, attention, fetching, paused

    var label: String {
        switch self {
        case .all: return "すべて"
        case .attention: return "問題あり"
        case .fetching: return "取得中"
        case .paused: return "停止"
        }
    }
}
