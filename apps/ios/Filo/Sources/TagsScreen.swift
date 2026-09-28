import SwiftUI

// MARK: - Tags management

struct TagsScreen: View {
    @State private var tags: [Tag] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var newName = ""
    @State private var isCreating = false
    @State private var editingTagId: Int?
    @State private var editName = ""
    @State private var editColor = ""
    @State private var pendingDelete: Tag?
    @State private var isReordering = false
    @Environment(\.filoIsDesktop) private var isDesktop

    var body: some View {
        FiloPage("タグ管理") {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 8) {
                        FiloTextField(placeholder: "新しいタグ名", text: $newName) { Task { await create() } }
                        FiloButton("追加", icon: .plus, kind: .primary) { Task { await create() } }
                            .disabled(isCreating || newName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    if let errorMessage {
                        FiloErrorBox(message: errorMessage) { Task { await load() } }
                    }
                    if isLoading {
                        FiloSpinner()
                    } else if tags.isEmpty {
                        FiloEmptyState(icon: .tag, message: "タグがありません。上の入力欄から作成できます。")
                    } else {
                        LazyVStack(spacing: 0) {
                            ForEach(tags) { tag in
                                row(tag)
                            }
                        }
                        .overlay(alignment: .top) { FiloDivider() }
                    }
                }
                .frame(maxWidth: FiloMetrics.contentWidth, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, isDesktop ? FiloMetrics.desktopGutter : FiloMetrics.gutter)
                .padding(.top, 24)
                .padding(.bottom, 64)
            }
        }
        .task { await load() }
        .confirmationDialog(
            L10n.format("タグ%@を削除しますか？購読は削除されません。", pendingDelete.map { "「\($0.name)」" } ?? ""),
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
        ) {
            Button("削除する", role: .destructive) {
                if let tag = pendingDelete { Task { await delete(tag) } }
                pendingDelete = nil
            }
            Button("キャンセル", role: .cancel) { pendingDelete = nil }
        }
    }

    @ViewBuilder
    private func row(_ tag: Tag) -> some View {
        Group {
            if editingTagId == tag.id {
                FlowLayout(spacing: 8) {
                    ColorPicker(L10n.string("色"), selection: Binding(
                        get: { parseHexColor(editColor) ?? Color(hex: 0x3B82F6) },
                        set: { editColor = $0.toHex() },
                    ), supportsOpacity: false)
                    .labelsHidden()
                    .frame(width: FiloMetrics.controlHeight, height: FiloMetrics.controlHeight)
                    FiloTextField(placeholder: "タグ名", text: $editName) { Task { await saveEdit(tag) } }
                        .frame(minWidth: 160, maxWidth: 400)
                    HStack(spacing: 6) {
                        if !editColor.isEmpty {
                            FiloButton("色を解除", kind: .ghost) { editColor = "" }
                        }
                        FiloButton("キャンセル") { editingTagId = nil }
                        FiloButton("保存", kind: .primary) { Task { await saveEdit(tag) } }
                            .disabled(editName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            } else {
                HStack(spacing: 12) {
                    Circle()
                        .fill(tag.color.flatMap(parseHexColor) ?? FiloPalette.border)
                        .frame(width: 10, height: 10)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tag.name)
                            .filoFont(14, .semibold)
                            .lineLimit(1)
                        Text(L10n.format("%ld件の購読", tag.subscriptionCount))
                            .filoFont(12)
                            .foregroundStyle(FiloPalette.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 2) {
                        FiloIconButton(.chevronUp, label: "上へ", size: 16) { move(tag, by: -1) }
                        FiloIconButton(.chevronDown, label: "下へ", size: 16) { move(tag, by: 1) }
                        FiloIconButton(.pencil, label: "編集", size: 16) {
                            editingTagId = tag.id
                            editName = tag.name
                            editColor = tag.color ?? ""
                        }
                        FiloIconButton(.trash, label: "削除", size: 16, danger: true) { pendingDelete = tag }
                    }
                    .disabled(isReordering)
                }
            }
        }
        .foregroundStyle(FiloPalette.text)
        .padding(.vertical, 8)
        .padding(.leading, 4)
        .frame(minHeight: 56)
        .overlay(alignment: .bottom) { FiloDivider() }
    }

    private func move(_ tag: Tag, by offset: Int) {
        guard !isReordering, let index = tags.firstIndex(of: tag), tags.indices.contains(index + offset) else { return }
        let original = tags
        tags.swapAt(index, index + offset)
        let reorderedIds = tags.map(\.id)
        isReordering = true
        Task {
            do {
                try await APIClient.shared.reorderTags(reorderedIds)
                errorMessage = nil
            } catch {
                tags = original
                errorMessage = ErrorMessages.message(for: error)
            }
            isReordering = false
        }
    }

    private func delete(_ tag: Tag) async {
        do {
            try await APIClient.shared.deleteTag(tag.id)
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        await load()
    }

    private func load() async {
        isLoading = tags.isEmpty
        do {
            tags = try await APIClient.shared.listTags()
            errorMessage = nil
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isLoading = false
    }

    private func create() async {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, !isCreating else { return }
        isCreating = true
        do {
            _ = try await APIClient.shared.createTag(name: name)
            newName = ""
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
        isCreating = false
    }

    private func saveEdit(_ tag: Tag) async {
        let trimmed = editName.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        let newColor = editColor.isEmpty ? nil : editColor
        let clearColor = editColor.isEmpty && tag.color != nil
        do {
            _ = try await APIClient.shared.updateTag(tag.id, name: trimmed, color: newColor, clearColor: clearColor)
            editingTagId = nil
            await load()
        } catch {
            errorMessage = ErrorMessages.message(for: error)
        }
    }
}

private func parseHexColor(_ hex: String) -> Color? {
    var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if h.hasPrefix("#") { h.removeFirst() }
    guard h.count == 6, let val = UInt64(h, radix: 16) else { return nil }
    return Color(
        red: Double((val >> 16) & 0xFF) / 255,
        green: Double((val >> 8) & 0xFF) / 255,
        blue: Double(val & 0xFF) / 255
    )
}

extension Color {
    func toHex() -> String {
        guard let components = UIColor(self).cgColor.components, components.count >= 3 else { return "" }
        let r = Int(components[0] * 255)
        let g = Int(components[1] * 255)
        let b = Int(components[2] * 255)
        return String(format: "#%02X%02X%02X", r, g, b)
    }
}
